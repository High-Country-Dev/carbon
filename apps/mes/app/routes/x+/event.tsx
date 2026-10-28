// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  getRunningEvent,
  stopNeedsCloseOut,
  stopTimer
} from "~/services/closeOut.server";
import { getDatabaseClient } from "~/services/database.server";
import { productionEventValidator } from "~/services/models";
import {
  endProductionEvent,
  getOperationEligibility,
  postEndedProductionEvents,
  startMachineProductionEvent,
  startProductionEvent
} from "~/services/operations.service";
import { OUTSIDE_PROCESSING_REFUSAL } from "~/utils/operationView";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const validation = await validator(productionEventValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const {
    id,
    action: productionAction,
    trackedEntityId,
    unitIndex,
    exclusive,
    ...d
  } = validation.data;

  // A Machine press writes over Kysely, which skips RLS, so the permission RLS
  // would check is checked here, before anything is written. A refusal stays
  // on the page as a message.
  const permitted = async (
    permission: { create: "production" } | { update: "production" }
  ) => {
    try {
      await requirePermissions(request, permission);
      return true;
    } catch (thrown) {
      if (thrown instanceof Response) return false;
      throw thrown;
    }
  };
  const refused = async (message: string) =>
    data({}, await flash(request, error(null, message)));

  // A machine has one machine time. A Machine press ends every open Machine
  // event on the work center, from any operator or the sensor, in the same
  // transaction as the write it belongs to: the new event on a Start, the
  // end of this event on an End. The routes post every event it ended.
  const db = getDatabaseClient();
  const postEnded = (ids: string[]) =>
    postEndedProductionEvents(client, { companyId, userId, ids });

  if (productionAction === "Start") {
    const machineWorkCenterId =
      d.type === "Machine" ? d.workCenterId : undefined;
    if (machineWorkCenterId && !(await permitted({ create: "production" }))) {
      return refused("You do not have permission to start machine time");
    }

    // Ability gate: the shop-floor Start button posts here, so the
    // qualification check must run on this path (not only in the
    // start.$operationId loader)
    const serviceRole = await getCarbonServiceRole();
    const operation = await serviceRole
      .from("jobOperation")
      .select("operationType")
      .eq("id", d.jobOperationId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (operation.data?.operationType === "Outside Processing") {
      return refused(OUTSIDE_PROCESSING_REFUSAL);
    }

    const eligibility = await getOperationEligibility(serviceRole, {
      operationId: d.jobOperationId,
      employeeId: userId,
      companyId
    });
    if (!eligibility.eligible) {
      return refused(
        eligibility.reason ?? "Not qualified to start this operation"
      );
    }

    // Single-phase (assembly) clocking: end any other open work type for this
    // operator on this operation before starting, so Setup and Labor can never
    // run simultaneously. Post each ended event so its cost still books.
    if (exclusive === "true") {
      const openOthers = await client
        .from("productionEvent")
        .select("id")
        .eq("jobOperationId", d.jobOperationId)
        .eq("employeeId", userId)
        .eq("companyId", companyId)
        .is("endTime", null)
        .neq("type", d.type);
      if (openOthers.data && openOthers.data.length > 0) {
        const endTime = datetime.timestamp();
        const ended: string[] = [];
        for (const ev of openOthers.data) {
          const result = await endProductionEvent(client, {
            id: ev.id,
            endTime,
            employeeId: userId,
            companyId
          });
          const row = result.data?.[0];
          if (row) ended.push(row.id);
        }
        await postEnded(ended);
      }
    }

    const event = {
      ...d,
      startTime: datetime.timestamp(),
      employeeId: userId,
      companyId,
      createdBy: userId
    };
    const startEvent = machineWorkCenterId
      ? await startMachineProductionEvent(
          db,
          client,
          { ...event, workCenterId: machineWorkCenterId },
          trackedEntityId,
          unitIndex
        )
      : await startProductionEvent(client, event, trackedEntityId, unitIndex);

    if (startEvent.error) {
      return data(
        {},
        await flash(request, error(startEvent.error, "Failed to start event"))
      );
    }
    if (startEvent.data && "endedEventIds" in startEvent.data) {
      await postEnded(startEvent.data.endedEventIds);
    }

    return data(
      startEvent.data,
      await flash(request, success(`Started ${d.type.toLowerCase()} operation`))
    );
  }

  if (!id) {
    return data({}, await flash(request, error("No event id provided")));
  }
  // End on the event's own work center and type, not the form's.
  const event = await getRunningEvent(client, { id, companyId });
  if (event.error || !event.data) {
    return data(
      {},
      await flash(request, error(event.error, "Failed to end event"))
    );
  }
  // Labor and Machine timers on the Operation view stop through the close-out
  // questions (scrap, finished or in progress), never a bare End.
  if (!event.data.endTime && stopNeedsCloseOut(event.data)) {
    return refused(
      "Answer the close-out questions to stop this timer: refresh the page and press stop again"
    );
  }
  const stopped = await stopTimer({
    request,
    client,
    companyId,
    userId,
    id,
    event: event.data
  });
  if ("refusal" in stopped) {
    return data(
      {},
      await flash(request, error(stopped.cause ?? null, stopped.refusal))
    );
  }
  return data(
    stopped.ended,
    await flash(
      request,
      success(`Ended ${stopped.typeLabel || d.type.toLowerCase()} operation`)
    )
  );
}
