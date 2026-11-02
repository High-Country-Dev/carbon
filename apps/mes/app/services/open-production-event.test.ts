// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { findOpenProductionEvent } from "./open-production-event";

// Records every filter of the query chain and answers with `result`.
function fakeClient(result: { data: unknown; error: unknown }) {
  const calls: [string, ...unknown[]][] = [];
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "order", "limit"]) {
    chain[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return chain;
    };
  }
  chain.maybeSingle = async () => {
    calls.push(["maybeSingle"]);
    return result;
  };
  const client = {
    from: (table: string) => {
      calls.push(["from", table]);
      return chain;
    }
  } as unknown as SupabaseClient<Database>;
  return { client, calls };
}

const args = {
  companyId: "company-1",
  jobOperationId: "op-1",
  type: "Labor" as const,
  employeeId: "user-1"
};

describe("findOpenProductionEvent", () => {
  it("looks for this person's open event of this type on this operation", async () => {
    const { client, calls } = fakeClient({ data: null, error: null });
    await findOpenProductionEvent(client, args);
    expect(calls).toEqual(
      expect.arrayContaining([
        ["from", "productionEvent"],
        ["eq", "companyId", "company-1"],
        ["eq", "jobOperationId", "op-1"],
        ["eq", "type", "Labor"],
        ["eq", "employeeId", "user-1"],
        ["is", "endTime", null],
        ["limit", 1]
      ])
    );
  });

  it("returns the running event so a second start can keep it", async () => {
    const { client } = fakeClient({ data: { id: "event-1" }, error: null });
    const running = await findOpenProductionEvent(client, args);
    expect(running.data).toEqual({ id: "event-1" });
  });

  it("returns nothing when no timer runs", async () => {
    const { client } = fakeClient({ data: null, error: null });
    const running = await findOpenProductionEvent(client, args);
    expect(running.data).toBeNull();
  });
});
