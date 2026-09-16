import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { completeJobOperationBatchValidator } from "~/services/models";
import { getJobOperationBatch } from "~/services/operations.service";
import { path } from "~/utils/path";

// The batch's mergeable output lots, derived SERVER-SIDE from its membership.
// Ids are never taken from the form: this route invokes `issue` with the
// SERVICE ROLE, so the edge fn's own `inventory` permission check validates the
// service role rather than the operator — a posted id list would let a
// production-only user merge any two same-item lots in the company. Returns []
// unless the batch is Completed and >=2 of its members' output lots are still
// Available and share one item (so a second merge finds nothing to do).
async function getMergeableOutputLots(
  serviceRole: Awaited<ReturnType<typeof getCarbonServiceRole>>,
  batchId: string,
  companyId: string
): Promise<string[]> {
  const batch = await getJobOperationBatch(serviceRole, batchId, companyId);
  if (batch.error || batch.data?.status !== "Completed") return [];

  const entityIds = (batch.data.operations ?? [])
    .map((operation) => operation.trackedEntityId)
    .filter(Boolean) as string[];
  if (entityIds.length < 2) return [];

  const outputs = await serviceRole
    .from("trackedEntity")
    .select("id, itemId")
    .in("id", entityIds)
    .eq("companyId", companyId)
    .eq("status", "Available")
    .gt("quantity", 0);

  const lots = outputs.data ?? [];
  const items = new Set(lots.map((lot) => lot.itemId));
  return lots.length >= 2 && items.size === 1 ? lots.map((lot) => lot.id) : [];
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "production"
  });
  const { batchId } = params;
  if (!batchId) throw new Error("Batch ID is required");

  const formData = await request.formData();

  // Post-completion lot merge ("N lots of the same item — merge into one?").
  // One click combines the per-member output lots into a single lot with
  // genealogy back to every member job.
  if (formData.get("intent") === "merge") {
    const serviceRoleForMerge = await getCarbonServiceRole();
    const trackedEntityIds = await getMergeableOutputLots(
      serviceRoleForMerge,
      batchId,
      companyId
    );
    if (trackedEntityIds.length < 2) {
      return data(
        {},
        await flash(request, error(null, "No mergeable output lots"))
      );
    }
    const mergeResult = await serviceRoleForMerge.functions.invoke<{
      readableId?: string | null;
      error?: string;
    }>("issue", {
      body: {
        type: "mergeTrackedEntities",
        trackedEntityIds,
        companyId,
        userId
      }
    });
    if (mergeResult.error || mergeResult.data?.error) {
      return data(
        {},
        await flash(
          request,
          error(
            mergeResult.error ?? mergeResult.data?.error,
            "Failed to merge lots"
          )
        )
      );
    }
    return redirect(
      path.to.operations,
      await flash(
        request,
        success(
          mergeResult.data?.readableId
            ? `Lots merged into ${mergeResult.data.readableId}`
            : "Lots merged"
        )
      )
    );
  }

  const validation = await validator(
    completeJobOperationBatchValidator
  ).validate(formData);
  if (validation.error) {
    return validationError(validation.error);
  }

  const serviceRole = await getCarbonServiceRole();

  // The edge function owns the whole completion: slice events + record quantities
  // (phase 1, one txn), then issue each member's BOM + flip members Done + post GL
  // (phase 2, idempotent). A phase-2 failure leaves the batch 'Completing'; the
  // operator re-submitting this form re-invokes and resumes without double effects.
  const completeResult = await serviceRole.functions.invoke<{
    memberIds?: string[];
    error?: string;
  }>("batch-operations", {
    body: {
      type: "complete",
      batchId,
      // An excluded ("not in this run") member detaches back to the schedule;
      // its quantities are forced to 0 so a dimmed-but-stale input can never
      // record output for an operation that was not run.
      members: validation.data.members.map((m) => {
        const excluded = m.excluded === "true";
        return {
          jobOperationId: m.jobOperationId,
          quantity: excluded ? 0 : (m.quantity ?? 0),
          scrapQuantity: excluded ? 0 : (m.scrapQuantity ?? 0),
          trackedEntityId: m.trackedEntityId || null,
          batchNumber: m.batchNumber || null,
          excluded
        };
      }),
      companyId,
      userId
    }
  });

  if (completeResult.error || completeResult.data?.error) {
    return data(
      {},
      await flash(
        request,
        error(
          completeResult.error ?? completeResult.data?.error,
          "Failed to complete batch"
        )
      )
    );
  }

  // Same-item output lots can be merged into one — offer it while the operator
  // is still here rather than redirecting away. Different-item batches (or a
  // single lot) go straight back to the floor.
  const mergeableLots = await getMergeableOutputLots(
    serviceRole,
    batchId,
    companyId
  );
  if (mergeableLots.length >= 2) {
    return data(
      { merge: { count: mergeableLots.length } },
      await flash(request, success("Batch completed"))
    );
  }

  return redirect(
    path.to.operations,
    await flash(request, success("Batch completed"))
  );
}
