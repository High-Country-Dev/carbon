# Plan: the release checks on every path to Ready

- Date: 2026-10-17
- Spec: `.ai/specs/2026-10-14-strict-backflush.md`
- Request: "implement in the Kanban and verify all the places … rigorous testing" (user, 2026-10-17).
- Rule: no commit and no push until the user asks.

## Every path that sets a job to Ready

| Path | Before this plan |
|---|---|
| Release dialog / status post (`x+/job+/$jobId.status.tsx`) | `getJobReleaseReadiness`, then `releaseJobs` |
| Bulk release (`x+/job+/release.tsx`) | `getJobReleaseReadiness` + `jobReleaseProblems`, then `releaseJobs` |
| Batch release (`releaseBatchMemberJobs`) | `getJobReleaseReadiness` + `jobReleaseProblems`, then `releaseJobs` |
| Kanban scan with `autoRelease` (`api+/kanban.$id.tsx`) | none: writes `status: "Ready"` directly |
| MCP / API tool `production_updateJobStatus` | none: `updateJobStatus` writes any status |

No SQL function sets a job to Ready. The SQL writes of `'Ready'` are on `jobOperation`.

## Decisions

| # | Decision | Reason |
|---|----------|--------|
| D1 | `updateJobStatus` (the MCP / API tool) refuses a move from Draft or Planned to Ready while `jobReleaseProblems` or "nothing to make" applies. | It is the one function every caller outside the app reaches. A refusal there covers the API and any later caller. |
| D2 | `writeJobStatus` (no `@mcp` tag) is the unguarded write. `releaseJobs` and the status route call it, after their own check. | They already ran the check. A second run per job would double the reads of a bulk release. The API cannot reach a function with no `@mcp` tag. |
| D3 | The kanban scan with `autoRelease` runs `jobReleaseBlockers`, then `releaseJobs`, then one schedule run. Its outside operations go on the supplier's newest Draft PO, else a new one. | Bulk release is the closest path with no dialog: same checks, same release (requirements, MRP, Ready, outside operation purchase orders, release date). Bulk release also refuses a supplier with a Draft PO, so a planner can choose one; no one at a kanban card can, so the scan reuses it (found in the browser test). |
| D4 | A kanban job that fails the checks stays Draft and stays linked to the kanban. The scan goes to the job page with a message that names the problems. MES is not opened. | The scan is not lost, and the planner sees what to fix. Opening MES for a job that is not released would start work on it. |
| D5 | With strict backflush on at the job's location, job creation gives a line the BoM's Pull From, else the item's default storage unit (`pickMethod`). It never takes the fullest bin. | The fullest bin is a guess, not a choice. With no Pull From and no default, the line has no storage unit, so release refuses it. |

## Tasks

- [x] T1. `production.service.ts`: split `updateJobStatus` into the guarded MCP function (D1) and `writeJobStatus` (D2).
- [x] T2. Point `releaseJobs`, `planDraftJob` and the status route at `writeJobStatus`.
- [x] T3. `api+/kanban.$id.tsx`: checks, `releaseJobs`, schedule, flash message (D3, D4).
- [x] T4. `get-method`: no fullest-bin fallback under strict backflush (D5), in both places that pick a line's bin.
- [x] T5. Tests: the guard (unit), the kanban decision (unit), get-method under strict (live database).
- [x] T6. Browser: a kanban scan with a missing storage unit, with everything set, and with `autoStartJob`; the job status route; the API tool.
- [x] T7. Docs: production `AGENTS.md`, kanban rule, spec, PR description; lesson on guarding a state by its writers.
- [x] T8. Gates: Biome, typecheck (database, server-functions, erp, mes), tests, translations.

## Browser test (2026-10-19)

Stack on this worktree's own localhost ports (the portless proxy needs sudo, and another worktree held the shared ports). Company: Carbon Development, strict backflush and Prevent negative stock on.

| # | Case | Result |
|---|------|--------|
| 1 | Kanban scan, BUS-STR-001, every line has a bin | J000027 Ready, release date set, scheduled, outside operation on a new Draft PO; scan opened the operation in MES |
| 2 | Same kanban again | Collision page; no second job |
| 3 | Kanban scan, STRESS-BOM (no operations), auto-release + auto-start | J000028–J000031, J000036 stay Draft and linked; scan lands on the job, not MES |
| 4 | Kanban scan with BRG-6201's default storage unit cleared | J000033 Draft with one line without a bin; toast names BRG-6201 |
| 5 | Kanban scan after the default was restored | J000034 Ready; its outside operation went on the existing Draft PO000019 |
| 6 | Kanban scan with auto-start | J000035 started (In Progress) and opened in MES |
| 7 | Release dialog, J000033 | "Missing Storage Units: BRG-6201", Release Job disabled |
| 8 | Bulk release, J000033 | "Could not release 1: J000033 (set a Pull From storage unit on BRG-6201; …)" |
| 9 | Plain status post Ready, J000033 | Refused, stays Draft (the toast of a hand-built HTML form post was not seen) |
| 10 | API `updateJobStatus` Ready, J000033 | HTTP 400 `RELEASE_REFUSED`, names BRG-6201 |
| 11 | API `updateJobStatus` Ready, J000032 (clean) | HTTP 200, Ready |
| 12 | API Paused → Ready, J000005 | HTTP 200 (a resume is not a release); set back to Paused |
| 13 | Pause, then Resume in the job header, J000035 | Paused, then Ready |

Bugs found and fixed:
- The refusal toast never showed: `data(…, flash)` from the kanban loader was cleared by the root's `flashMiddleware`. Now `throw redirect(jobPage, flash)`.
- After the first kanban release created a Draft PO for the outside operation supplier, every later scan was refused with "choose a purchase order". The kanban release now reuses the supplier's newest Draft PO.
- Kanban collision "Remove Job" said "Job cancelled" but only unlinks the job. The copy now says "Job removed from the kanban".
- `crbn up --no-hibernate` left a stale `asleep` marker in place, and the dev servers held every request for 120 s. `crbn up` now clears it for its own stack.

Noted, not changed: an API key without Purchasing view gets "has no supplier" for an outside operation, because the check reads with the caller's permissions.
