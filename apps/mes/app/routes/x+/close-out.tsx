// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  getFinishRefusal,
  getRunningEvent,
  stopNeedsCloseOut,
  stopTimer
} from "~/services/closeOut.server";
import { erpPosting } from "~/services/erp";
import { closeOutValidator } from "~/services/models";
import { finishJobOperation } from "~/services/operations.service";
import { readOrigin } from "~/utils/origin";
import { path } from "~/utils/path";

const logger = getLogger("mes", "close-out");

/**
 * Stops a Labor or Machine timer on the Operation view with its close-out
 * answers (see `closeOutValidator`). Every check runs before the first write,
 * then, in order: the stop, the scrap posting, and finishing the operation.
 * These are separate writes, as in the Scrap and Mark as Done routes; a
 * failure after the stop is reported with what is left to do by hand.
 */
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const validation = await validator(closeOutValidator).validate(formData);
  if (validation.error) {
    return validationError(validation.error);
  }

  const {
    id,
    jobOperationId,
    trackedEntityId,
    trackingType,
    scrapped,
    scrapQuantity,
    scrapReasonId,
    notes,
    outcome,
    setupProductionEventId,
    laborProductionEventId,
    machineProductionEventId
  } = validation.data;
  // `closedOut: false` keeps the modal open; the flash says why.
  const refused = async (message: string, cause: unknown = null) =>
    data(
      { closedOut: false as const },
      await flash(request, error(cause, message))
    );

  const event = await getRunningEvent(client, { id, companyId });
  if (event.error || !event.data) {
    return refused("Failed to end event", event.error);
  }
  if (event.data.jobOperationId !== jobOperationId) {
    return refused("This timer belongs to another operation");
  }
  if (event.data.endTime) {
    return refused("This event has already ended");
  }
  if (!stopNeedsCloseOut(event.data)) {
    return refused("This timer stops without close-out questions");
  }

  const serviceRole = await getCarbonServiceRole();
  const finished = outcome === "finished";
  if (finished) {
    const refusal = await getFinishRefusal(serviceRole, {
      operationId: jobOperationId,
      companyId,
      userId,
      quantity: 0
    });
    if (refusal) return refused(refusal);
  }

  // The stop goes first: once it lands the modal closes, so a retry can never
  // post the scrap a second time.
  const stopped = await stopTimer({
    request,
    client,
    companyId,
    userId,
    id,
    event: event.data
  });
  if ("refusal" in stopped) {
    logger.error("Close-out stop failed", {
      companyId,
      jobOperationId,
      refusal: stopped.refusal,
      error: stopped.cause
    });
    return refused(stopped.refusal, stopped.cause ?? null);
  }

  // From here the timer is stopped: a later failure closes the modal (a retry
  // would only hit "already ended") and the flash says what to do by hand.
  const stoppedButFailed = async (message: string, cause: unknown) =>
    data(
      { closedOut: true as const },
      await flash(request, error(cause, message))
    );

  let newTrackedEntityId: string | undefined;
  if (scrapped === "yes") {
    // The same posting as Scrap in More actions (x+/scrap.tsx), linked to the
    // operation's events.
    const issued = await erpPosting(
      "issue",
      { companyId, userId },
      {
        type: "jobOperationScrap",
        jobOperationId,
        quantity: scrapQuantity!,
        scrapReasonId: scrapReasonId!,
        notes,
        setupProductionEventId,
        laborProductionEventId,
        machineProductionEventId,
        trackedEntityId: trackingType === "Serial" ? trackedEntityId : undefined
      }
    );
    if (issued.error) {
      logger.error("Close-out scrap failed", {
        companyId,
        jobOperationId,
        error: issued.error
      });
      return stoppedButFailed(
        finished
          ? "The timer stopped, but the scrap was not recorded, so the operation was left open. Log it from More actions → Scrap, then Mark as Done."
          : "The timer stopped, but the scrap was not recorded. Log it from More actions → Scrap.",
        issued.error
      );
    }
    const spawned = issued.data?.newTrackedEntityId;
    newTrackedEntityId = typeof spawned === "string" ? spawned : undefined;
  }

  if (!finished) {
    return data(
      { closedOut: true as const, newTrackedEntityId },
      await flash(request, success(`Stopped ${stopped.typeLabel} timer`))
    );
  }

  // Done also ends the operation's other open timers (sync_finish_job_operation).
  const finish = await finishJobOperation(serviceRole, {
    jobOperationId,
    userId,
    companyId
  });
  if (finish.error) {
    logger.error("Close-out finish failed", {
      companyId,
      jobOperationId,
      error: finish.error
    });
    return stoppedButFailed(
      "The timer stopped, but the operation could not be marked done. Use Mark as Done in More actions.",
      finish.error
    );
  }

  throw redirect(
    readOrigin(formData) ?? path.to.operations,
    await flash(request, success("Timer stopped and operation finished"))
  );
}
