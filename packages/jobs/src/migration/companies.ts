import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { type MigrationScope, planScopePlacements } from "@carbon/migration";

/**
 * Which Carbon company each source scope migrates into.
 *
 * A source account's scopes are its legal entities — NetSuite subsidiaries, an
 * accounting org's tenants. Carbon models exactly that: a `companyGroup` holding
 * a tree of companies linked by `parentCompanyId`. So the mapping is one
 * company per scope, all in the group the user started from, with the source's
 * own hierarchy rebuilt rather than flattened.
 *
 * Provisioning goes through the SAME path the app's Settings → Companies screen
 * uses — a `company` insert plus the `seed-company` edge function — so a migrated
 * company is indistinguishable from one somebody created by hand. That function
 * already knows how to add a subsidiary to an existing group: it inherits the
 * parent's `companyGroupId`, reuses the group's chart of accounts instead of
 * seeding a second one, and creates the group's elimination entity itself.
 */

type ServiceRole = ReturnType<typeof getCarbonServiceRole>;

export type MigrationTarget = {
  scope: MigrationScope;
  companyId: string;
  companyName: string;
  /** True when THIS run created the company — the only ones a revert may delete. */
  created: boolean;
};

/**
 * The entity type scope↔company links are filed under in
 * `externalIntegrationMapping`. A re-run resolves the same company for the same
 * subsidiary through it, which is what stops a second run creating duplicates.
 */
const COMPANY_ENTITY_TYPE = "company";

async function readScopeLinks(
  client: ServiceRole,
  args: { companyIds: string[]; sourceId: string }
): Promise<Map<string, string>> {
  if (args.companyIds.length === 0) return new Map();

  const links = await client
    .from("externalIntegrationMapping")
    .select("entityId, externalId")
    .eq("integration", args.sourceId)
    .eq("entityType", COMPANY_ENTITY_TYPE)
    .in("companyId", args.companyIds);

  if (links.error) {
    throw new Error(`Could not read company links: ${links.error.message}`);
  }

  const byScope = new Map<string, string>();
  for (const link of links.data ?? []) {
    if (link.externalId && link.entityId)
      byScope.set(link.externalId, link.entityId);
  }
  return byScope;
}

async function linkScope(
  client: ServiceRole,
  args: { companyId: string; userId: string; sourceId: string; scopeId: string }
): Promise<void> {
  const now = new Date().toISOString();
  const written = await client.from("externalIntegrationMapping").upsert(
    {
      entityType: COMPANY_ENTITY_TYPE,
      entityId: args.companyId,
      integration: args.sourceId,
      externalId: args.scopeId,
      allowDuplicateExternalId: false,
      companyId: args.companyId,
      createdBy: args.userId,
      updatedAt: now,
      lastSyncedAt: now
    },
    { onConflict: "entityType,entityId,integration,companyId" }
  );

  if (written.error) {
    throw new Error(
      `Could not link a company to its subsidiary: ${written.error.message}`
    );
  }
}

/**
 * Provision one company for a scope, the way the app does it.
 *
 * The location matters more than it looks: `readCompanyConfig` refuses to load
 * into a company with none, and `seed-company` does not create one — onboarding
 * does that separately. It is named after the scope rather than "Headquarters"
 * so it is real data, and the migration's own location tier merges onto it by
 * name if the source has a location by the same name.
 */
async function provisionCompany(
  client: ServiceRole,
  args: {
    scope: MigrationScope;
    parentCompanyId: string;
    companyGroupId: string;
    baseCurrencyCode: string;
    userId: string;
  }
): Promise<{ companyId: string; companyName: string }> {
  const name = args.scope.legalName?.trim() || args.scope.name;

  const inserted = await client
    .from("company")
    .insert({
      name,
      baseCurrencyCode: args.scope.currencyCode ?? args.baseCurrencyCode,
      countryCode: args.scope.countryCode,
      parentCompanyId: args.parentCompanyId,
      companyGroupId: args.companyGroupId
    })
    .select("id")
    .single();

  if (inserted.error || !inserted.data) {
    throw new Error(
      `Could not create a company for "${name}": ${inserted.error?.message ?? "no row returned"}`
    );
  }
  const companyId = inserted.data.id;

  // Reference data, permissions, sequences, the group's chart of accounts and
  // the group's elimination entity. Not in our transaction — an edge function
  // never is — which is why a failed run leaves the company behind for the
  // revert to delete rather than rolling it back.
  const seeded = await client.functions.invoke("seed-company", {
    body: {
      companyId,
      userId: args.userId,
      parentCompanyId: args.parentCompanyId
    }
  });
  if (seeded.error) {
    throw new Error(
      `Could not set up the company for "${name}": ${seeded.error.message}`
    );
  }

  const location = await client.from("location").insert({
    name: args.scope.name,
    addressLine1: "",
    city: "",
    postalCode: "",
    countryCode: args.scope.countryCode,
    // The group's own timezone is the only defensible default: a source scope
    // carries a country at best, never a timezone.
    timezone: "UTC",
    companyId,
    createdBy: args.userId
  });
  if (location.error) {
    throw new Error(
      `Could not create a location for "${name}": ${location.error.message}`
    );
  }

  return { companyId, companyName: name };
}

export type ResolveTargetsResult = {
  targets: MigrationTarget[];
  companyGroupId: string;
  /** Scopes that were skipped, and why — straight into the run report. */
  skipped: { scopeId: string; name: string; reason: string }[];
};

/**
 * Map every scope to a company, creating the ones that do not exist yet.
 *
 * The company the user pressed Migrate in takes the ROOT scope: it is the one
 * they already set up, and orphaning it in favour of a fresh company would be a
 * surprise. Every other scope hangs under it, mirroring the source's tree.
 *
 * `provision: false` resolves without creating anything — that is what Preview
 * runs, so it can report "3 companies would be created" without creating them.
 */
export async function resolveMigrationTargets(args: {
  homeCompanyId: string;
  userId: string;
  sourceId: string;
  scopes: MigrationScope[];
  provision: boolean;
}): Promise<ResolveTargetsResult> {
  const client = getCarbonServiceRole();

  const home = await client
    .from("company")
    .select("id, name, companyGroupId, baseCurrencyCode")
    .eq("id", args.homeCompanyId)
    .single();

  if (home.error || !home.data?.companyGroupId) {
    throw new Error(
      `Company ${args.homeCompanyId} has no company group, so its subsidiaries have nowhere to live`
    );
  }
  const companyGroupId = home.data.companyGroupId;

  const groupCompanies = await client
    .from("company")
    .select("id, name")
    .eq("companyGroupId", companyGroupId);
  if (groupCompanies.error) {
    throw new Error(
      `Could not read the company group: ${groupCompanies.error.message}`
    );
  }
  const nameById = new Map(
    (groupCompanies.data ?? []).map((row) => [row.id, row.name])
  );

  const linked = await readScopeLinks(client, {
    companyIds: (groupCompanies.data ?? []).map((row) => row.id),
    sourceId: args.sourceId
  });

  const targets: MigrationTarget[] = [];

  // A source with no scopes at all (a NetSuite account without OneWorld) is one
  // company: the one the user is standing in.
  if (args.scopes.length === 0) {
    return {
      targets: [
        {
          scope: {
            id: "",
            name: home.data.name,
            legalName: null,
            currencyCode: home.data.baseCurrencyCode,
            countryCode: null,
            parentScopeId: null,
            isElimination: false,
            inactive: false
          },
          companyId: home.data.id,
          companyName: home.data.name,
          created: false
        }
      ],
      companyGroupId,
      skipped: []
    };
  }

  // Which company each scope belongs in — decided by the harness's pure planner,
  // so the root-picking and parents-before-children rules are the ones its tests
  // pin rather than a second copy here.
  const { placements, skipped } = planScopePlacements({
    scopes: args.scopes,
    homeCompanyId: home.data.id,
    linkedCompanyByScope: linked
  });

  const companyByScope = new Map(linked);

  for (const placement of placements) {
    const { scope } = placement;

    if (!placement.needsProvisioning) {
      // The home company claims the root the first time round; that link has to
      // be written, or the next run would re-claim it for a different scope.
      const isNewHomeLink =
        placement.companyId === home.data.id && !linked.has(scope.id);
      if (isNewHomeLink && args.provision) {
        await linkScope(client, {
          companyId: placement.companyId,
          userId: args.userId,
          sourceId: args.sourceId,
          scopeId: scope.id
        });
      }
      companyByScope.set(scope.id, placement.companyId);
      targets.push({
        scope,
        companyId: placement.companyId,
        companyName: nameById.get(placement.companyId) ?? home.data.name,
        created: false
      });
      continue;
    }

    if (!args.provision) {
      // Preview: name the company that WOULD be created, without creating it.
      targets.push({
        scope,
        companyId: "",
        companyName: scope.legalName?.trim() || scope.name,
        created: true
      });
      continue;
    }

    // The planner resolves a parent COMPANY for every scope it places, but a
    // company created earlier in this very loop is only known here.
    const parentCompanyId =
      (scope.parentScopeId
        ? companyByScope.get(scope.parentScopeId)
        : undefined) ??
      placement.parentCompanyId ??
      home.data.id;

    const provisioned = await provisionCompany(client, {
      scope,
      parentCompanyId,
      companyGroupId,
      baseCurrencyCode: home.data.baseCurrencyCode,
      userId: args.userId
    });
    companyByScope.set(scope.id, provisioned.companyId);
    await linkScope(client, {
      companyId: provisioned.companyId,
      userId: args.userId,
      sourceId: args.sourceId,
      scopeId: scope.id
    });

    targets.push({
      scope,
      companyId: provisioned.companyId,
      companyName: provisioned.companyName,
      created: true
    });
  }

  return { targets, companyGroupId, skipped };
}

/**
 * Name the group after the source account.
 *
 * Only ever fills in a placeholder: a group the customer has already named is
 * theirs, and a migration renaming it would be a surprise nobody asked for.
 */
export async function nameCompanyGroup(args: {
  companyGroupId: string;
  accountName: string;
  homeCompanyName: string;
}): Promise<void> {
  const client = getCarbonServiceRole();

  const group = await client
    .from("companyGroup")
    .select("id, name")
    .eq("id", args.companyGroupId)
    .single();
  if (group.error || !group.data) return;

  // `seedCompanyReferenceData` and `seed-company` both name a new group after
  // its first company, so a group still carrying that name has never been named
  // deliberately.
  const unnamed = !group.data.name || group.data.name === args.homeCompanyName;
  if (!unnamed || !args.accountName) return;

  await client
    .from("companyGroup")
    .update({ name: args.accountName })
    .eq("id", args.companyGroupId);
}
