// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import type { Database } from "@carbon/database";
import { evaluateLinesForSurface, isBlocked } from "@carbon/ee/rules.server";
import { datetime } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDatabaseClient } from "~/services/database.server";
import {
  endMachineProductionEvent,
  endProductionEvent,
  postEndedProductionEvents
} from "~/services/operations.service";
import { missingRequiredSteps, requiresCloseOut } from "~/utils/closeOut";
import { resolveOperationView } from "~/utils/operationView";

type ProductionEventRow =
  Database["public"]["Tables"]["productionEvent"]["Row"];

export type StopTimerResult =
  | { ended: ProductionEventRow[]; typeLabel: string }
  | { refusal: string; cause?: unknown };

/** The running event the operator pressed stop on, with what decides how it stops. */
export async function getRunningEvent(
  client: SupabaseClient<Database>,
  { id, companyId }: { id: string; companyId: string }
) {
  return client
    .from("productionEvent")
    .select(
      "jobOperationId, workCenterId, type, endTime, jobOperationBatchId, jobOperation(operationType)"
    )
    .eq("id", id)
    .eq("companyId", companyId)
    .maybeSingle();
}

/**
 * Whether stopping this event must go through the close-out questions
 * (`x+/close-out.tsx`) rather than a bare End: a Labor or Machine timer, not
 * part of a batch, on an operation the Operation view runs.
 */
export function stopNeedsCloseOut(
  event: NonNullable<Awaited<ReturnType<typeof getRunningEvent>>["data"]>
) {
  return (
    !!event.type &&
    requiresCloseOut({
      type: event.type,
      isBatched: !!event.jobOperationBatchId
    }) &&
    resolveOperationView(event.jobOperation?.operationType) === "operation"
  );
}

/**
 * End one running timer the way the shop-floor stop button does, and post its
 * cost. A Machine press ends every open Machine event on its work center, in
 * one transaction, and posts each of them.
 */
export async function stopTimer({
  request,
  client,
  companyId,
  userId,
  id,
  event
}: {
  request: Request;
  client: SupabaseClient<Database>;
  companyId: string;
  userId: string;
  id: string;
  event: NonNullable<Awaited<ReturnType<typeof getRunningEvent>>["data"]>;
}): Promise<StopTimerResult> {
  const typeLabel = (event.type ?? "").toLowerCase();
  // A repeated End must not end it again, nor end a newer event through the
  // press.
  if (event.endTime) return { refusal: "This event has already ended" };

  const postEnded = (ids: string[]) =>
    postEndedProductionEvents(client, { companyId, userId, ids });

  if (event.type === "Machine" && event.workCenterId) {
    // The press writes over Kysely, which skips RLS, so the permission RLS
    // would check is checked here, before anything is written.
    try {
      await requirePermissions(request, { update: "production" });
    } catch (thrown) {
      if (thrown instanceof Response) {
        return { refusal: "You do not have permission to end machine time" };
      }
      throw thrown;
    }
    let press: Awaited<ReturnType<typeof endMachineProductionEvent>>;
    try {
      press = await endMachineProductionEvent(getDatabaseClient(), {
        id,
        workCenterId: event.workCenterId,
        companyId,
        userId
      });
    } catch (err) {
      return { refusal: "Failed to end event", cause: err };
    }
    if (!press) return { refusal: "This event has already ended" };
    // The press ended this event with every other one on the work center.
    await postEnded(press.endedEventIds);
    const ended = await client
      .from("productionEvent")
      .select("*")
      .eq("id", id)
      .eq("companyId", companyId);
    return { ended: ended.data ?? [], typeLabel };
  }

  const endEvent = await endProductionEvent(client, {
    id,
    endTime: datetime.timestamp(),
    employeeId: userId,
    companyId
  });
  if (endEvent.error) {
    return { refusal: "Failed to end event", cause: endEvent.error };
  }
  const ended = endEvent.data?.[0];
  if (!ended) {
    // Open when read, but the update matched nothing: another End won the
    // race, or RLS refused the update.
    return { refusal: "This event has already ended, or you cannot end it" };
  }
  // Batch timers post cost at batch completion, when the aggregate event is
  // sliced per member (batch-operations). Posting it here too would
  // double-book the cost, so postEnded skips a batch event.
  await postEnded([ended.id]);
  return { ended: endEvent.data, typeLabel };
}

/**
 * Why this operation may not be marked Done yet, or null when it may. Every
 * way an operator finishes an operation (the close-out, Mark as Done, a
 * finishing scan) asks this first, so none of them can skip it:
 *
 * - every required procedure step has a recorded value;
 * - no work-center business rule on `operationFinish` blocks it. Only
 *   error-severity rules block here: these paths have no acknowledgement step,
 *   so warnings are passed (`acknowledged`) rather than leaving the operator
 *   stuck.
 */
export async function getFinishRefusal(
  serviceRole: SupabaseClient<Database>,
  {
    operationId,
    companyId,
    userId,
    quantity
  }: {
    operationId: string;
    companyId: string;
    userId: string;
    /** The quantity this finish completes, for quantity conditions in rules. */
    quantity: number;
  }
): Promise<string | null> {
  const [stepsRefusal, operation] = await Promise.all([
    getRequiredStepsRefusal(serviceRole, { operationId, companyId }),
    serviceRole
      .from("jobOperation")
      .select("*, jobMakeMethod(itemId)")
      .eq("id", operationId)
      .eq("companyId", companyId)
      .maybeSingle()
  ]);
  if (stepsRefusal) return stepsRefusal;

  if (operation.error || !operation.data) {
    return "Could not read the operation";
  }
  const { workCenterId, operationQuantity } = operation.data;
  if (!workCenterId) return null;

  const itemId = operation.data.jobMakeMethod?.itemId ?? null;
  const ruleEval = await evaluateLinesForSurface({
    client: serviceRole,
    companyId,
    userId,
    targetType: "workCenter",
    surface: "operationFinish",
    lines: [
      {
        lineId: operationId,
        itemId,
        workCenterId,
        operation: {
          id: operationId,
          itemId,
          quantity: operationQuantity ?? null,
          workInstructionId:
            (operation.data as { workInstructionId?: string | null })
              .workInstructionId ?? null
        },
        quantity
      }
    ]
  });
  if (isBlocked(ruleEval.violations, true)) {
    return (
      ruleEval.violations[0]?.message ?? "A business rule blocks finishing"
    );
  }
  return null;
}

/** Why the operation's required steps hold it open, or null when all are recorded. */
export async function getRequiredStepsRefusal(
  serviceRole: SupabaseClient<Database>,
  { operationId, companyId }: { operationId: string; companyId: string }
): Promise<string | null> {
  const steps = await serviceRole
    .from("jobOperationStep")
    .select(
      "name, required, sortOrder, jobOperationStepRecord(value, numericValue, booleanValue, userValue)"
    )
    .eq("operationId", operationId)
    .eq("companyId", companyId)
    .order("sortOrder");
  if (steps.error) return "Could not read the operation's steps";

  const missing = missingRequiredSteps(steps.data ?? []);
  if (missing.length === 0) return null;
  return `Record the required steps before finishing: ${missing
    .map((step) => step.name)
    .join(", ")}`;
}
