# @carbon/dev

Developer CLI (`crbn` command) — worktree management, Docker Compose stacks, migrations, portless dev URLs, and app lifecycle.

## Always

- **Use the `crbn` CLI for stack operations** — `crbn up` boots Docker + apps, `crbn down` tears down, `crbn new` creates worktrees, `crbn status` shows state
- **Bash router handles `checkout`** — the `bin/crbn` shell script routes lightweight commands; heavy commands delegate to `tsx packages/dev/src/main.ts` (citty)
- **Respect the slot system** — `resolveSlot()` / `getSlot()` manage port allocation per worktree to avoid conflicts
- **Guard platform compatibility** — `bin/crbn` validates OS (POSIX only: Linux, macOS, WSL, Git Bash) and Node 22+

## Ask First

- Changing Docker Compose service definitions or port mappings
- Modifying the portless proxy setup (`services/portless.ts`)
- Adding new `crbn` subcommands (register in `src/main.ts` `subCommands`)

## Never

- Run `crbn up` without Docker running — it calls `ensureDockerRunning()` first
- Hardcode ports — use the slot/worktree resolution system
- Skip migrations on stack boot unless explicitly passing `--no-migrate`

## Validation Commands

```bash
pnpm --filter @carbon/dev test        # vitest
pnpm --filter @carbon/dev typecheck   # tsgo --noEmit
```

## Key Patterns

- **Commands**: `up`, `down` (`--purge` releases the slot), `new`, `init`, `remove`, `list`, `status`, `reset`, `migrate`, `restore`, `transcripts`, `copy` (env sync), `reload` (`crbn reload <service...>` → `docker compose up -d --force-recreate` a subset, applying compose/`.env.local` edits without restarting the app dev servers)
- **Restore** (`commands/restore.ts`): `crbn restore <file>` wraps `scripts/restore-database.sh` (the SQL is deliberately NOT ported) and adds worktree/`PORT_DB` resolution, a confirmation gate, and the trailing `applyMigrations` + `db:types`. The script truncates the local `supabase_migrations` ledger before restoring so the dump's own ledger lands — the ledger must travel WITH the schema, else the dump's older schema pairs with the local newer ledger and the trailing migrate step silently no-ops (leaving weeks of migrations missing while the ledger claims them applied). It deliberately does NOT boot a postgres-only stack the way `crbn migrate` does — a restore rewrites `auth`/`storage`, whose schemas GoTrue and Storage build via their own migrations, so it requires a fully booted stack (`serviceSchemasReady` probes for GoTrue's `auth.users.email_confirmed_at` AND `storage.objects`/`storage.buckets` — the restore script's `to_regclass` guards mean a missing Storage schema would otherwise let the restore finish with no buckets seeded) and refuses otherwise — the backup carries the SOURCE schema, which is usually behind the branch. **`--scrub-emails` defaults ON here, inverting the script's opt-in default**, so a restore cannot drop real customer addresses into a local DB unless asked. By default the script truncates `storage.objects` (kept rows would point at files that live only in the source environment's backend, so downloads 404); pass `--keep-storage-objects` to retain them and the dump's buckets when you need realistic storage metadata, e.g. profiling storage RLS.
- **Transcripts** (`transcripts.ts` + `commands/transcripts.ts`): `crbn transcripts` attaches the Claude Code prompts behind a branch to its PR. Sessions are joined to a PR by BRANCH — every entry in `~/.claude/projects/<mangled-cwd>/<sessionId>.jsonl` carries `gitBranch` and `cwd`, and scoping uses every `git worktree` path, not just the main checkout, or a branch developed in a linked worktree finds nothing. The filtering is the whole tool: `type: "user"` is the transport for tool results and harness-injected context as well as typed prompts (this repo's own session: 43 `user` entries, 42 of them tool results), so `extractUserText` rejects on `isSidechain`, `isMeta`, `toolUseResult`, a `tool_result` block, and a non-`human` `origin.kind` — several independent checks because older transcripts have no `origin` and the structural ones must stand alone. `cleanUserText` then strips `<system-reminder>` and friends, and renders a slash command back as the `/name args` the person typed. Dedupes by entry uuid across files: a resumed session replays its parent's entries under the same uuids. Posting is opt-in (`--post`) behind a confirmation — a transcript on a public PR cannot be un-sent — and re-runs PATCH the comment carrying `TRANSCRIPT_MARKER` rather than stacking new ones. `renderForComment` tightens per-message truncation before dropping whole sessions oldest-first, and says so in the body, because GitHub hard-rejects a comment over 65536 chars. Local-only by necessity: CI cannot read `~/.claude`.
- **Stack boot** (`commands/up.ts`): Docker Compose → wait Postgres → migrations → regen types → spawn apps → portless aliases
- **Provision** (`commands/init.ts`): `crbn init` provisions an already-created worktree (canonical slug + env sync + skills) to match a `crbn checkout`; shared by `new`, the bash `checkout` post-create hook, and Conductor's `setup` (`.conductor/settings.toml`). It does NOT boot the stack — `crbn up` still mints ports/`.env.local`.
- **Worktree** (`worktree.ts`): `resolveSlug()`, `canonicalSlug()` (branch-derived `<repoBase>-<branch>`), `getWorktreeRoot()`, `projectName()`, `ensureSlugAvailable()`
- **Services**: `compose.ts` (Docker), `migrations.ts` (Postgres/Supabase), `portless.ts` (`.dev` URLs), `apps.ts` (dev servers)
- **Aux spawners** (`services/apps.ts`): `spawnAssembler` (cargo) and `spawnEmailPreview` (`@carbon/documents` `email:previews` on `PORT_EMAIL` — the react-email server over `src/email/previews`, one fixture per email) — opt-in picker apps with their own spawners, not react-router dev servers
- **Env**: `env.ts` — `renderEnv()`, `writeEnv()`, `syncAppPortlessConfigs()`
- **`--run` flag**: scopes stack lifetime to a command (for headless/CI builds); `--volumes` cleans up Docker volumes on teardown

## Cross-References

- `packages/harness/` — uses `crbn up --run` for headless agent builds
- `packages/database/` — migrations applied during `crbn up`
- `docker/` — Compose files consumed by the stack boot
