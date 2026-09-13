# @carbon/migration

The migration harness: everything that is the same whatever you migrate FROM,
plus one directory per system you can migrate from. Internal workspace package —
never published to npm.

```
src/
  plan.ts       MigrationPlan — the contract between a source and the loader
  source.ts     MigrationSource — the contract every source implements
  errors.ts     MigrationError kinds, SourceNotConnectedError, ScopeChoiceRequired
  values.ts     coercions for loosely-typed source rows (incl. the date policy)
  http/         Semaphore + backoff — governance primitives every source needs
  gaps/         the gap framework: types, detect, the markdown generator
  load/         the Carbon writer: Kysely, one transaction, source-agnostic
  sources/
    index.ts    MIGRATION_SOURCES — the registry the job and the UI read
    netsuite/   client, extract, map, gaps — NetSuite's business alone
```

## Always

- Keep the seam at `MigrationPlan`. A source produces one; the loader consumes
  one. Nothing downstream of a source's `map/` sees a source field name, and
  nothing in `load/` may import from `sources/`.
- Keep a source's `map/` **pure** — no network, no clock, no database. It is
  where every product decision lives (which source item type becomes which
  Carbon type, which orders are in scope), and its testability is the reason
  those decisions are reviewable at all.
- Put anything a SECOND source would also need into the harness, not into
  `sources/<id>/`. Concurrency limiting, backoff, value coercion, the ambiguous
  date policy and the gap framework all got there that way.
- Add a gap entry for anything a source cannot carry, then run
  `pnpm --filter @carbon/migration generate:gaps`. `sources/gaps.test.ts` fails
  if a register on disk has drifted.
- Leave ambiguity unset and note it. A date a source formats ambiguously
  (`05/06/2026`) lands as null; a promised date silently off by months is worse
  than a blank one.

## Never

- Never write to a source. This package reads; migrations have no write-back and
  no two-way sync, and the customer is told so on the settings page.
- Never widen `MigrationPlan` for one source. The target schema is the same
  however the data arrived; a source holding something the plan has no room for
  records a gap.
- Never put a credential in an event payload or a log line. A source's `connect`
  takes metadata the caller has already resolved from the vault.
- Never renumber a gap id — the run report, the docs site and support all
  reference them.
- Never guess a Carbon enum from a source value that does not map cleanly. The
  NetSuite mappers return null for anything unrecognized and the caller reports it.

## Adding a source

1. `src/sources/<id>/` — a client, an extractor, a pure mapper to `MigrationPlan`,
   and a `gaps.ts` catalog with its own id prefix.
2. Export a `MigrationSource` from `src/sources/<id>/index.ts`.
3. Add it to `MIGRATION_SOURCES` in `src/sources/index.ts` and to
   `MigrationSourceId` in `src/source.ts`.
4. Define its integration in `packages/ee/src/<id>/config.tsx`, add its secret
   dot-paths to `SECRET_KEYS`, and seed its `integration` row in a migration.
5. `pnpm --filter @carbon/migration generate:gaps`.

Nothing else changes. The job, the loader, the settings page and the run report
all read the registry — a new source appears in the UI with no edit outside those
five steps.

## Validation Commands

```bash
pnpm --filter @carbon/migration test
pnpm --filter @carbon/migration typecheck
pnpm --filter @carbon/migration generate:gaps   # after editing a gap catalog
```

## Key Exports

| Subpath | Provides | Safe in a browser bundle? |
|---|---|---|
| `.` | the whole harness, sources included | **No** — a source pulls `node:crypto` |
| `./gaps` | the gap framework and its types | Yes |
| `./plan` | `MigrationPlan`, `PLAN_SECTIONS`, `planCounts` | Yes |
| `./sources` | the registry | **No** — it imports every source |

The ERP's report imports `./gaps` and `./plan` specifically so signing code never
reaches the browser; the route reads `./sources` in its server-only loader.

## Consumers

- `packages/jobs/src/inngest/functions/tasks/migration.ts` — the job.
- `packages/jobs/src/migration/connect.ts` — resolves credentials, opens a source.
- `apps/erp/app/routes/x+/settings+/migrate.tsx` — the settings page.
- `apps/erp/app/modules/settings/ui/Migrations/` — the run row and report.

## Cross-References

- `.ai/specs/2026-09-12-erp-migration-harness.md` — the design and its decisions
- `.claude/rules/migrations.md` — how the pieces fit together at runtime
- `gaps/netsuite.md` — what a NetSuite migration leaves behind (generated)
