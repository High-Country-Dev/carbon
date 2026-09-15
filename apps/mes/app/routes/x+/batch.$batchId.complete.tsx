import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { completeJobOperationBatchValidator } from "~/services/models";
import { path } from "~/utils/path";

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
    const trackedEntityIds = String(formData.get("trackedEntityIds") ?? "")
      .split(",")
      .filter(Boolean);
    if (trackedEntityIds.length < 2) {
      return data(
        {},
        await flash(request, error(null, "At least two lots are required"))
      );
    }
    const serviceRoleForMerge = await getCarbonServiceRole();
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
    outputTrackedEntityIds?: string[];
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
  const outputIds = completeResult.data?.outputTrackedEntityIds ?? [];
  if (outputIds.length >= 2) {
    const outputs = await serviceRole
      .from("trackedEntity")
      .select("id, itemId, status")
      .in("id", outputIds)
      .eq("companyId", companyId);
    const mergeable = (outputs.data ?? []).filter(
      (e) => e.status === "Available"
    );
    const items = new Set(mergeable.map((e) => e.itemId));
    if (mergeable.length >= 2 && items.size === 1) {
      return data(
        { merge: { trackedEntityIds: mergeable.map((e) => e.id) } },
        await flash(request, success("Batch completed"))
      );
    }
  }

  return redirect(
    path.to.operations,
    await flash(request, success("Batch completed"))
  );
}
