// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

type WorkType = "Setup" | "Labor" | "Machine";

/**
 * The person's running timer of this type on this operation, if any: the
 * oldest open event. A timer is one open event per person, type and
 * operation, so a second Start (a re-scan of the traveller, a double press, a
 * stale tab) keeps this one instead of opening another that would count the
 * same minutes twice. Checked before every insert in operations.service.
 */
export async function findOpenProductionEvent(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    jobOperationId: string;
    type: WorkType;
    employeeId: string;
  }
) {
  return client
    .from("productionEvent")
    .select("id")
    .eq("companyId", args.companyId)
    .eq("jobOperationId", args.jobOperationId)
    .eq("type", args.type)
    .eq("employeeId", args.employeeId)
    .is("endTime", null)
    .order("startTime", { ascending: true })
    .limit(1)
    .maybeSingle();
}
