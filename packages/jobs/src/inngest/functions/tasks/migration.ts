import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { KyselyDatabase } from "@carbon/database/client";
import {
  type DetectedGap,
  loadMigrationPlan,
  planCounts,
  ScopeChoiceRequired
} from "@carbon/migration";
import { datetime } from "@carbon/utils";
import { NonRetriableError } from "inngest";
import type { Transaction } from "kysely";

import { applyTableRenames } from "../../../backups/renames";
import { getJobDatabaseClient } from "../../../db";
import { connectMigrationSource } from "../../../migration/connect";
import { inngest } from "../../client";
import {
  backupAssetsDir,
  backupDir,
  getCompanyTableCatalog,
  type JobProgress,
  readBackup,
  removeStoragePrefix,
  restoreAssetsFromBackup,
  throttleProgress,
  writeBackupManifest
} from "./company-backup";
import { buildCompanyBackup } from "./company-export";
import { resolveRestoreScope, wipeAndLoad } from "./company-restore";

/**
 * Migrate another ERP into this company, in one click.
 *
 * Three phases, one durable step: the SOURCE reads its own system and returns a
 * `MigrationPlan` (extract and map, both its business), and the HARNESS writes
 * that plan into Carbon inside a single transaction. This job owns neither —
 * it owns the lifecycle: the guard against a second run, the snapshot, the
 * progress the page reads, and the keep/revert decision at the end.
 *
 * Nothing here is specific to any one source. Adding a second source adds no
 * code to this file.
 *
 * Carbon only ever READS from a source. There is no write-back and no two-way
 * sync.
 */

export const MIGRATION_INTEGRATION = "migration";

// Migrate, finalize and revert all take this, so the three can never run
// concurrently for one company — each assumes the marker is its own.
const PER_COMPANY_CONCURRENCY = {
  key: "'migration-' + event.data.companyId",
  scope: "env",
  limit: 1
} as const;

type ServiceRole = ReturnType<typeof getCarbonServiceRole>;

type MigrationStatus = "running" | "ready" | "failed" | "reverting";

/** What the run report keeps per gap — the prose lives in the source's catalog. */
type MigrationGapSummary = {
  id: string;
  count: number | null;
  examples: string[];
};

type MigrationReport = {
  sourceId: string;
  accountId: string;
  scopeId: string | null;
  sandbox: boolean;
  /** Rows written per plan section. */
  counts: Record<
    string,
    { inserted: number; updated: number; skipped: number }
  >;
  /** Rows the plan HELD per section, whether or not they were written. */
  extracted: Record<string, number>;
  linked: number;
  warnings: string[];
  notes: string[];
  gaps: MigrationGapSummary[];
};

type MigrationMeta = {
  migrationRunId: string;
  sourceId: string;
  status: MigrationStatus;
  startedAt?: string;
  error?: string | null;
  /** Folder name of the pre-migration snapshot in this company's bucket. */
  snapshotPath?: string;
  /** Scope the forward migration covered, so a revert undoes exactly that. */
  includeGroup?: boolean;
  /** Live phase progress, so a run that takes minutes doesn't look hung. */
  progress?: JobProgress | null;
  /** True when the run only previewed — nothing was written. */
  dryRun?: boolean;
  report?: MigrationReport | null;
  /** Set when the source account holds several scopes and one must be chosen. */
  scopeChoices?:
    | { id: string; name: string; currencyCode: string | null }[]
    | null;
};

/**
 * One marker row per company, whatever the source. The partial unique index on
 * ("integration","externalId","entityType","companyId") rejects a second row for
 * the same company outright, so identity lives in `metadata.migrationRunId` —
 * and the one-at-a-time rule the page depends on falls out of the schema rather
 * than being enforced by hand.
 */
async function readMigrationMarker(
  client: ServiceRole,
  companyId: string
): Promise<{ id: string; metadata: MigrationMeta } | null> {
  const marker = await client
    .from("externalIntegrationMapping")
    .select("id, metadata")
    .eq("integration", MIGRATION_INTEGRATION)
    .eq("companyId", companyId)
    .maybeSingle();

  if (marker.error) {
    throw new Error(
      `Failed to read the migration marker: ${marker.error.message}`
    );
  }
  if (!marker.data) return null;
  return {
    id: marker.data.id,
    metadata: (marker.data.metadata ?? {}) as MigrationMeta
  };
}

/**
 * Upsert the marker, merging `patch` into its metadata.
 *
 * Errors throw: a marker that silently failed to write is worse than none,
 * because the page reads a missing marker as "the migration never ran".
 */
async function writeMigrationMarker(
  client: ServiceRole,
  args: {
    companyId: string;
    userId: string;
    migrationRunId: string;
    sourceId: string;
    patch: Partial<MigrationMeta>;
  }
): Promise<void> {
  const { companyId, userId, migrationRunId, sourceId, patch } = args;
  const existing = await readMigrationMarker(client, companyId);

  const metadata: MigrationMeta = {
    status: "running",
    ...existing?.metadata,
    ...patch,
    // LAST: the marker is looked up by companyId alone, so merged earlier a
    // previous failed run's id would shadow this one's and the Keep/Revert
    // buttons would post the wrong run.
    migrationRunId,
    sourceId
  };

  const written = existing
    ? await client
        .from("externalIntegrationMapping")
        .update({ metadata })
        .eq("id", existing.id)
        .eq("companyId", companyId)
    : await client.from("externalIntegrationMapping").insert({
        entityType: "migration",
        entityId: companyId,
        integration: MIGRATION_INTEGRATION,
        externalId: "",
        metadata,
        companyId,
        createdBy: userId
      });

  if (written.error) {
    throw new Error(
      `Failed to write the migration marker: ${written.error.message}`
    );
  }
}

async function clearMigrationMarker(
  client: ServiceRole,
  companyId: string
): Promise<void> {
  const deleted = await client
    .from("externalIntegrationMapping")
    .delete()
    .eq("integration", MIGRATION_INTEGRATION)
    .eq("companyId", companyId);

  if (deleted.error) {
    throw new Error(
      `Failed to clear the migration marker: ${deleted.error.message}`
    );
  }
}

/**
 * Throttled progress writer.
 *
 * The whole migration is ONE durable step lasting minutes, so this marker is the
 * only thing the page can read while it works. The write goes over supabase-js
 * on its own connection, which is why it is safe to call from inside the load
 * transaction.
 */
function makeProgressReporter(
  client: ServiceRole,
  args: {
    companyId: string;
    userId: string;
    migrationRunId: string;
    sourceId: string;
  }
): (progress: JobProgress) => Promise<void> {
  return throttleProgress((progress) =>
    writeMigrationMarker(client, { ...args, patch: { progress } })
  );
}

/** Thrown to roll a dry run's transaction back once the load has proved itself. */
class DryRunRollback extends Error {
  readonly result: Awaited<ReturnType<typeof loadMigrationPlan>>;

  constructor(result: Awaited<ReturnType<typeof loadMigrationPlan>>) {
    super("dry run");
    this.name = "DryRunRollback";
    this.result = result;
  }
}

function summarizeGaps(gaps: DetectedGap[]): MigrationGapSummary[] {
  return gaps.map((gap) => ({
    id: gap.id,
    count: gap.count,
    examples: gap.examples
  }));
}

export const migrationFunction = inngest.createFunction(
  {
    id: "migration",
    // One retry only. A migration is not idempotent to RE-RUN blindly — it is
    // idempotent by external id, which is a different thing: a retry after a
    // partial read starts the source read from scratch, which is correct but slow.
    retries: 1,
    // The unkeyed limit bounds how many companies migrate at once, because each
    // run holds a database connection for a whole transaction.
    concurrency: [{ limit: 2 }, PER_COMPANY_CONCURRENCY]
  },
  { event: "carbon/migration" },
  async ({ event, step, logger }) => {
    const {
      companyId,
      userId,
      migrationRunId,
      sourceId,
      scopeId = null,
      dryRun = false
    } = event.data;

    return await step.run("run-migration", async () => {
      const client = getCarbonServiceRole();

      // One change at a time. A second migration while one is still pending
      // review would overwrite the only snapshot of the company's real data.
      const existing = await readMigrationMarker(client, companyId);
      if (
        existing &&
        existing.metadata.migrationRunId !== migrationRunId &&
        existing.metadata.status !== "failed"
      ) {
        throw new NonRetriableError(
          "A migration is already pending — keep or revert it first."
        );
      }

      await writeMigrationMarker(client, {
        companyId,
        userId,
        migrationRunId,
        sourceId,
        patch: {
          status: "running",
          startedAt: datetime.timestamp(),
          error: null,
          dryRun,
          report: null,
          scopeChoices: null,
          progress: null
        }
      });

      const report = makeProgressReporter(client, {
        companyId,
        userId,
        migrationRunId,
        sourceId
      });
      const db = getJobDatabaseClient(2);

      try {
        // ── Connect ──────────────────────────────────────────────────────────
        await report({ phase: "connect", done: 0, total: 1 });
        const { source, connection } = await connectMigrationSource({
          companyId,
          sourceId
        });
        await report({ phase: "connect", done: 1, total: 1 });

        // ── Read (the source's extract + map) ────────────────────────────────
        const { plan, gaps, notes } = await connection.read({
          scopeId,
          onProgress: (progress) => report(progress),
          log: (message) =>
            logger.info(message, { companyId, migrationRunId, sourceId })
        });

        // ── Snapshot ─────────────────────────────────────────────────────────
        // Reused, never retaken: an attempt that ran after the load committed
        // would capture the MIGRATED state and destroy the pre-migration copy.
        let snapshotPath = existing?.metadata.snapshotPath ?? undefined;
        let includeGroup = existing?.metadata.includeGroup ?? false;

        if (!dryRun && !snapshotPath) {
          const scope = await resolveRestoreScope(client, companyId);
          includeGroup = scope.includeGroup;
          snapshotPath = `_pre-migration-${migrationRunId}`;

          const snap = await buildCompanyBackup(client, db, {
            companyId,
            userId,
            label: `Before ${source.name} migration ${migrationRunId}`,
            includeStorage: "all",
            name: snapshotPath,
            onProgress: (progress) => report({ ...progress, phase: "snapshot" })
          });
          await writeBackupManifest(
            client,
            companyId,
            snapshotPath,
            snap.manifest
          );
          await writeMigrationMarker(client, {
            companyId,
            userId,
            migrationRunId,
            sourceId,
            patch: { snapshotPath, includeGroup }
          });
        }

        // ── Load ─────────────────────────────────────────────────────────────
        // One transaction for the whole plan: a failure in the last section
        // rolls back the first. A half-migrated company — customers but no
        // items, orders pointing at items that do not exist — is not a state
        // anybody could reason about, let alone clean up.
        let loadResult: Awaited<ReturnType<typeof loadMigrationPlan>>;
        try {
          loadResult = await db.transaction().execute(async (trx) => {
            const result = await loadMigrationPlan(
              trx as Transaction<KyselyDatabase>,
              {
                companyId,
                userId,
                sourceId,
                plan,
                onProgress: (progress) =>
                  report({ ...progress, phase: "load" }),
                log: (message) =>
                  logger.info(message, { companyId, migrationRunId })
              }
            );
            // A dry run takes the SAME path and then refuses to commit. A
            // preview that ran different code would prove nothing about the
            // migration it is previewing.
            if (dryRun) throw new DryRunRollback(result);
            return result;
          });
        } catch (error) {
          if (!(error instanceof DryRunRollback)) throw error;
          loadResult = error.result;
        }

        const runReport: MigrationReport = {
          sourceId: source.id,
          accountId: connection.accountId,
          scopeId,
          sandbox: connection.sandbox,
          counts: loadResult.counts,
          extracted: planCounts(plan),
          linked: loadResult.linked,
          warnings: loadResult.warnings,
          notes,
          gaps: summarizeGaps(gaps)
        };

        await writeMigrationMarker(client, {
          companyId,
          userId,
          migrationRunId,
          sourceId,
          patch: {
            status: "ready",
            progress: null,
            report: runReport,
            error: null
          }
        });

        return { migrationRunId, sourceId, dryRun, counts: loadResult.counts };
      } catch (error) {
        // An account with several scopes needs a DECISION, not a retry: the
        // choices go on the marker so the page can render them.
        if (error instanceof ScopeChoiceRequired) {
          await writeMigrationMarker(client, {
            companyId,
            userId,
            migrationRunId,
            sourceId,
            patch: {
              status: "failed",
              progress: null,
              error: error.message,
              scopeChoices: error.scopes
            }
          });
          throw new NonRetriableError(error.message);
        }

        await writeMigrationMarker(client, {
          companyId,
          userId,
          migrationRunId,
          sourceId,
          patch: {
            status: "failed",
            progress: null,
            error:
              error instanceof Error ? error.message : "The migration failed"
          }
        });
        throw error;
      }
    });
  }
);

/**
 * Keep a finished migration — drop the pre-migration snapshot, then clear the
 * marker. Backs BOTH the Keep button (on `ready`) and Dismiss (on `failed`):
 * the same operation under two labels.
 */
export const migrationFinalizeFunction = inngest.createFunction(
  {
    id: "migration-finalize",
    retries: 1,
    concurrency: PER_COMPANY_CONCURRENCY
  },
  { event: "carbon/migration-finalize" },
  async ({ event, step }) => {
    const { companyId, migrationRunId } = event.data;

    return await step.run("finalize-migration", async () => {
      const client = getCarbonServiceRole();
      const marker = await readMigrationMarker(client, companyId);
      if (!marker) return { migrationRunId, resolved: false };

      const { status, snapshotPath } = marker.metadata;
      if (status !== "ready" && status !== "failed") {
        throw new NonRetriableError(
          `Cannot resolve a migration that is ${status}`
        );
      }

      if (snapshotPath) {
        await removeStoragePrefix(client, companyId, backupDir(snapshotPath));
      }
      await clearMigrationMarker(client, companyId);

      return { migrationRunId, resolved: true };
    });
  }
);

/**
 * Undo a migration by reloading the pre-migration snapshot.
 *
 * On failure the snapshot stays on the marker so the revert can be retried — a
 * bare row-delete from app code would strand the only copy of the company's
 * pre-migration data in the bucket with nothing pointing at it.
 */
export const migrationRevertFunction = inngest.createFunction(
  { id: "migration-revert", retries: 1, concurrency: PER_COMPANY_CONCURRENCY },
  { event: "carbon/migration-revert" },
  async ({ event, step, logger }) => {
    const { companyId, userId, migrationRunId } = event.data;

    return await step.run("revert-migration", async () => {
      const client = getCarbonServiceRole();
      const marker = await readMigrationMarker(client, companyId);
      const snapshotPath = marker?.metadata.snapshotPath;
      const sourceId = marker?.metadata.sourceId ?? "";

      if (!snapshotPath) {
        // Deliberately not a silent no-op: the user pressed Revert and is owed
        // an answer about why nothing happened.
        logger.error("No snapshot to revert to", { companyId, migrationRunId });
        await writeMigrationMarker(client, {
          companyId,
          userId,
          migrationRunId,
          sourceId,
          patch: {
            status: "failed",
            progress: null,
            error:
              "No snapshot was recorded for this run, so it cannot be reverted."
          }
        });
        return { migrationRunId, reverted: false };
      }

      await writeMigrationMarker(client, {
        companyId,
        userId,
        migrationRunId,
        sourceId,
        patch: {
          status: "reverting",
          startedAt: datetime.timestamp(),
          progress: null
        }
      });

      const db = getJobDatabaseClient(2);
      const report = makeProgressReporter(client, {
        companyId,
        userId,
        migrationRunId,
        sourceId
      });

      try {
        const rawSnapshot = await readBackup(client, companyId, snapshotPath);
        const { targetGroupId } = await resolveRestoreScope(client, companyId);
        const catalog = await getCompanyTableCatalog(db);
        // The snapshot predates any database migration that has run since it was taken.
        const snapshot = applyTableRenames(catalog, rawSnapshot);

        const { rows, idRewrite } = await wipeAndLoad(db, catalog, snapshot, {
          companyId,
          userId: "",
          remap: false,
          includeGroup: marker?.metadata.includeGroup ?? false,
          targetGroupId,
          onProgress: report
        });

        await report({ phase: "files", done: 0, total: 1 });
        await restoreAssetsFromBackup(client, {
          files: snapshot.manifest.storage,
          srcBucket: companyId,
          srcPrefix: backupAssetsDir(snapshotPath),
          sourceCompanyId: companyId,
          companyId,
          idRewrite
        });

        await removeStoragePrefix(client, companyId, backupDir(snapshotPath));
        await clearMigrationMarker(client, companyId);

        return { migrationRunId, reverted: true, rows };
      } catch (error) {
        await writeMigrationMarker(client, {
          companyId,
          userId,
          migrationRunId,
          sourceId,
          patch: {
            status: "failed",
            progress: null,
            error: `Revert failed: ${error instanceof Error ? error.message : "unknown error"}`
          }
        });
        throw error;
      }
    });
  }
);
