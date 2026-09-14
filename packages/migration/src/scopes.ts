import type { MigrationScope } from "./source.ts";

/**
 * Which Carbon company each source scope belongs in — decided without touching
 * a database, so the rules can be argued with in a test rather than inferred
 * from a migration that already ran.
 *
 * The rules, in the order they matter:
 *
 * 1. A scope with an existing link keeps its company. That is what makes a
 *    re-run update the same companies instead of creating a second set.
 * 2. The company the run started from takes the ROOT scope — unless a previous
 *    run already gave it a different one, in which case that link wins.
 * 3. Everything else is created, PARENTS FIRST, so a child's `parentCompanyId`
 *    always resolves to a company that exists.
 * 4. Elimination and inactive scopes get no company. Carbon makes its own
 *    elimination entity for a group, and a second one would be wrong.
 */

export type ScopePlacement = {
  scope: MigrationScope;
  /** Empty when the company does not exist yet and has to be created. */
  companyId: string;
  /** The company this one hangs under. Empty for the root. */
  parentCompanyId: string;
  /** True when nothing is linked yet, so a company has to be provisioned. */
  needsProvisioning: boolean;
};

export type ScopePlan = {
  placements: ScopePlacement[];
  skipped: { scopeId: string; name: string; reason: string }[];
};

export function planScopePlacements(args: {
  scopes: MigrationScope[];
  homeCompanyId: string;
  /** scope id → company id, from the links previous runs left behind. */
  linkedCompanyByScope: Map<string, string>;
}): ScopePlan {
  const { scopes, homeCompanyId, linkedCompanyByScope } = args;

  const skipped: { scopeId: string; name: string; reason: string }[] = [];
  const migratable: MigrationScope[] = [];

  for (const scope of scopes) {
    if (scope.inactive) {
      skipped.push({
        scopeId: scope.id,
        name: scope.name,
        reason: "inactive in the source"
      });
      continue;
    }
    if (scope.isElimination) {
      skipped.push({
        scopeId: scope.id,
        name: scope.name,
        reason: "consolidation-only — Carbon keeps its own elimination entity"
      });
      continue;
    }
    migratable.push(scope);
  }

  if (migratable.length === 0) return { placements: [], skipped };

  // The root first, then breadth-first over the tree: a company cannot be
  // created under a parent that does not exist yet. A scope whose parent was
  // skipped or is missing falls back to the root, so a broken hierarchy still
  // migrates rather than silently dropping a whole branch.
  const byId = new Map(migratable.map((scope) => [scope.id, scope]));
  const root =
    migratable.find((scope) => scope.parentScopeId === null) ?? migratable[0];
  if (!root) return { placements: [], skipped };

  const ordered: MigrationScope[] = [];
  const placed = new Set<string>();
  const place = (scope: MigrationScope) => {
    if (placed.has(scope.id)) return;
    placed.add(scope.id);
    ordered.push(scope);
    for (const child of migratable) {
      if (child.parentScopeId === scope.id) place(child);
    }
  };
  place(root);
  // Anything the walk did not reach — an orphan, or a cycle — still migrates.
  for (const scope of migratable) place(scope);

  const homeAlreadyLinked = [...linkedCompanyByScope.values()].includes(
    homeCompanyId
  );
  const companyByScope = new Map(linkedCompanyByScope);
  const placements: ScopePlacement[] = [];

  for (const scope of ordered) {
    const linked = companyByScope.get(scope.id);
    if (linked) {
      placements.push({
        scope,
        companyId: linked,
        parentCompanyId: "",
        needsProvisioning: false
      });
      continue;
    }

    if (scope.id === root.id && !homeAlreadyLinked) {
      companyByScope.set(scope.id, homeCompanyId);
      placements.push({
        scope,
        companyId: homeCompanyId,
        parentCompanyId: "",
        needsProvisioning: false
      });
      continue;
    }

    const parentCompanyId =
      (scope.parentScopeId && byId.has(scope.parentScopeId)
        ? companyByScope.get(scope.parentScopeId)
        : undefined) ??
      companyByScope.get(root.id) ??
      homeCompanyId;

    placements.push({
      scope,
      companyId: "",
      parentCompanyId,
      needsProvisioning: true
    });
  }

  return { placements, skipped };
}
