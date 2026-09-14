import { describe, expect, it } from "vitest";

import { planScopePlacements } from "./scopes.ts";
import type { MigrationScope } from "./source.ts";

function scope(
  overrides: Partial<MigrationScope> & { id: string }
): MigrationScope {
  return {
    name: `Scope ${overrides.id}`,
    legalName: null,
    currencyCode: null,
    countryCode: null,
    parentScopeId: null,
    isElimination: false,
    inactive: false,
    ...overrides
  };
}

const HOME = "company_home";

describe("planScopePlacements", () => {
  it("gives the root scope the company the run started from", () => {
    const { placements } = planScopePlacements({
      scopes: [scope({ id: "1" })],
      homeCompanyId: HOME,
      linkedCompanyByScope: new Map()
    });

    expect(placements).toHaveLength(1);
    expect(placements[0]).toMatchObject({
      companyId: HOME,
      needsProvisioning: false
    });
  });

  it("creates a company for every other scope, under the root", () => {
    const { placements } = planScopePlacements({
      scopes: [
        scope({ id: "1" }),
        scope({ id: "2", parentScopeId: "1" }),
        scope({ id: "3", parentScopeId: "1" })
      ],
      homeCompanyId: HOME,
      linkedCompanyByScope: new Map()
    });

    expect(placements.map((p) => p.scope.id)).toEqual(["1", "2", "3"]);
    expect(placements[1]).toMatchObject({
      needsProvisioning: true,
      parentCompanyId: HOME
    });
    expect(placements[2]?.parentCompanyId).toBe(HOME);
  });

  it("orders parents before their children, whatever order the source returned", () => {
    const { placements } = planScopePlacements({
      // Deliberately backwards: a grandchild first, the root last.
      scopes: [
        scope({ id: "3", parentScopeId: "2" }),
        scope({ id: "2", parentScopeId: "1" }),
        scope({ id: "1" })
      ],
      homeCompanyId: HOME,
      linkedCompanyByScope: new Map()
    });

    expect(placements.map((p) => p.scope.id)).toEqual(["1", "2", "3"]);
  });

  it("reuses the company a previous run linked, and creates nothing for it", () => {
    const { placements } = planScopePlacements({
      scopes: [scope({ id: "1" }), scope({ id: "2", parentScopeId: "1" })],
      homeCompanyId: HOME,
      linkedCompanyByScope: new Map([["2", "company_two"]])
    });

    const second = placements.find((p) => p.scope.id === "2");
    expect(second).toMatchObject({
      companyId: "company_two",
      needsProvisioning: false
    });
  });

  it("does not hand the root the home company when the home is already another scope's", () => {
    // A second run after somebody re-pointed things: the home company belongs to
    // scope 2, so the root has to get a company of its own rather than stealing it.
    const { placements } = planScopePlacements({
      scopes: [scope({ id: "1" }), scope({ id: "2", parentScopeId: "1" })],
      homeCompanyId: HOME,
      linkedCompanyByScope: new Map([["2", HOME]])
    });

    const root = placements.find((p) => p.scope.id === "1");
    expect(root).toMatchObject({ companyId: "", needsProvisioning: true });
  });

  it("skips elimination and inactive scopes, with a reason", () => {
    const { placements, skipped } = planScopePlacements({
      scopes: [
        scope({ id: "1" }),
        scope({ id: "2", parentScopeId: "1", isElimination: true }),
        scope({ id: "3", parentScopeId: "1", inactive: true })
      ],
      homeCompanyId: HOME,
      linkedCompanyByScope: new Map()
    });

    expect(placements.map((p) => p.scope.id)).toEqual(["1"]);
    expect(skipped.map((s) => s.scopeId).sort()).toEqual(["2", "3"]);
    expect(skipped.find((s) => s.scopeId === "2")?.reason).toContain(
      "elimination"
    );
  });

  it("still migrates a scope whose parent was skipped, under the root", () => {
    const { placements } = planScopePlacements({
      scopes: [
        scope({ id: "1" }),
        scope({ id: "2", parentScopeId: "1", inactive: true }),
        scope({ id: "3", parentScopeId: "2" })
      ],
      homeCompanyId: HOME,
      linkedCompanyByScope: new Map()
    });

    const orphan = placements.find((p) => p.scope.id === "3");
    expect(orphan).toMatchObject({
      needsProvisioning: true,
      parentCompanyId: HOME
    });
  });

  it("does not loop forever on a cyclic hierarchy", () => {
    // NetSuite will not produce this, but a source that did would otherwise hang
    // the whole migration rather than fail it.
    const { placements } = planScopePlacements({
      scopes: [
        scope({ id: "1", parentScopeId: "2" }),
        scope({ id: "2", parentScopeId: "1" })
      ],
      homeCompanyId: HOME,
      linkedCompanyByScope: new Map()
    });

    expect(placements.map((p) => p.scope.id).sort()).toEqual(["1", "2"]);
  });

  it("is empty when every scope was skipped", () => {
    const { placements, skipped } = planScopePlacements({
      scopes: [scope({ id: "1", isElimination: true })],
      homeCompanyId: HOME,
      linkedCompanyByScope: new Map()
    });

    expect(placements).toEqual([]);
    expect(skipped).toHaveLength(1);
  });
});
