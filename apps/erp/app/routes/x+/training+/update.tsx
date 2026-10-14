// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import type { Database } from "@carbon/database";
import { unchecked } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionFunctionArgs } from "react-router";
import {
  isValidTrainingGuideKey,
  trainingGuideKeyPrefix
} from "~/modules/resources";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "people"
  });

  const formData = await request.formData();
  const ids = formData.getAll("ids");
  const field = formData.get("field");
  const value = formData.get("value");

  if (typeof field !== "string" || typeof value !== "string") {
    return { error: { message: "Invalid form data" }, data: null };
  }

  switch (field) {
    case "content":
    case "name":
    case "status":
    case "type":
    case "frequency":
    case "estimatedDuration":
    case "description":
      return await client
        .from("training")
        .update(
          unchecked({
            [field]: value,
            updatedBy: userId,
            updatedAt: new Date().toISOString()
          })
        )
        .in("id", ids as string[]);
    case "grantsAbilityId":
      return await client
        .from("training")
        .update({
          grantsAbilityId: value === "" ? null : value,
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .in("id", ids as string[]);
    case "isExternal":
    case "guidePath": {
      // These change how employees take the training, so Draft only.
      const refusal = await refuseUnlessDraft(client, companyId, ids);
      if (refusal) return refusal;

      if (field === "isExternal") {
        return await client
          .from("training")
          .update({
            isExternal: value === "on",
            updatedBy: userId,
            updatedAt: new Date().toISOString()
          })
          .in("id", ids as string[])
          .eq("companyId", companyId);
      }

      const trainingId = ids[0] as string;
      if (
        ids.length !== 1 ||
        (value !== "" &&
          !isValidTrainingGuideKey(
            value,
            trainingGuideKeyPrefix(companyId, trainingId)
          ))
      ) {
        return { error: { message: "Invalid guide file" }, data: null };
      }
      return await client
        .from("training")
        .update({
          guidePath: value === "" ? null : value,
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .eq("id", trainingId)
        .eq("companyId", companyId);
    }
    case "tags":
      return await client
        .from("training")
        .update({
          [field]: formData.getAll("value") as string[],
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .in("id", ids as string[]);

    default:
      return { error: { message: "Invalid field" }, data: null };
  }
}

async function refuseUnlessDraft(
  client: SupabaseClient<Database>,
  companyId: string,
  ids: FormDataEntryValue[]
) {
  const trainings = await client
    .from("training")
    .select("status")
    .in("id", ids as string[])
    .eq("companyId", companyId);
  if (trainings.error || trainings.data.length !== ids.length) {
    return { error: { message: "Training not found" }, data: null };
  }
  if (trainings.data.some((training) => training.status !== "Draft")) {
    return {
      error: { message: "This can only change while the training is Draft" },
      data: null
    };
  }
  return null;
}
