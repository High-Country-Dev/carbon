import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { resolveIntegrationSecrets } from "@carbon/ee";
import {
  getMigrationSource,
  type MigrationSource,
  type SourceConnection,
  SourceNotConnectedError
} from "@carbon/migration";

/**
 * Open a connection to a migration source for one company.
 *
 * Credentials never travel in the Inngest event payload — an event body is
 * stored in run history and rendered in the Inngest dashboard, which is not a
 * place for a customer's private key. They are resolved here instead, from
 * `companyIntegration.metadata` plus Supabase Vault, with a service-role client
 * because the vault RPCs accept nothing else.
 *
 * This is the ONLY part of a migration that knows about Carbon's integration
 * storage, which is why it lives in `@carbon/jobs` and not in the harness: the
 * harness takes resolved metadata and asks no questions about where it came from.
 */
export async function connectMigrationSource(args: {
  companyId: string;
  sourceId: string;
}): Promise<{ source: MigrationSource; connection: SourceConnection }> {
  const source = getMigrationSource(args.sourceId);
  if (!source) {
    throw new SourceNotConnectedError(
      args.sourceId,
      `"${args.sourceId}" is not a migration source Carbon knows about.`
    );
  }

  const client = getCarbonServiceRole();

  const integration = await client
    .from("companyIntegration")
    .select("metadata, secretRef, active")
    .eq("id", source.integrationId)
    .eq("companyId", args.companyId)
    .maybeSingle();

  if (integration.error) {
    throw new Error(
      `Could not read the ${source.name} integration: ${integration.error.message}`
    );
  }
  if (!integration.data?.active) {
    throw new SourceNotConnectedError(
      source.id,
      `${source.name} is not connected for this company — connect it in Settings → Integrations first.`
    );
  }

  const metadata = (await resolveIntegrationSecrets(
    client,
    args.companyId,
    source.integrationId,
    integration.data.metadata,
    integration.data.secretRef
  )) as Record<string, unknown>;

  return { source, connection: await source.connect(metadata) };
}
