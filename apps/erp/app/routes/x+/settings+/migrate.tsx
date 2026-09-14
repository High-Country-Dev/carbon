// Settings → Migrate (preview or run a one-click migration from another ERP,
// then keep it or revert).
import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  getMigrationSource,
  MIGRATION_SOURCES
} from "@carbon/migration/sources";
import { Heading, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useRevalidator } from "react-router";
import type { MigrationRun } from "~/modules/settings";
import { getIntegrations, getMigrationRun } from "~/modules/settings";
import {
  finalizeMigration,
  revertMigration,
  startMigration
} from "~/modules/settings/migration.server";
import {
  MigrationReport,
  MigrationRunRow,
  MigrationSourceCard
} from "~/modules/settings/ui/Migrations";
import { canAccessBackups } from "~/utils/backups";
import { path } from "~/utils/path";

export const handle = {
  breadcrumb: msg`Migrate`,
  to: path.to.migrate
};

function requireMigrationAccess(email: string | null) {
  // Same gate as Backups and Demo Data: a migration writes across a company's
  // whole dataset and snapshots it first, so it carries the same unhardened
  // multi-tenant caveats and stays internal-only in real deployments.
  if (!canAccessBackups(email)) {
    throw redirect(path.to.settings);
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, email } = await requirePermissions(request, {
    update: "settings"
  });
  requireMigrationAccess(email);

  const [run, integrations] = await Promise.all([
    getMigrationRun(client, companyId),
    getIntegrations(client, companyId)
  ]);

  const active = new Set(
    (integrations.data ?? [])
      .filter((integration) => integration.active === true)
      .map((integration) => integration.id)
  );

  // Read from the registry rather than a hardcoded list, so a new source shows
  // up here with no second edit. The loader is server-only, so importing the
  // registry never reaches the browser bundle.
  const sources = MIGRATION_SOURCES.map((source) => ({
    id: source.id,
    name: source.name,
    description: source.description,
    integrationId: source.integrationId,
    connected: active.has(source.integrationId)
  }));

  return { run: run.data, sources };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId, email } = await requirePermissions(
    request,
    { update: "settings" }
  );
  requireMigrationAccess(email);

  const formData = await request.formData();
  const intent = formData.get("intent");
  const migrationRunId = String(formData.get("migrationRunId") ?? "");

  switch (intent) {
    case "preview":
    case "migrate": {
      const sourceId = String(formData.get("sourceId") ?? "");
      const source = getMigrationSource(sourceId);
      if (!source) {
        return { success: false, message: "Unknown migration source" };
      }

      const integrations = await getIntegrations(client, companyId);
      const connected = (integrations.data ?? []).some(
        (integration) =>
          integration.id === source.integrationId && integration.active === true
      );
      if (!connected) {
        return {
          success: false,
          message: `Connect ${source.name} in Settings → Integrations first`
        };
      }

      // One change at a time. A second migration while one is still pending
      // review would overwrite the only snapshot of the company's real data.
      // The job refuses too — that one is authoritative; this is the nice error.
      const inFlight = await getMigrationRun(client, companyId);
      if (inFlight.data && inFlight.data.status !== "failed") {
        return {
          success: false,
          message: "Finish your current migration — keep or revert it — first."
        };
      }

      try {
        const startedRunId = await startMigration({
          companyId,
          userId,
          sourceId: source.id,
          dryRun: intent === "preview"
        });
        return {
          success: true,
          message:
            intent === "preview"
              ? `Previewing your ${source.name} data`
              : `Migrating from ${source.name}`,
          migrationRunId: startedRunId
        };
      } catch (err) {
        return {
          success: false,
          message:
            err instanceof Error ? err.message : "Failed to start the migration"
        };
      }
    }

    case "keep":
    case "dismiss": {
      if (!migrationRunId) {
        return { success: false, message: "Nothing to resolve" };
      }
      try {
        await finalizeMigration({ companyId, migrationRunId });
        return {
          success: true,
          message: intent === "keep" ? "Migration kept" : "Dismissed"
        };
      } catch (err) {
        return data(
          { success: false },
          await flash(request, error(err, "Failed to resolve the migration"))
        );
      }
    }

    case "revert": {
      if (!migrationRunId) {
        return { success: false, message: "Nothing to revert" };
      }
      try {
        await revertMigration({ companyId, userId, migrationRunId });
        return { success: true, message: "Reverting the migration" };
      } catch (err) {
        return data(
          { success: false },
          await flash(request, error(err, "Failed to revert the migration"))
        );
      }
    }

    default:
      return { success: false, message: "Unknown action" };
  }
}

export default function MigrateRoute() {
  const { run, sources } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();

  // Keep/Dismiss clear the marker through a job, so the row is hidden the moment
  // the user acts rather than a poll later. A REVERT is not resolved here — it
  // keeps running, and the row is the only thing reporting that it is.
  const [resolvedRunIds, setResolvedRunIds] = useState<string[]>([]);

  // Starting only ENQUEUES the job, so the fetcher goes idle a moment later with
  // no marker written yet. This stand-in holds the row until the loader sees a
  // real run, so the page never looks like the click did nothing.
  const [starting, setStarting] = useState(false);
  const hasRun = run !== null;
  useEffect(() => {
    if (hasRun) setStarting(false);
  }, [hasRun]);

  const optimisticRun: MigrationRun | null =
    !hasRun && starting
      ? {
          migrationRunId: "",
          sourceId: "",
          status: "running",
          startedAt: null,
          error: null,
          progress: null,
          dryRun: false,
          hasSnapshot: false,
          report: null
        }
      : null;

  const active = (run !== null && run.status !== "failed") || starting;
  const pending =
    (run !== null && !resolvedRunIds.includes(run.migrationRunId)
      ? run
      : null) ?? optimisticRun;

  // The loader is the only source of run state — this revalidate is what moves
  // the row from "reading your account" to Keep/Revert. The job throttles its
  // own marker writes, so a faster poll would only re-read the same row.
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => revalidator.revalidate(), 2500);
    return () => clearInterval(id);
  }, [active, revalidator]);

  const runSource = useMemo(
    () => sources.find((source) => source.id === pending?.sourceId) ?? null,
    [sources, pending]
  );

  // The catalog is the source's, not the harness's — a run reports the gaps of
  // the system it read from.
  const catalog = useMemo(
    () => getMigrationSource(pending?.sourceId ?? "")?.gaps ?? [],
    [pending]
  );

  return (
    <VStack spacing={4} className="p-8 w-full max-w-4xl mx-auto">
      <VStack spacing={1}>
        <Heading size="h3">
          <Trans>Migrate</Trans>
        </Heading>
        <p className="text-muted-foreground text-sm">
          <Trans>
            Move another ERP into Carbon in one click. Preview it first, see
            exactly what comes across and what does not, and put everything back
            if it isn't what you expected.
          </Trans>
        </p>
      </VStack>

      {pending && (
        <MigrationRunRow
          run={pending}
          sourceName={runSource?.name ?? pending.sourceId}
          onResolve={(id) => setResolvedRunIds((prev) => [...prev, id])}
        />
      )}

      {sources.map((source) => (
        <MigrationSourceCard
          key={source.id}
          source={source}
          disabled={active}
          onStart={setStarting}
        />
      ))}

      {pending?.report && (
        <MigrationReport
          report={pending.report}
          catalog={catalog}
          dryRun={pending.dryRun}
        />
      )}
    </VStack>
  );
}
