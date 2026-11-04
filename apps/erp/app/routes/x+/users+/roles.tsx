// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { hasPermission, success } from "@carbon/auth";
// LAND-299 / LAND-271 (ABS, Eric: "See who has which role"): who has which role, and change it here. Carbon's
// own role screens are paid (packages/ee) and not used; this page does what carbon-sync/roles/apply_roles.py
// does, from the free schema: the person's employee type becomes the role, and their userPermission for this
// company becomes that type's employeeTypePermission rows (grants other companies gave are kept). Their
// cached permissions are cleared so it applies on their next page. Changing roles needs People update access
// (ABS managers); giving or taking Admin needs Users update access.
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redis } from "@carbon/kv";
import {
  Badge,
  HStack,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useFetcher, useLoaderData } from "react-router";
import { usePermissions } from "~/hooks";
import { getPermissionCacheKey } from "~/modules/users/users.service";
import type { Handle } from "~/utils/handle";

export const handle: Handle = {
  breadcrumb: msg`Roles`,
  to: "/x/users/roles"
};

const ACTIONS = ["view", "create", "update", "delete"] as const;

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "users",
    bypassRls: true
  });
  const [employees, types] = await Promise.all([
    client
      .from("employee")
      .select("id, active, employeeTypeId")
      .eq("companyId", companyId),
    client
      .from("employeeType")
      .select("id, name")
      .eq("companyId", companyId)
      .order("name")
  ]);
  if (employees.error) throw employees.error;
  const users = await client
    .from("user")
    .select("id, fullName, email")
    .in(
      "id",
      (employees.data ?? []).map((e) => e.id)
    );
  const user = new Map(((users.data ?? []) as any[]).map((u) => [u.id, u]));
  const rows = ((employees.data ?? []) as any[])
    .map((e) => ({
      id: e.id as string,
      active: !!e.active,
      employeeTypeId: e.employeeTypeId as string | null,
      name: (user.get(e.id)?.fullName as string) ?? "",
      email: (user.get(e.id)?.email as string) ?? ""
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { rows, types: (types.data ?? []) as { id: string; name: string }[] };
}

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, permissions } = await requirePermissions(request, {
    update: "people",
    bypassRls: true
  });
  const form = await request.formData();
  const userId = String(form.get("userId") || "");
  const employeeTypeId = String(form.get("employeeTypeId") || "");
  if (!userId || !employeeTypeId)
    return data({ error: "Pick a person and a role" }, { status: 400 });

  const [type, current] = await Promise.all([
    client
      .from("employeeType")
      .select("id, name, systemType")
      .eq("id", employeeTypeId)
      .eq("companyId", companyId)
      .single(),
    client
      .from("employee")
      .select("employeeTypeId, employeeType(name, systemType)")
      .eq("id", userId)
      .eq("companyId", companyId)
      .single()
  ]);
  if (type.error || current.error)
    return data({ error: "Unknown person or role" }, { status: 400 });
  const touchesAdmin =
    (type.data as any).systemType === "Admin" ||
    (current.data as any)?.employeeType?.systemType === "Admin";
  const canUsers = hasPermission(permissions, "users", "update", companyId);
  if (touchesAdmin && !canUsers) {
    return data(
      {
        error: "Only someone with Users access can give or take the Admin role"
      },
      { status: 403 }
    );
  }

  const [rolePerms, userPerm] = await Promise.all([
    client
      .from("employeeTypePermission")
      .select("module, view, create, update, delete")
      .eq("employeeTypeId", employeeTypeId),
    client
      .from("userPermission")
      .select("permissions")
      .eq("id", userId)
      .maybeSingle()
  ]);
  if (rolePerms.error)
    return data({ error: rolePerms.error.message }, { status: 400 });
  // keep what other companies granted; replace only this company's entries
  const merged: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(
    (userPerm.data?.permissions ?? {}) as Record<string, string[]>
  )) {
    const others = (v ?? []).filter((c) => c !== companyId);
    if (others.length) merged[k] = others;
  }
  for (const p of rolePerms.data ?? []) {
    for (const a of ACTIONS) {
      if (((p as any)[a] ?? []).includes(companyId)) {
        const key = `${String(p.module).toLowerCase()}_${a}`;
        merged[key] = [...new Set([...(merged[key] ?? []), companyId])];
      }
    }
  }
  const [emp, perm] = await Promise.all([
    client
      .from("employee")
      .update({ employeeTypeId })
      .eq("id", userId)
      .eq("companyId", companyId),
    client
      .from("userPermission")
      .upsert({ id: userId, permissions: merged as any })
  ]);
  if (emp.error || perm.error) {
    return data({ error: (emp.error ?? perm.error)!.message }, { status: 400 });
  }
  try {
    await redis.del(getPermissionCacheKey(userId));
  } catch {
    // the cached grants expire within the hour anyway
  }
  return data(
    { ok: true },
    await flash(request, success(`Role changed to ${type.data.name}`))
  );
}

function RoleSelect({
  row,
  types
}: {
  row: { id: string; employeeTypeId: string | null };
  types: { id: string; name: string }[];
}) {
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const permissions = usePermissions();
  const canChange = permissions.can("update", "people");
  return (
    <HStack spacing={2}>
      <select
        className="h-8 rounded-md border border-input bg-background px-2 text-sm"
        defaultValue={row.employeeTypeId ?? ""}
        disabled={!canChange || fetcher.state !== "idle"}
        onChange={(e) =>
          fetcher.submit(
            { userId: row.id, employeeTypeId: e.target.value },
            { method: "post" }
          )
        }
      >
        {!row.employeeTypeId && <option value="">—</option>}
        {types.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      {fetcher.data?.error && (
        <span className="text-xs text-red-500">{fetcher.data.error}</span>
      )}
      {fetcher.data?.ok && <span className="text-xs text-emerald-600">✓</span>}
    </HStack>
  );
}

export default function RolesRoute() {
  const { rows, types } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  return (
    <VStack spacing={4} className="p-4 w-full h-full overflow-y-auto">
      <h2 className="text-2xl font-semibold">
        <Trans>Roles</Trans>
      </h2>
      <p className="text-sm text-muted-foreground">
        <Trans>
          Each person's role decides what they can see and change in BOSS. Pick
          a new role to change it; it applies on their next page.
        </Trans>
      </p>
      <Table>
        <Thead>
          <Tr>
            <Th>
              <Trans>Name</Trans>
            </Th>
            <Th>
              <Trans>Email</Trans>
            </Th>
            <Th>
              <Trans>Role</Trans>
            </Th>
          </Tr>
        </Thead>
        <Tbody>
          {rows.map((r) => (
            <Tr key={r.id}>
              <Td>
                {r.name}{" "}
                {!r.active && <Badge variant="gray">{t`Inactive`}</Badge>}
              </Td>
              <Td>{r.email}</Td>
              <Td>
                <RoleSelect row={r} types={types} />
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </VStack>
  );
}
