# Bank Account Details: Storage for Company, Supplier and Customer

- **Status:** Implemented, pending review
- **Author:** Raul Soonawala
- **Created:** 2026-09-10
- **Updated:** 2026-09-11

## TLDR

Carbon has nowhere to record a bank account. This adds three tables — `bankAccount`
(the company's own), `supplierBankAccount`, `customerBankAccount` — and the screens to
maintain them.

An account is a thin spine of columns every account has anywhere in the world (name,
country, currency, bank name, account holder) plus a `fields` JSONB bag holding the
identifiers themselves as an ordered list of `{ key, label, value }`. The user builds that
bag by picking from a seeded catalog of the identifiers banks actually use, or by typing a
name of their own. The account's country reorders the catalog; it never restricts it.

Configuration only. Nothing reads these rows yet.

## Problem Statement

`supplierPayment` and `customerPayment` carry terms, currency and an invoicing party;
`company` has a tax id and an address; `payment.bankAccount` is a foreign key to a GL
account — a posting target, not a bank. The only place a customer could put an account
number was a custom field or a free-text note.

The hard part is not storage, it is variety. An account is addressed by IBAN in the SEPA
zone, by routing number and account number in the US, by sort code in the UK, by BSB in
Australia, by institution plus transit number in Canada, by IFSC in India, by CLABE in
Mexico — and by whatever a particular bank in a particular corridor asks for, which no
list held by Carbon will ever be complete for.

## Proposed Solution

### Three tables, one shape

| Table | Owner | Permissions |
|---|---|---|
| `bankAccount` | the company itself, 1:1 with the GL account its cash posts through | `accounting_*` |
| `supplierBankAccount` | a supplier | `purchasing_*` |
| `customerBankAccount` | a customer | `sales_*` |

All three use the existing permission modules unchanged. Each has the standard four RLS
policies via `get_companies_with_employee_permission`.

### The `fields` bag

```json
[{"key": "iban",     "label": "IBAN",        "value": "DE89370400440532013000"},
 {"key": "swiftBic", "label": "SWIFT / BIC", "value": "COBADEFFXXX"}]
```

Ordered, because the order the user entered them in is the order they read them back in.
`label` is stored on the row rather than resolved from the key at render time, so a user
who renames a field keeps that name and a catalog change never rewrites history.

Keys are not constrained by the schema. The only structural guarantee is
`CHECK (jsonb_typeof("fields") = 'array')` — an object would be valid JSONB and would
break every consumer silently.

### Country coverage: a catalog, not a schema

`packages/utils/src/bank-fields.ts` seeds **three** identifiers — account number, IBAN and
SWIFT/BIC — each with a label, an optional placeholder and an optional country list.
`suggestBankFields(country)` **orders** that list and never filters it, because a German
supplier can hold a US account.

Three, because the bar for a seeded field is that it applies **everywhere or across at
least three countries**. That admits the account number and the BIC (universal) and the
IBAN (~80 countries), and excludes every national identifier: the US routing number and
account type, the UK sort code, the South African branch code, the Indian IFSC, the Chinese
CNAPS code. Those are typed by the user, which is what the open bag is for. The rule is
enforced by test, so a fourth seeded field has to earn it.

The consequence, stated plainly: a US user types "Routing Number" the first time they
record a US account, and a UK user types "Sort Code". That is one typed label against a
suggestion list that is otherwise mostly fields they will never need.

| Country | Seeded, in order | Typed by the user |
|---|---|---|
| Europe (SEPA), UK | IBAN, account number, SWIFT/BIC | sort code (UK domestic) |
| United States | account number, SWIFT/BIC, IBAN | routing number, account type |
| South Africa | account number, SWIFT/BIC, IBAN | branch code |
| India | account number, SWIFT/BIC, IBAN | IFSC code |
| China | account number, SWIFT/BIC, IBAN | CNAPS code |

Adding a country Carbon has never heard of is data entry by the user, and needs no code at
all. Adding a *suggestion* is an entry in that array plus a test. Neither is a migration.

### Validation is advisory

IBAN (ISO 13616 mod-97) and ABA routing (3/7/1 check digit) are verified, and a failure
renders a warning next to the input. It does not block the save. The user is reading the
bank's own paperwork and Carbon is not; a checksum Carbon gets wrong must not be able to
stop someone recording a real account.

The only hard rule is that an account records at least one detail.

### Sensitive value handling

Values are stored in plain text. **This is an open item for the team, not a settled
position** — see Open Questions.

## Design Decisions

| # | Decision | Choice | Why |
|---|---|---|---|
| 1 | Identifier storage | One ordered JSONB bag | One row read, no join, no second RLS surface, saves atomically with its parent, order preserved. `customFields` is the existing precedent |
| 2 | vs. a junction table | Rejected | Pays off only if an individual field needs querying, indexing or permissioning. Nothing does |
| 3 | vs. one column per identifier | Rejected | Every new country becomes a migration, and the set is unbounded |
| 4 | Key vocabulary | Seeded catalog, open set | One click for the common case without closing the set |
| 4a | Catalog size | Three | A seeded field must be universal or span 3+ countries. A suggestion list that is mostly fields you do not need is a second form to read before the first. Enforced by test |
| 4b | Checksum location | Keyed by field key, not by catalog membership | A user who types "Routing Number" gets the ABA check digit verified exactly as a seeded field would — so dropping a field from the catalog costs the suggestion, never the validation |
| 5 | Country handling | Reorders suggestions | An account's country predicts its fields; it does not determine them |
| 6 | Label storage | On the row | It is data the user can edit, not UI chrome. Same reason a unit-of-measure name is not translated |
| 7 | Checksums | Advisory warning | A false negative must never block a real account |
| 8 | Required fields | Name, country, currency, ≥1 detail | Anything more is a guess about a payment file that does not exist yet |
| 9 | Form submission | One hidden JSON string | The field set changes shape as the user edits; `ValidatedForm` cannot express that, and the server wants one bag anyway |
| 10 | Parse location | Server, on every write | The column is free-form JSONB, so the write path is the only place shape can be enforced |
| 11 | Malformed bag | Degrades to "no fields" | A free-form column must never break the page rendering it |
| 12 | Duplicate keys | Suffixed, not dropped | A user who records two branch codes has a reason |
| 13 | Supplier/customer edits | Ordinary UPDATE | Change control belongs with the surface that spends the money — see Out of Scope |
| 14 | `bankAccount` ↔ GL | Unique per GL account | Two bank accounts sharing GL lines cannot be reconciled apart. Matches the bank-reconciliation spec |
| 15 | Permissions | Existing modules, unchanged | Explicit constraint from the requester |

## Data Model Changes

`20260910143853_bank-account-details.sql`. All three tables carry:

- spine: `name`, `bankName`, `accountHolderName`, `countryCode` (FK `country`),
  `currencyCode` (FK `currencyCode`)
- `fields JSONB NOT NULL DEFAULT '[]'` + array CHECK
- `customFields JSONB` + a `customFieldTable` registry row
- standard `companyId`, composite PK, audit columns

`bankAccount` adds `glAccountId` (FK `account`, unique per company), `active`, and a
unique name per company. `supplierBankAccount` / `customerBankAccount` add their owner FK,
cascading from the parent.

## API / Service Changes

- `accounting.ee.server.ts`: `upsertBankAccount`
- `accounting.ee.service.ts`: `getBankAccount(s)`, `getBankAccountsList`, `deleteBankAccount`
- `purchasing.service.ts`: `getSupplierBankAccount(s)`, `upsertSupplierBankAccount`,
  `deleteSupplierBankAccount`
- `sales.service.ts`: the customer mirrors
- `packages/utils/src/bank-fields.ts`: the catalog, `suggestBankFields`,
  `parseBankFields`, `serializeBankFields`, `customBankField`, `hasBankFieldWarning`,
  `summarizeBankFields`, IBAN and ABA checksums
- `apps/erp/app/types/validators.ts`: `bankAccountFields` + `refineBankFields`

## UI Changes

- **Accounting → Bank Accounts** — new list page, drawer create/edit, delete.
- **Supplier → Payments** and **Customer → Payments** — a Bank Accounts card below the
  existing payment-terms form, with drawer create/edit and delete.
- `components/Form/BankAccountFields.tsx` — the shared repeating editor: a
  `CreatableCombobox` for the field name, an input for the value, add and remove.

## Acceptance Criteria

- [x] A bank account can be created for the company, a supplier and a customer.
- [x] The field-name combobox offers the seeded catalog, ordered by the account's country,
      and accepts a name the user types.
- [x] IBAN leads across SEPA and the UK; the universal pair leads elsewhere; every seeded
      field stays offerable for every country (parameterised test).
- [x] Every seeded field is universal or spans 3+ countries (test enforces the rule).
- [x] A typed "Routing Number" slugs to `routingNumber` and still gets its ABA check digit
      verified; a typed field with no checksum is left alone.
- [x] Switching country reorders suggestions and never discards an entered value.
- [x] A bad IBAN or routing number warns inline and still saves.
- [x] Saving with no details reports "Add at least one bank detail".
- [x] A malformed `fields` bag renders as no details rather than breaking the page
      (`parseBankFields` tests).
- [x] Duplicate keys are suffixed rather than dropped (`serializeBankFields` tests).
- [x] All three tables carry the four standard RLS policies on the existing permission
      modules, verified in `pg_policies`.
- [x] The array CHECK rejects a JSON object, verified against the live database.
- [x] 25 unit tests for `bank-fields`; 250 pass in `@carbon/utils`.
- [x] Scoped typecheck, `pnpm run lint`, `db:check:datasets`, `db:check:backups` pass.
- [x] No new test failures against the base commit.

## Out of Scope

| Thing | Where it belongs |
|---|---|
| Anything reading these rows — payment bank picker, invoice remittance block, payment runs, bank-file export | The consumer PR |
| Approval before a new counterparty account becomes payable; change alerts; callback verification | `.ai/specs/2026-07-04-master-data-controls.md`, once a payment surface exists |
| Statement ingestion, matching, Plaid feed columns | `.ai/specs/2026-07-02-bank-reconciliation.md` — note `bankAccount` now exists, so that spec's `CREATE TABLE IF NOT EXISTS` will skip and its columns must be added by `ALTER` |

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Plaintext values at rest | Open | See Open Questions — the row shape does not change if this is reversed |
| A consumer needs a stable key for the two or three fields a payment file requires | Med | Seeded keys are already stable; the constraint lands with the consumer, which is when its real requirements are known |
| Free-form keys produce per-company vocabulary drift | Low | The catalog is what the form offers first, so the common case converges on it by default |
| No change control on counterparty accounts | Med | Deliberate. It is a control on paying, and nothing pays yet |

## Open Questions

1. **Plaintext vs. Supabase Vault.** The first implementation encrypted account numbers
   and IBANs in the vault; this one does not, on the requester's call, pending team
   confirmation. Nothing regulatory forces the vault here — ITAR covers technical data,
   CUI/NIST 800-171 does not reach a manufacturer's own commercial banking data, and PCI
   DSS and GLBA do not apply. NACHA's Supplementing Data Security Requirements do mandate
   rendering deposit account information unreadable at rest, but they bind ACH
   originators above a volume threshold, which is a property of the customer rather than
   of Carbon. The strongest argument is non-regulatory: BEC and vendor-impersonation
   fraud. Moving sensitive entries into the vault later is a change to the write path
   plus a backfill; the row shape is unaffected.
2. **Whether `accountHolderName` should be required.** NACHA, BACS and SEPA all mandate a
   beneficiary name, so a row without one will fail file generation. Left optional here
   because nothing generates files yet.

## Changelog

- 2026-09-10: Created. Structured design — a per-country format registry, fixed columns
  per identifier class, vault-encrypted account numbers, and versioned counterparty rows.
- 2026-09-11: Redesigned to the current shape. Configuration is the phase-1 priority, so
  the format registry became a suggestion catalog, the fixed identifier columns became one
  JSONB bag, the vault became plaintext (open question 1), and the version chain and
  approval status were dropped. Net −2,500 lines against the first implementation.
- 2026-09-11: Catalog cut from 21 seeded identifiers to nine, scoped to the US, SEPA, UK,
  South Africa, India and China. Per-rail lead order pinned by test.
- 2026-09-11: Catalog cut again, from nine to three, on the rule that a seeded field must
  be universal or span at least three countries. Checksums re-keyed so a user-typed field
  keeps its verification.
