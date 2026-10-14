// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { PersonAbilities, PersonTrainings } from "~/modules/people/ui/Person";
import {
  getEmployeeAbilities,
  getTrainingAssignmentStatusForEmployee,
  getTrainingCertificatePaths
} from "~/modules/resources";
import type { TrainingAssignmentStatusItem } from "~/modules/resources/types";
import { path } from "~/utils/path";

const logger = getLogger("erp", "person-trainings");

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "people"
  });

  const { personId } = params;
  if (!personId) throw new Error("Could not find personId");

  const [employeeAbilities, trainings] = await Promise.all([
    getEmployeeAbilities(client, personId, companyId),
    getTrainingAssignmentStatusForEmployee(client, companyId, personId)
  ]);

  if (employeeAbilities.error) {
    throw redirect(
      path.to.people,
      await flash(
        request,
        error(employeeAbilities.error, "Failed to load abilities")
      )
    );
  }

  const trainingRows = (trainings.data ?? []) as TrainingAssignmentStatusItem[];
  const certificatePaths = await getTrainingCertificatePaths(
    client,
    companyId,
    trainingRows.flatMap((t) => (t.completionId ? [t.completionId] : []))
  );

  // The certificate links are optional: the page still loads without them.
  if (certificatePaths.error) {
    logger.error("Failed to load training certificate paths", {
      companyId,
      error: certificatePaths.error
    });
  }

  return {
    abilities: employeeAbilities.data ?? [],
    trainings: trainingRows,
    certificatePaths: certificatePaths.data ?? {}
  };
}

export default function PersonAbilitiesRoute() {
  const { abilities, trainings, certificatePaths } =
    useLoaderData<typeof loader>();
  const { personId } = useParams();
  if (!personId) throw new Error("Could not find personId");

  return (
    <VStack spacing={4}>
      <PersonAbilities personId={personId} abilities={abilities} />
      <PersonTrainings
        trainings={trainings}
        certificatePaths={certificatePaths}
      />
    </VStack>
  );
}
