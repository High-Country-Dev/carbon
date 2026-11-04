// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// LAND-299: write Spool Calculator hours onto method steps — laborTime in Total Hours. Only steps on a Draft
// make method of this company are changed.
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";

const input = z
  .array(
    z.object({ id: z.string().min(1), hours: z.number().min(0).max(100000) })
  )
  .max(10);

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });
  const form = await request.formData();
  const parsed = input.safeParse(
    JSON.parse(String(form.get("updates") || "[]"))
  );
  if (!parsed.success || parsed.data.length === 0)
    return data({ error: "Nothing to write" }, { status: 400 });
  const ids = parsed.data.map((u) => u.id);
  const ops = await client
    .from("methodOperation")
    .select("id, makeMethodId, makeMethod(status)")
    .in("id", ids)
    .eq("companyId", companyId);
  if (ops.error) return data({ error: ops.error.message }, { status: 400 });
  const ok = new Set(
    (ops.data ?? [])
      .filter((o: any) => (o.makeMethod?.status ?? "Draft") === "Draft")
      .map((o) => o.id)
  );
  for (const u of parsed.data) {
    if (!ok.has(u.id))
      return data(
        { error: "That step can't be changed (not a Draft method)" },
        { status: 400 }
      );
  }
  for (const u of parsed.data) {
    const r = await client
      .from("methodOperation")
      .update({
        laborTime: u.hours,
        laborUnit: "Total Hours",
        updatedBy: userId,
        updatedAt: new Date().toISOString()
      })
      .eq("id", u.id)
      .eq("companyId", companyId);
    if (r.error) return data({ error: r.error.message }, { status: 400 });
  }
  return { ok: true };
}
