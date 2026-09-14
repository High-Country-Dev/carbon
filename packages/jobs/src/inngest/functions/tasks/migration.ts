import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { KyselyDatabase } from "@carbon/database/client";
import {
  type DetectedGap,
  loadMigrationPlan,
  planCounts
} from "@carbon/migration";
import { datetime } from "@carbon/utils";
import { NonRetriableError } from "inngest";
import type { Transaction } from "kysely";

import { applyTableRenames } from "../../../backups/renames";
import { getJobDatabaseClient } from "../../../db";
import {
  nameCompanyGroup,
  resolveMigrationTargets
} from "../../../migration/companies";
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
 * Migrate another ERP into this company group, in one click.
 *
 * A source account is a group of legal entities — NetSuite subsidiaries, an
 * accounting org's tenants — and Carbon models that as a `companyGroup` holding
 * a tree of companies. So a run is one company PER SCOPE: the company the user
 * pressed Migrate in takes the root, the rest are provisioned underneath it, and
 * the group takes the source account's name.
 *
 * Per scope the SOURCE reads its own system and returns a `MigrationPlan`
 * (extract and map, both its business), and the HARNESS writes that plan into
 * that scope's company. This job owns neither — it owns the lifecycle: the guard
 * against a second run, the snapshots, the progress the page reads, and the
 * keep/revert decision at the end.
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

/** What one scope's company ended up with. */
type MigrationCompanyResult = {
  companyId: string;
  companyName: string;
  scopeId: string;
  scopeName: string;
  /** True when THIS run created the company — the only ones a revert deletes. */
  created: boolean;
  /** Rows written per plan section. */
  counts: Record<
    string,
    { inserted: number; updated: number; skipped: number }
  >;
  /** Rows the plan HELD per section, whether or not they were written. */
  extracted: Record<string, number>;
  linked: number;
  warnings: string[];
};

type MigrationReport = {
  sourceId: string;
  accountId: string;
  /** What the source account calls itself — it names the company group. */
  accountName: string;
  sandbox: boolean;
  companies: MigrationCompanyResult[];
  /** Scopes that got no company of their own, and why. */
  skippedScopes: { scopeId: string; name: string; reason: string }[];
  notes: string[];
  gaps: MigrationGapSummary[];
};

type MigrationMeta = {
  migrationRunId: string;
  sourceId: string;
  status: MigrationStatus;
  startedAt?: string;
  error?: string | null;
  /**
   * The companies this run touched, and how to undo each: a snapshot for the
   * ones that already existed, a delete for the ones it created.
   */
  companies?: {
    companyId: string;
    companyName: string;
    created: boolean;
    snapshotPath?: string;
    includeGroup?: boolean;
  }[];
  /** Live phase progress, so a run that takes minutes doesn't look hung. */
  progress?: JobProgress | null;
  /** True when the run only previewed — nothing was written. */
  dryRun?: boolean;
  report?: MigrationReport | null;
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
          companies: [],
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

        // ── Map the source's entities onto Carbon companies ──────────────────
        const scopes = await connection.listScopes();
        const { targets, companyGroupId, skipped } =
          await resolveMigrationTargets({
            homeCompanyId: companyId,
            userId,
            sourceId,
            scopes,
            // Preview names the companies it WOULD create without creating
            // them: provisioning runs through an edge function, which is not in
            // any transaction and so cannot be rolled back with the data.
            provision: !dryRun
          });

        if (!dryRun) {
          await nameCompanyGroup({
            companyGroupId,
            accountName: connection.accountName,
            homeCompanyName:
              targets.find((target) => target.companyId === companyId)
                ?.companyName ?? ""
          });
        }

        await report({ phase: "connect", done: 1, total: 1 });

        // Record what a revert has to undo BEFORE any data is written: a run
        // that dies mid-way still has to be reversible, and a company created
        // without a marker entry is one nothing would ever clean up.
        const undo = targets
          .filter((target) => target.companyId !== "")
          .map((target) => ({
            companyId: target.companyId,
            companyName: target.companyName,
            created: target.created
          }));
        if (!dryRun) {
          await writeMigrationMarker(client, {
            companyId,
            userId,
            migrationRunId,
            sourceId,
            patch: { companies: undo }
          });
        }

        // ── One company at a time ────────────────────────────────────────────
        const results: MigrationCompanyResult[] = [];
        const allNotes: string[] = [];
        let allGaps: ReturnType<typeof summarizeGaps> = [];
        const snapshotPaths = new Map<string, string>();

        for (let i = 0; i < targets.length; i += 1) {
          const target = targets[i];
          if (!target) continue;
          await report({ phase: "company", done: i, total: targets.length });

          // A company this run would have created does not exist during a
          // preview, so there is nowhere to load it. Its plan is still read and
          // reported, which is what makes the preview worth reading.
          const canLoad = target.companyId !== "";

          const { plan, gaps, notes } = await connection.read({
            scopeId: target.scope.id || null,
            onProgress: (progress) => report(progress),
            log: (message) =>
              logger.info(message, {
                companyId: target.companyId,
                migrationRunId,
                sourceId
              })
          });
          allNotes.push(...notes);
          // Every scope reads the same account, so the gaps are the account's,
          // not the scope's — the last read wins rather than N duplicates.
          allGaps = summarizeGaps(gaps);

          if (!canLoad) {
            results.push({
              companyId: "",
              companyName: target.companyName,
              scopeId: target.scope.id,
              scopeName: target.scope.name,
              created: true,
              counts: {},
              extracted: planCounts(plan),
              linked: 0,
              warnings: []
            });
            continue;
          }

          // ── Snapshot ───────────────────────────────────────────────────────
          // Only a company that already held data needs one; a company this run
          // created is undone by deleting it. Reused, never retaken: an attempt
          // that ran after the load committed would capture the MIGRATED state
          // and destroy the pre-migration copy.
          let snapshotPath = existing?.metadata.companies?.find(
            (entry) => entry.companyId === target.companyId
          )?.snapshotPath;

          if (!dryRun && !target.created && !snapshotPath) {
            const restoreScope = await resolveRestoreScope(
              client,
              target.companyId
            );
            snapshotPath = `_pre-migration-${migrationRunId}`;

            const snap = await buildCompanyBackup(client, db, {
              companyId: target.companyId,
              userId,
              label: `Before ${source.name} migration ${migrationRunId}`,
              includeStorage: "all",
              name: snapshotPath,
              onProgress: (progress) =>
                report({ ...progress, phase: "snapshot" })
            });
            await writeBackupManifest(
              client,
              target.companyId,
              snapshotPath,
              snap.manifest
            );
            snapshotPaths.set(target.companyId, snapshotPath);
            await writeMigrationMarker(client, {
              companyId,
              userId,
              migrationRunId,
              sourceId,
              patch: {
                companies: undo.map((entry) =>
                  entry.companyId === target.companyId
                    ? {
                        ...entry,
                        snapshotPath,
                        includeGroup: restoreScope.includeGroup
                      }
                    : entry
                )
              }
            });
          }

          // ── Load ───────────────────────────────────────────────────────────
          // One transaction PER COMPANY. Companies are independent tenants with
          // no foreign keys between them, so that is the natural unit of
          // atomicity — and a single transaction spanning all of them would hold
          // one connection open for the length of the whole migration.
          let loadResult: Awaited<ReturnType<typeof loadMigrationPlan>>;
          try {
            loadResult = await db.transaction().execute(async (trx) => {
              const result = await loadMigrationPlan(
                trx as Transaction<KyselyDatabase>,
                {
                  companyId: target.companyId,
                  userId,
                  sourceId,
                  plan,
                  onProgress: (progress) =>
                    report({ ...progress, phase: "load" }),
                  log: (message) =>
                    logger.info(message, {
                      companyId: target.companyId,
                      migrationRunId
                    })
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

          results.push({
            companyId: target.companyId,
            companyName: target.companyName,
            scopeId: target.scope.id,
            scopeName: target.scope.name,
            created: target.created,
            counts: loadResult.counts,
            extracted: planCounts(plan),
            linked: loadResult.linked,
            warnings: loadResult.warnings
          });
        }

        await report({
          phase: "company",
          done: targets.length,
          total: targets.length
        });

        const runReport: MigrationReport = {
          sourceId: source.id,
          accountId: connection.accountId,
          accountName: connection.accountName,
          sandbox: connection.sandbox,
          companies: results,
          skippedScopes: skipped,
          notes: [...new Set(allNotes)],
          gaps: allGaps
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

        return { migrationRunId, sourceId, dryRun, companies: results.length };
      } catch (error) {
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

      const { status, companies = [] } = marker.metadata;
      if (status !== "ready" && status !== "failed") {
        throw new NonRetriableError(
          `Cannot resolve a migration that is ${status}`
        );
      }

      // Every company's snapshot, not just the one the run was started from.
      for (const entry of companies) {
        if (!entry.snapshotPath) continue;
        await removeStoragePrefix(
          client,
          entry.companyId,
          backupDir(entry.snapshotPath)
        );
      }
      await clearMigrationMarker(client, companyId);

      return { migrationRunId, resolved: true, companies: companies.length };
    });
  }
);

/**
 * Undo a migration.
 *
 * Two different undos, because the run did two different things. A company that
 * already existed is put back from its snapshot; a company this run CREATED is
 * deleted, because there is no earlier state to restore it to. Only companies
 * the marker recorded as created are ever deleted — anything else would be this
 * feature destroying a company somebody set up themselves.
 *
 * On failure the marker keeps its snapshots so the revert can be retried — a
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
      const companies = marker?.metadata.companies ?? [];
      const sourceId = marker?.metadata.sourceId ?? "";
      const hasSomethingToUndo = companies.some(
        (entry) => entry.snapshotPath || entry.created
      );

      if (!hasSomethingToUndo) {
        // Deliberately not a silent no-op: the user pressed Revert and is owed
        // an answer about why nothing happened.
        logger.error("Nothing recorded to revert", {
          companyId,
          migrationRunId
        });
        await writeMigrationMarker(client, {
          companyId,
          userId,
          migrationRunId,
          sourceId,
          patch: {
            status: "failed",
            progress: null,
            error:
              "Nothing was recorded for this run, so there is nothing to put back."
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
        const catalog = await getCompanyTableCatalog(db);
        let rows = 0;

        // Restore first, delete second. A created company holds nothing worth
        // keeping, but a restore that failed half-way would leave the group
        // short of a company AND short of its data.
        for (const entry of companies) {
          if (!entry.snapshotPath) continue;

          const rawSnapshot = await readBackup(
            client,
            entry.companyId,
            entry.snapshotPath
          );
          const { targetGroupId } = await resolveRestoreScope(
            client,
            entry.companyId
          );
          // The snapshot predates any database migration that has run since it
          // was taken.
          const snapshot = applyTableRenames(catalog, rawSnapshot);

          const loaded = await wipeAndLoad(db, catalog, snapshot, {
            companyId: entry.companyId,
            userId: "",
            remap: false,
            includeGroup: entry.includeGroup ?? false,
            targetGroupId,
            onProgress: report
          });
          rows += loaded.rows;

          await report({ phase: "files", done: 0, total: 1 });
          await restoreAssetsFromBackup(client, {
            files: snapshot.manifest.storage,
            srcBucket: entry.companyId,
            srcPrefix: backupAssetsDir(entry.snapshotPath),
            sourceCompanyId: entry.companyId,
            companyId: entry.companyId,
            idRewrite: loaded.idRewrite
          });

          await removeStoragePrefix(
            client,
            entry.companyId,
            backupDir(entry.snapshotPath)
          );
        }

        const created = companies.filter((entry) => entry.created);
        for (const entry of created) {
          await report({ phase: "companies", done: 0, total: created.length });
          // A plain delete: every company-scoped table cascades from
          // `company.id`, which is the same thing Settings → Companies does.
          const deleted = await client
            .from("company")
            .delete()
            .eq("id", entry.companyId);
          if (deleted.error) {
            throw new Error(
              `Could not remove the company created for "${entry.companyName}": ${deleted.error.message}`
            );
          }
        }

        await clearMigrationMarker(client, companyId);

        return {
          migrationRunId,
          reverted: true,
          rows,
          deletedCompanies: created.length
        };
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
