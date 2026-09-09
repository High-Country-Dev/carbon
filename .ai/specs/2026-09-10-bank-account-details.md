# Bank Account Details: Storage for Company, Supplier and Customer

> Status: in-progress
> Author: Claude (with Raul Soonawala)
> Date: 2026-09-10
> Siblings (schema alignment, not scope): `.ai/specs/2026-07-02-bank-reconciliation.md` (owns `bankAccount` as reconciliation master data), `.ai/specs/2026-07-04-master-data-controls.md` (owns the `supplierBankChange` approval gate and change alerts, tracking issue crbnos/carbon#1051)

## TLDR

Carbon stores no bank account details anywhere: `supplierPayment`/`customerPayment` hold
terms, currency and invoicing party only, `company` holds a tax id and an address, and
`payment.bankAccount` is a foreign key to a GL `account` row — a posting target, not a bank.
This spec adds the storage layer for all three: **`bankAccount`** (the company's own accounts,
linked 1:1 to a GL account), **`supplierBankAccount`** (where we pay a supplier) and
**`customerBankAccount`** (where a customer pays from, for direct debit and wire
identification). Country-specific identifiers are handled by a **declarative format registry**
(`packages/utils/src/bank-formats.ts`): one pure module maps an ISO 3166-1 alpha-2 country to
the field set that country actually uses — IBAN + BIC for SEPA, routing number + account
number + account type for the US, sort code for GB, institution + transit for CA, BSB for AU,
a generic fallback everywhere else — and drives the zod validation, the conditional form
rendering, and the storage mapping from one place, so adding a country is a data change with
no migration. Account numbers and IBANs are **encrypted in Supabase Vault** via the shipped
`companyIntegration.secretRef` pattern and are never returned to the client; only a last-four
display column is. Supplier and customer rows are **versioned and never edited in place**, per
the master-data-controls design — with no approval rule configured they activate immediately,
which is that spec's own documented no-rule behaviour, so the approval gate lands later as a
pure addition with no migration. This spec is storage only: nothing reads these rows yet.

## Problem Statement

Verified against `main` at `96767291a`:

- No table, column or enum for an account number, IBAN, routing code, sort code, BSB, SWIFT or
  BIC exists in `packages/database/supabase/migrations/` — zero hits across the whole set.
- `supplierPayment` (`20231109050239_supplier-details.sql`) and `customerPayment`
  (`20231109050252_customer-details.sql`) carry `paymentTermId`, `currencyCode`, the invoicing
  party override and `customFields` only.
- `payment.bankAccount` (`20260630093809_ar-ap-payments.sql:210`) references `account("id")`;
  the form field is a GL Asset-account picker (`PaymentForm.tsx:246`). Carbon knows which GL
  account cash hits and nothing about the bank behind it.
- `company` has `taxId` and an address; no remittance details, and `SalesInvoicePDF.tsx` renders
  payment terms only — a Carbon-issued invoice cannot tell a customer where to wire.
- `AccountSchema` in `packages/ee/src/accounting/models.ts:95` carries `bankAccountNumber` and
  `routingNumber`, but that is the in-memory canonical model for the QuickBooks/Xero/Rillet sync
  layer; nothing persists those fields.

The only place a customer can record bank details today is a `customFields` JSONB value or a
free-text note — unstructured, unvalidated, unencrypted and invisible to every consumer.

Three sibling specs already assume this data exists and none of them build it as an
independently shippable layer: bank reconciliation needs `bankAccount` before it can reconcile
anything, master-data controls needs `supplierBankAccount` before it can gate changes to it, and
its own closing note defers customer bank details to "this exact model when needed".

## Proposed Solution

### Three tables, one shape

| Table | Owner | Identity | Lifecycle |
|---|---|---|---|
| `bankAccount` | the company itself | `id('bka')` | plain editable master + `active` flag |
| `supplierBankAccount` | a supplier | `id('sba')` | versioned; business fields immutable |
| `customerBankAccount` | a customer | `id('cba')` | versioned; business fields immutable |

`bankAccount` follows the bank-reconciliation spec's DDL for the columns they share, minus every
Plaid/feed/reconciliation column (`source`, `plaidItemId`, `plaidAccountId`, `connectionStatus`,
`lastSyncedAt`) — those belong to that spec's phases and are additive `ALTER`s later. It gains
the full identifier columns this spec introduces, which that spec did not need because
reconciliation only ever displays a last four.

`supplierBankAccount` follows the master-data-controls DDL, with two deliberate divergences
recorded in Design Decisions.

### Country coverage: a declarative format registry

The design problem is that the fields a bank account needs are a function of its country, and
"its country" is not the party's country — a German supplier can hold a USD account in the US.
The registry is a pure module with no database rows:

```
BankFieldKey    = iban | swiftBic | accountNumber | accountType | routingNumber
                | sortCode | bsb | institutionNumber | transitNumber | bankCode | branchCode
BankFieldSpec   = { key, label, required, sensitive, storage, pattern?, normalize?, maxLength?, helper? }
BankAccountFormat = { id, fields: BankFieldSpec[] }
```

Resolution order for a country code: explicit per-country format → IBAN format if the country is
in the IBAN set → `generic`. Day-one formats:

| Format | Countries | Required | Optional |
|---|---|---|---|
| `us-aba` | US | routing number (9 digits, ABA checksum), account number, account type | SWIFT/BIC |
| `gb-sort` | GB | sort code (6 digits), account number (8 digits) | IBAN, SWIFT/BIC |
| `ca-eft` | CA | institution number (3), transit number (5), account number | SWIFT/BIC |
| `au-bsb` | AU | BSB (6 digits), account number | SWIFT/BIC |
| `iban` | ~80 IBAN countries incl. all SEPA | IBAN (mod-97 checksum) | SWIFT/BIC |
| `generic` | everything else | account number | bank code, SWIFT/BIC |

Adding India (IFSC), Mexico (CLABE) or Japan (bank + branch code) is an entry in this file and a
test — no migration, because the storage mapping is part of the field spec rather than part of
the schema.

### Storage mapping — how variable fields reach fixed columns

Every field spec declares a `storage` target, so the registry is the single place that knows
where a country-specific identifier lands:

| Storage target | Columns | Fields that use it |
|---|---|---|
| `column:swiftBic` | `swiftBic` | SWIFT/BIC |
| `column:routingNumber` | `routingNumber` | routing number, sort code, BSB, bank code — the domestic clearing code, exactly one per format |
| `secret:accountNumber` | vault bag + `accountNumberLastFour` | account number |
| `secret:iban` | vault bag + `ibanLastFour` | IBAN |
| `json:<key>` | `bankIdentifiers` JSONB | account type (US), institution number (CA), branch codes, anything a future format adds |

`routingNumber` is one column because every format has at most one primary domestic clearing
code and every downstream consumer — payment files, accounting providers — expects to find it in
one place. The registry supplies the label, so a GB row renders "Sort code" over the same column
a US row renders "Routing number" over. Secondary parts go to `bankIdentifiers` rather than
earning a column each, which is what keeps a new country migration-free.

`formatId` is stored on the row. A consumer must not re-derive the format from `countryCode`,
because a later registry change would silently reinterpret historical rows.

### Sensitive value handling

Account number and IBAN go into Supabase Vault as one JSON bag per row, through
`SECURITY DEFINER` RPCs granted to `service_role` only — the pattern shipped in
`20260817122916_integration-secret-vault.sql` (NIST 800-171 3.13.16) and used by
`packages/ee/src/integrations/secrets.ts`. The row keeps a `secretRef TEXT` vault id plus
`accountNumberLastFour` / `ibanLastFour` for display.

Consequences, all intentional:

- No loader, action, API response or notification ever carries a full account number. Lists and
  pickers need no decryption at all.
- An edit form cannot prefill the value. It renders `•••• 1234` as a placeholder and writes a new
  secret only when the field is re-entered non-empty.
- A single server-only reader (`getBankAccountSecret`, service role, no route exposes it) exists
  for the future payment-execution consumer.
- Deleting or deactivating a row drops its vault secret via an `AFTER DELETE` trigger, mirroring
  `trg_drop_integration_secret`.

### Versioning for supplier and customer

Create, update and deactivate each insert a **new row** carrying `changeType`, `replacesId` and
`status`; the superseded row becomes `Inactive` with `effectiveTo` stamped. The tables have no
UPDATE or DELETE RLS policies, so business fields are immutable against PostgREST and not merely
against the UI; transitions run through service-role Kysely inside one transaction.

With no approval rule configured a proposed row activates immediately inside the same
transaction. That is exactly Design Decision 9 of the master-data-controls spec — "byte-identical
control data model whether gated or not; turning a rule on later gates the next change with zero
migration" — which is why building the versioned shape now rather than a plain editable table
costs one service function and saves a data migration plus an RLS rewrite later.

`bankAccount` is not versioned. Your own bank details are not a payment-fraud surface, the
reconciliation spec specifies a plain editable master, and reconciliation needs to correct a
mistyped account without minting a version.

## Design Decisions

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Table names and column shapes | Match the sibling specs exactly where they overlap | Those specs are the repo's decision of record; divergence would force them to migrate |
| 2 | Secret storage | Single `secretRef TEXT` vault id to a `{accountNumber, iban}` bag | The master-data spec's twin `accountNumberRef`/`ibanRef` JSONB with a `kind` discriminator predates the vault migration, which resolved the AES-fallback question by declaring Vault an infra prerequisite. One ref, one bag, one shipped precedent |
| 3 | Country handling | Declarative registry in `@carbon/utils`, `storage` target per field | One source for validation, rendering and persistence; a new country is data plus a test |
| 4 | Domestic clearing code | One `routingNumber` column, labelled by the registry | At most one per format; consumers and accounting providers expect one place to look |
| 5 | Secondary identifiers | `bankIdentifiers` JSONB | Keeps a new country migration-free; nothing needs to filter on a branch code |
| 6 | `formatId` persisted | Yes | A registry change must not reinterpret historical rows |
| 7 | Supplier/customer lifecycle | Versioned, no UPDATE/DELETE policies, auto-activating with no rule | Master-data-controls Decisions 1, 5 and 9; the gate lands later as pure addition |
| 8 | Company lifecycle | Plain editable + `active` | Bank-reconciliation spec's shape; not a fraud surface |
| 9 | Permissions | Reuse `accounting_*` (company), `purchasing_*` (supplier), `sales_*` (customer) | No new claim, no permission-seed migration, no change to existing user rows; `fixedAsset` (`20260524143827`) is the precedent for a whole subsystem on `accounting_view` |
| 10 | Bank country vs party country | Own `countryCode` on the row, defaulting to the party's | A party can bank outside its own country; Stripe separates them for the same reason |
| 11 | GL link | `bankAccount.glAccountId` unique per company, Asset/Bank accounts only | Bank-reconciliation spec's constraint, verbatim |
| 12 | Audit coverage | Add all three tables to `audit.config.ts`, secret columns in `skipFields` | Config-only; bank data unaudited from day one is indefensible, and the record-integrity spec's remaining work stays its own |
| 13 | Consumers | None in this PR | Scope is storage; the payment picker, invoice remittance block and payment runs are a second PR |

## Data Model Changes

One idempotent migration (`pnpm db:migrate:new bank-account-details`), then
`pnpm run generate:types` before typechecking. Three tables, three vault RPCs, three
delete-cascade triggers, and audit config additions.

Full DDL is written in the migration; the shape per table is:

- identity + tenancy: `id('bka'|'sba'|'cba')`, `companyId`, composite PK `("id","companyId")`
- ownership: `glAccountId` (company) / `supplierId` / `customerId`
- descriptive: `name` (company only), `bankName`, `accountHolderName`, `countryCode`,
  `currencyCode`, `formatId`
- identifiers: `swiftBic`, `routingNumber`, `bankIdentifiers` JSONB
- secrets: `secretRef`, `accountNumberLastFour`, `ibanLastFour`
- lifecycle: `active` (company) / `status`, `changeType`, `replacesId`, `effectiveFrom`,
  `effectiveTo` (supplier, customer)
- verification record columns (`verifiedBy/At/verificationMethod/verificationNotes`) on the two
  versioned tables, written by no code in this PR — carried now so the controls spec adds
  service and UI only
- audit columns + `customFields` JSONB

A `CHECK` requires an account number or an IBAN on every non-deactivation row, so the row is
honest regardless of which country format produced it.

## API / Service Changes

- `accounting.models.ts` / `accounting.service.ts`: `bankAccountValidator`, `getBankAccounts`,
  `getBankAccount`, `upsertBankAccount`, `deleteBankAccount`.
- `purchasing.models.ts` / `purchasing.service.ts`: `supplierBankAccountValidator`,
  `getSupplierBankAccounts` (all versions), `getActiveSupplierBankAccounts` (**the only reader a
  future payment surface may use**), `proposeSupplierBankChange`.
- `sales.models.ts` / `sales.service.ts`: the customer mirror.
- `bank-accounts.server.ts` (server-only, service role): `writeBankAccountSecret`,
  `getBankAccountSecret`, `deleteBankAccountSecret` — the only module that touches the vault RPCs,
  never imported by a module barrel.
- `packages/utils/src/bank-formats.ts`: the registry, `resolveBankFormat(countryCode)`,
  `validateBankFields`, `splitBankFieldsForStorage`, IBAN mod-97 and ABA checksum.

## UI Changes

- Settings → Accounting gains **Bank Accounts**: list plus new/edit/delete drawers, GL account
  picker restricted to Asset accounts.
- Supplier → Payments and Customer → Payments each gain a **Bank Accounts** section: active
  accounts with masked numbers, a version history list, and a form that proposes a new version.
- One shared `BankAccountFields` component renders the registry's fields for the selected
  country and clears values for fields the new format does not include.

## Acceptance Criteria

All verified 2026-09-10 against the local stack.

- [x] Migration applies; `pnpm run generate:types` regenerates cleanly.
- [x] A bank account can be created, edited and deactivated for the company, a supplier and a
      customer, each from its own surface.
- [x] Selecting US renders routing number + account number + account type; DE renders IBAN + BIC;
      GB renders sort code + account number + optional IBAN; the fields a country does not use are
      unmounted, and `splitBankFieldsForStorage` drops them even if they arrive anyway.
- [x] An invalid IBAN checksum is rejected inline ("IBAN is not valid"); an invalid ABA checksum is
      rejected by the validator (unit test).
- [x] No loader payload or rendered HTML contains a full account number or IBAN — checked in the
      browser for the edit route, which carries only `•••• 6789`.
- [x] `supplierBankAccount` and `customerBankAccount` business fields cannot be updated or deleted
      as the `authenticated` role (both statements affect zero rows); editing produces a second row
      with `replacesId` set and the predecessor `Inactive` with `effectiveTo` stamped, and the
      account number carries forward without re-entry.
- [x] Deleting a bank account removes its vault secret on all three tables (zero orphaned secrets
      after clearing the test data).
- [x] A second concurrent `Pending Approval` row per party is rejected by the partial unique index.
- [x] Scoped typecheck, lint, 259 unit tests, `pnpm db:check:datasets` and `pnpm db:check:backups`
      all pass.

## Out of Scope

| Concern | Owner |
|---|---|
| `supplierBankChange` approval gate, change alerts, verification UI, SoD rows | `.ai/specs/2026-07-04-master-data-controls.md` |
| Statement ingestion, matching, reconciliation, Plaid feed columns, cash position | `.ai/specs/2026-07-02-bank-reconciliation.md` + `.ai/specs/2026-07-02-plaid-bank-feeds.md` |
| Every consumer: payment bank picker, invoice remittance block, payment runs, bank-file export | Second PR |
| Accounting-provider sync of bank accounts | No provider entity exists today |

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Storage with no consumer reads as dead code | Low | Stated in the PR; the sibling specs are the consumers and are cited |
| Registry mis-maps a country's fields | Med | Unit tests per format with real-shaped sample values; `generic` fallback means no country is unusable |
| Vault absent on a self-hosted stack | Low | The vault migration already declares the extension an infra prerequisite; this spec adds no new dependency |
| Versioned tables surprise a reviewer expecting plain CRUD | Low | Design Decision 7 cites the sibling spec's own no-rule behaviour |
| Sibling specs' `CREATE TABLE IF NOT EXISTS` silently skips their columns once these tables exist | Med | Noted here and in the migration: bank reconciliation must add its Plaid/feed columns by `ALTER`, not rely on its `CREATE TABLE IF NOT EXISTS` |
| A restored company backup carries `secretRef` but not the vault secret behind it | Low | Same shape as `companyIntegration`, which is excluded from backups outright for this reason. Reads fail closed (`BankAccountSecretUnavailableError`) rather than returning a half-populated account, and no consumer reads secrets yet. Whoever ships payment execution should decide whether restore nulls `secretRef` or these tables join `SECRET_TABLES` |

## Open Questions

- None blocking.

## Changelog

- 2026-09-10: Created. Fieldwork verified against `main` at `96767291a`.
- 2026-09-10: Built and browser-verified. Three defects found during verification and fixed:
  `normalizeBankFields` iterated every key of the submitted form and crashed on the first
  non-string (`active`), so it now reads only the keys the registry declares; the update path
  passed the last-four masks through `sanitize`, which turns `undefined` into `null` rather than
  dropping the key, nulling the mask of an untouched identifier and tripping the row's identifier
  check; and the drawer forms submitted by navigation rather than through a fetcher, which let the
  Submit button's unsaved-changes blocker intercept the action's own redirect and swallow the
  save. Each has a regression test or matches the shipped convention it had diverged from.
