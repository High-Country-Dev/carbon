paths:
  - "packages/migration/**"
  - "packages/jobs/src/migration/**"
  - "packages/jobs/src/inngest/functions/tasks/migration.ts"
  - "packages/ee/src/netsuite/**"
  - "apps/erp/app/routes/x+/settings+/migrate.tsx"
  - "apps/erp/app/modules/settings/ui/Migrations/**"

# ERP Migrations

One click at **Settings → Migrate** reads another ERP and writes it into the current
Carbon company. Carbon only ever READS from a source — no write-back, no two-way sync.

NetSuite is the first source; the machinery is deliberately not NetSuite's.

Design and decisions: `.ai/specs/2026-09-12-erp-migration-harness.md`.

Grounded against `packages/migration/`, `packages/jobs/src/migration/connect.ts`,
`packages/jobs/src/inngest/functions/tasks/migration.ts`, and
`apps/erp/app/routes/x+/settings+/migrate.tsx`.

## The seam

| Layer | Where | Knows about |
|---|---|---|
| **Source** | `packages/migration/src/sources/<id>/` | one system only |
| **Plan** | `packages/migration/src/plan.ts` | Carbon's schema |
| **Load** | `packages/migration/src/load/` | Carbon only |
| **Lifecycle** | `packages/jobs/.../tasks/migration.ts` | neither |

`MigrationPlan` is the contract. A source produces one (`SourceConnection.read`,
which is extract + map); the loader consumes one. Nothing in `load/` may import
from `sources/`, and nothing downstream of a source's `map/` sees a source field
name. That split is what makes the layer with all the product decisions in it —
which source item type becomes which Carbon type — unit-testable with no source
account and no database.

The plan is deliberately **not extensible per source**. The target schema is the
same however the data arrived; a source holding something the plan has no room
for records a gap rather than widening the contract for everyone.

The loader is written in **Kysely against the generated database types**: it is
what proves at compile time that every column a migration writes exists. It is
how `currency` having no `name` column was caught.

## What belongs to the harness

Anything a SECOND source would also need. Today that is:

- `http/throttle.ts` — a semaphore and full-jitter backoff. Source governance is
  usually **concurrency**, not rate: N simultaneous requests, and the N+1st is
  rejected rather than queued. A token-bucket limiter is the wrong tool for that.
- `values.ts` — coercion for loosely-typed rows, and the one policy that must not
  be bypassable: `date()` returns null for an ambiguous `05/06/2026` rather than
  guessing DD/MM vs MM/DD.
- `errors.ts` — `MigrationError` kinds with `retryable` decided once, so the
  transport's backoff and the job's reporting cannot disagree; plus
  `SourceNotConnectedError` and `ScopeChoiceRequired`.
- `gaps/` — the framework. The ENTRIES belong to a source, because what cannot
  come across is a property of the system you are leaving.
- `load/` — the whole Carbon writer.

## Scopes → companies

A "scope" is the unit inside a source account that maps 1:1 to a Carbon company:
a NetSuite subsidiary, an accounting tenant, a realm. **A source account is a
company GROUP; each of its scopes is a company in it.** Carbon already models
exactly that — `companyGroup` holding a tree of companies linked by
`parentCompanyId`, with `isEliminationEntity` for consolidation shells — so the
migration rebuilds the source's org chart rather than flattening it.

- `SourceConnection.listScopes()` returns the tree (`parentScopeId` and all).
  Empty means the account has no such concept: one account, one company.
- The company the user pressed Migrate in takes the **root** scope. It is the one
  they already set up, and orphaning it for a fresh company would be a surprise.
- Every other scope is provisioned underneath it: a `company` insert plus the
  **`seed-company` edge function** with `parentCompanyId`, which is the same path
  Settings → Companies uses. That function inherits the group's
  `companyGroupId`, reuses the group's chart of accounts instead of seeding a
  second one, and creates the group's elimination entity itself.
- `seed-company` does NOT create a location and `readCompanyConfig` refuses to
  load into a company without one, so provisioning adds one named after the
  scope.
- Elimination scopes get **no** company of their own — Carbon makes its own — and
  are reported under "Entities without a company" rather than dropped silently.
- The group takes the source account's name, but only if it is still carrying the
  placeholder name it was seeded with. A group the customer named is theirs.

Scope→company links live in `externalIntegrationMapping` (`entityType:
"company"`, `integration: <sourceId>`, `externalId: <scopeId>`), which is what
makes a re-run resolve the same companies instead of creating a second set.

`ScopeChoiceRequired` still exists in the harness for a source whose `read` is
called without a scope it needs, but the job never triggers it: it gives every
scope a company rather than asking the user to choose one.

## Writing Carbon

Load order IS the contract (`load/index.ts` `TIERS`). Three orderings are
load-bearing:

- **Locations before items** — inserting an `item` fires an interceptor that
  creates one `itemPlanning` row per EXISTING location.
- **Items and parties before orders** — order lines resolve through the id map.
- **Items before bills of material** — a BOM line needs both ends.

**Interceptors create rows for you; UPDATE them, never insert.** Inserting an
`item` creates its `itemCost`, `itemReplenishment`, `itemUnitSalePrice` and
`itemPlanning`, plus a Draft `makeMethod` for `Part` and `Tool` ONLY. Inserting a
`customer` or `supplier` creates its payment and shipping rows, whose primary key
is the party id — an insert there violates it outright.

**Merge onto Carbon's seeded config, never duplicate it.** Every foundation tier
matches case-insensitively by name/code first. A second "Net 30" or a second "EA"
is a data-quality bug the customer inherits on day one. The chart of accounts is
the delicate one: `account` is company-GROUP scoped, so an insert is visible to
sibling companies, and `accountDefault` points at the seeded accounts by id —
merging is the only safe shape, and a multi-company group gets an explicit warning.

**Idempotency is by external id, namespaced by SOURCE.** Records are linked in
`externalIntegrationMapping` under `integration = <sourceId>` — `netsuite`, not
`migration` — so two sources migrating into one company keep separate namespaces
and the same external id can mean different records in each. The upsert's
`.where("allowDuplicateExternalId", "=", false)` is not optional: the unique
index it arbitrates on is partial, and Postgres raises 42P10 without its predicate.

**Opening stock is the one thing with no natural key**, and doubling a customer's
inventory is the worst thing a migration could do. Each entry carries a
deterministic `itemLedger.externalDocumentId` of
`migration:<sourceId>:opening:<item>:<location>` and a re-run skips markers it
already sees.

**`SET LOCAL "app.sync_in_progress" = 'true'`** for the whole load, the same flag
the dataset seeder sets: without it, 20,000 inserts enqueue 20,000 webhook events
and evaluate every customer workflow on day one.

## The job

`carbon/migration` (+ `-finalize`, `-revert`), modelled on `company-template` —
same marker row, same throttled progress, same snapshot/keep/revert. All three
share a per-company concurrency key so they never overlap, and the marker's
`integration` is `"migration"` for every source: one migration per company at a
time falls out of the partial unique index rather than being enforced by hand.

The marker lives on the company the run STARTED from and carries the whole run —
`companies[]` with each company's snapshot path and whether the run created it.
Keep drops every snapshot; Revert restores each snapshot and then deletes the
companies the run created, in that order (a restore that failed half-way would
otherwise leave the group short of both a company and its data). Only companies
the marker recorded as created are ever deleted.

- **Credentials are not in the event payload.** Inngest stores event bodies in
  run history. `packages/jobs/src/migration/connect.ts` resolves them from
  `companyIntegration` + Supabase Vault and hands the source resolved metadata —
  which is why the harness itself never imports Supabase.
- **Preview runs the real code path** and throws `DryRunRollback` after the load
  succeeds. A preview that took a different path would prove nothing about the
  migration it previews. The one thing it cannot do is create companies —
  provisioning is not transactional — so a scope with no company yet is read,
  mapped and counted, and reported as one that WOULD be created.
- **One transaction PER COMPANY.** Companies are independent tenants with no
  foreign keys between them, so that is the natural unit of atomicity — and a
  single transaction spanning all of them would hold one connection open for the
  length of the whole migration. Within a company it is still all-or-nothing.
- **Provisioning is not transactional.** `seed-company` is an edge function, so a
  company this run created survives a later failure; the marker records which
  companies were created so the revert can delete exactly those.
- **Nothing in the job is source-specific.** Adding a source adds no code to it.

## The gap register

`sources/<id>/gaps.ts` is the source of truth; `gaps/<id>.md` is generated from it
(`pnpm --filter @carbon/migration generate:gaps`) and `sources/gaps.test.ts` fails
when they drift. Ids are stable and never renumbered — the run report, the docs
site and support all reference them, and each source owns its own prefix (`NS-`).

The read counts what each gap costs THIS account. A gap with a proven count of
**zero** is dropped from the report; a gap the read could not probe keeps a
**null** count and is still shown. "We could not check" and "there is nothing
there" must not look the same to somebody deciding whether to cut over.

## Adding a source

A directory under `sources/`, a `MigrationSource` export, an entry in
`MIGRATION_SOURCES`, a member on `MigrationSourceId`, an integration in
`packages/ee` with its `SECRET_KEYS` entry and a migration seeding its
`integration` row. The job, the loader, the settings page and the report all read
the registry, so the new source appears with no edit outside those files.
`packages/migration/AGENTS.md` has the checklist.

## NetSuite specifics

Everything below is true of the NetSuite source only.

- **SuiteQL, not the REST record service.** A collection `GET /record/v1/customer`
  returns only ids and links — 4,000 customers is 4,001 requests against an
  account whose whole concurrency allotment is 5. The same read in SuiteQL is 4.
- `Prefer: transient` is REQUIRED on every SuiteQL call. Without it NetSuite
  answers 400 with a message about the header, which reads like a query error.
- `limit` max is 1000; `offset` is capped at **100,000** and then silently returns
  nothing. `suiteQLKeyset` (paging on `id > :last`) is the default for anything
  unbounded; `suiteQLAll` REFUSES at the ceiling rather than truncating.
- There are **no bind parameters** over REST. Every literal goes through
  `sources/netsuite/extract/sql.ts`.
- **Probe before you read.** `probeAccount` resolves the address, inventory, BOM
  and units-of-measure tables at run start, because features change the schema
  (Multi-Location Inventory, Advanced BOM), releases rename it (2026.1 split
  `entityaddress` into per-record-type tables), and role permissions hide it with
  no error at all. What it could not find lands in the run report.
- Carbon's `Material`/`Tool` item types are never chosen automatically — nothing
  NetSuite stores distinguishes them from an ordinary inventory part.

## Known gaps in the implementation itself

- `PlanItem.leadTime`, `PlanCustomer.taxPercent` and BOM component scrap are
  extracted as null pending a decision on which NetSuite column is authoritative.
- A source reads its whole account into memory before the load. Bounded by
  `maxRowsPerCollection` and fine at a manufacturer's scale; a multi-million-row
  account would need a streaming load.
