// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// LAND-299: sign off (or take back a sign-off) on a quote or purchase order. Only people with Resources access
// (ABS managers: Steve, Eric, Chris) can sign off; Finalize waits for it (SignOffButton).
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";

const TABLES = {
  quote: { table: "quote", module: "sales" },
  purchaseOrder: { table: "purchaseOrder", module: "purchasing" }
} as const;

export async function loader({ request, params }: LoaderFunctionArgs) {
  const t = TABLES[params.table as keyof typeof TABLES];
  if (!t || !params.id) throw new Response("Not found", { status: 404 });
  const { client, companyId } = await requirePermissions(request, {
    view: t.module
  });
  const r = await (client as any)
    .from(t.table)
    .select("signedOffBy, signedOffAt")
    .eq("id", params.id)
    .eq("companyId", companyId)
    .maybeSingle();
  let name: string | null = null;
  if (r.data?.signedOffBy) {
    const u = await client
      .from("user")
      .select("fullName")
      .eq("id", r.data.signedOffBy)
      .maybeSingle();
    name = (u.data as { fullName?: string } | null)?.fullName ?? null;
  }
  return {
    signedOffBy: r.data?.signedOffBy ?? null,
    signedOffAt: r.data?.signedOffAt ?? null,
    name
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const t = TABLES[params.table as keyof typeof TABLES];
  if (!t || !params.id) throw new Response("Not found", { status: 404 });
  const { client, companyId, userId } = await requirePermissions(request, {
    update: t.module,
    view: "resources"
  });
  const form = await request.formData();
  const signOff = form.get("signOff") === "1";
  const r = await (client as any)
    .from(t.table)
    .update(
      signOff
        ? { signedOffBy: userId, signedOffAt: new Date().toISOString() }
        : { signedOffBy: null, signedOffAt: null }
    )
    .eq("id", params.id)
    .eq("companyId", companyId);
  if (r.error) return data({ error: r.error.message }, { status: 400 });
  return { ok: true };
}
