// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Fill Jobs (LAND-306): a released job's materials like the JobBOSS traveler's
// Inventory Copy, with Fill from stock and Order the rest. See
// ~/modules/purchasing/fill-jobs.server.ts.

import { carbon } from "@carbon/api/carbon.server";
import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Badge, Button, cn, HStack, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useEffect, useMemo, useState } from "react";
import { LuPackageCheck, LuPrinter, LuShoppingCart } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, useLoaderData, useNavigation } from "react-router";
import { Empty } from "~/components";
import {
  type FillJobLine,
  getFillJobLines,
  getFillJobs
} from "~/modules/purchasing/fill-jobs.server";
import { resolveLocationId } from "~/modules/shared/shared.service";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Fill Jobs`,
  to: path.to.purchasingFillJobs
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "purchasing"
  });
  const url = new URL(request.url);
  const locationId = await resolveLocationId(client, request, {
    searchParams: url.searchParams,
    userId,
    companyId,
    onDefaultsError: path.to.purchasing,
    onNoLocations: path.to.purchasing
  });
  const jobs = await getFillJobs(client, { companyId, locationId });
  const selected = url.searchParams.get("job") ?? jobs.data[0]?.id ?? null;
  const detail = selected
    ? await getFillJobLines(client, { companyId, locationId, jobId: selected })
    : null;
  return {
    jobs: jobs.data,
    selected,
    lines: detail?.data?.lines ?? [],
    jobReadableId: detail?.data?.job.jobId ?? null
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const jobId = String(form.get("jobId") ?? "");
  const materialIds = form.getAll("materialId").map(String);
  const back = `${path.to.purchasingFillJobs}?job=${encodeURIComponent(jobId)}`;
  const api = await carbon(request);

  if (intent === "fill") {
    const res = await api.purchasing.fillJobFromStock({
      jobId,
      materialIds: materialIds.length ? materialIds : undefined
    });
    if (res.error) throw redirect(back, await flash(request, error(res.error, res.error.message)));
    const { filled, failed } = res.data;
    const msgText = failed.length
      ? `Filled ${filled.length} from stock; ${failed.length} failed: ${failed.map((f) => `${f.readableId} (${f.message})`).join("; ")}`
      : `Filled ${filled.length} line${filled.length === 1 ? "" : "s"} from stock`;
    throw redirect(back, await flash(request, failed.length ? error(null, msgText) : success(msgText)));
  }

  if (intent === "order") {
    const res = await api.purchasing.orderJobShortages({
      jobId,
      materialIds: materialIds.length ? materialIds : undefined
    });
    if (res.error) throw redirect(back, await flash(request, error(res.error, res.error.message)));
    const { created, noVendor, failed } = res.data;
    const parts = [
      created.length
        ? `Draft ${created.length === 1 ? "PO" : "POs"} ${created.map((c) => `${c.purchaseOrderId} (${c.supplier})`).join(", ")}`
        : "No POs created",
      noVendor.length ? `no vendor for ${noVendor.join(", ")}` : "",
      failed.length ? `failed: ${failed.join("; ")}` : ""
    ].filter(Boolean);
    throw redirect(back, await flash(request, failed.length || noVendor.length ? error(null, parts.join("; ")) : success(parts.join("; "))));
  }

  throw redirect(back);
}

const STATUS: Record<FillJobLine["status"], { dot: string; label: string }> = {
  filled: { dot: "bg-emerald-500", label: "Filled" },
  inStock: { dot: "bg-emerald-500", label: "In stock" },
  partial: { dot: "bg-amber-400", label: "Some in stock" },
  onOrder: { dot: "bg-sky-500", label: "On order" },
  short: { dot: "bg-red-500", label: "Short" }
};

const qty = (n: number) =>
  Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 3 });
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");
const LAST_SEEN = "fillJobs.lastSeen";

export default function FillJobsRoute() {
  const { jobs, selected, lines, jobReadableId } = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const [showHidden, setShowHidden] = useState(false);

  // "New" = released since this browser last opened the page (LAND-305).
  const [lastSeen, setLastSeen] = useState<string | null>(null);
  useEffect(() => {
    try {
      setLastSeen(localStorage.getItem(LAST_SEEN));
      localStorage.setItem(LAST_SEEN, new Date().toISOString());
    } catch {
      /* private window: no "new" dots */
    }
  }, []);

  const shown = useMemo(() => lines.filter((l) => showHidden || !l.hidden), [lines, showHidden]);
  const hiddenCount = lines.length - lines.filter((l) => !l.hidden).length;
  const canFill = shown.filter((l) => !l.hidden && l.fromStock > 0 && l.jobOperationId);
  const canOrder = shown.filter((l) => !l.hidden && l.toBuy > 0);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of lines) if (!l.hidden) c[l.status] = (c[l.status] ?? 0) + 1;
    return c;
  }, [lines]);
  const job = jobs.find((j) => j.id === selected);

  return (
    <div className="flex h-full w-full overflow-hidden">
      <aside className="w-72 shrink-0 overflow-y-auto border-r bg-background">
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">
            <Trans>Released jobs</Trans>
          </h2>
          <p className="text-xs text-muted-foreground">
            <Trans>Newest release first</Trans>
          </p>
        </div>
        {jobs.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            <Trans>No released jobs right now.</Trans>
          </p>
        ) : (
          <ul>
            {jobs.map((j) => {
              const isNew = !!(lastSeen && j.releasedDate && j.releasedDate > lastSeen);
              return (
                <li key={j.id}>
                  <Link
                    to={`?job=${j.id}`}
                    className={cn(
                      "block border-b px-4 py-2.5 text-sm hover:bg-muted/50",
                      j.id === selected && "bg-muted"
                    )}
                  >
                    <HStack className="justify-between">
                      <span className="font-medium">{j.jobId}</span>
                      {isNew && <Badge variant="blue">New</Badge>}
                    </HStack>
                    <p className="truncate text-xs text-muted-foreground">{j.itemName ?? j.itemReadableId}</p>
                    <p className="text-xs text-muted-foreground">
                      {j.status}
                      {j.releasedDate ? ` · released ${day(j.releasedDate)}` : ""}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      <main className="flex-1 overflow-y-auto">
        {!job ? (
          <Empty />
        ) : (
          <VStack spacing={4} className="p-6">
            <HStack className="w-full flex-wrap justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold">
                  <Link to={path.to.job(job.id)} className="hover:underline">
                    {jobReadableId ?? job.jobId}
                  </Link>
                </h1>
                <p className="text-sm text-muted-foreground">{job.itemName ?? job.itemReadableId}</p>
                <HStack className="mt-2 flex-wrap gap-3 text-xs">
                  {(["short", "partial", "onOrder", "inStock", "filled"] as const).map((s) =>
                    counts[s] ? (
                      <span key={s} className="inline-flex items-center gap-1.5">
                        <span className={cn("h-2.5 w-2.5 rounded-full", STATUS[s].dot)} />
                        {counts[s]} {STATUS[s].label.toLowerCase()}
                      </span>
                    ) : null
                  )}
                </HStack>
              </div>
              <HStack className="flex-wrap gap-2">
                <Button variant="secondary" leftIcon={<LuPrinter />} asChild>
                  <a href={path.to.file.jobTravelerByJobId(job.id)} target="_blank" rel="noreferrer">
                    <Trans>Traveler</Trans>
                  </a>
                </Button>
                <Form method="post">
                  <input type="hidden" name="intent" value="fill" />
                  <input type="hidden" name="jobId" value={job.id} />
                  <Button type="submit" variant="secondary" leftIcon={<LuPackageCheck />} isDisabled={busy || canFill.length === 0}>
                    <Trans>Fill from stock</Trans> ({canFill.length})
                  </Button>
                </Form>
                <Form method="post">
                  <input type="hidden" name="intent" value="order" />
                  <input type="hidden" name="jobId" value={job.id} />
                  <Button type="submit" leftIcon={<LuShoppingCart />} isDisabled={busy || canOrder.length === 0}>
                    <Trans>Order the rest</Trans> ({canOrder.length})
                  </Button>
                </Form>
              </HStack>
            </HStack>

            <p className="text-xs text-muted-foreground">
              <Trans>
                Fill from stock posts what's on the shelf to this job. Order the rest makes one draft PO per vendor, in
                whole sticks or packs; the extra goes to stock. Check the drafts, then finalize them as usual.
              </Trans>
            </p>

            <div className="w-full overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2" />
                    <th className="px-3 py-2"><Trans>Part</Trans></th>
                    <th className="px-3 py-2 text-right"><Trans>Needed</Trans></th>
                    <th className="px-3 py-2 text-right"><Trans>Posted</Trans></th>
                    <th className="px-3 py-2 text-right"><Trans>On hand</Trans></th>
                    <th className="px-3 py-2"><Trans>On order</Trans></th>
                    <th className="px-3 py-2 text-right"><Trans>To buy</Trans></th>
                    <th className="px-3 py-2"><Trans>Vendor</Trans></th>
                    <th className="px-3 py-2"><Trans>Bin</Trans></th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((l) => (
                    <tr key={l.materialId} className={cn("border-t align-top", l.hidden && "opacity-50")}>
                      <td className="px-3 py-2.5">
                        <span title={STATUS[l.status].label} className={cn("mt-1 block h-2.5 w-2.5 rounded-full", STATUS[l.status].dot)} />
                      </td>
                      <td className="max-w-[360px] px-3 py-2.5">
                        <p className="font-mono text-xs">{l.readableId}</p>
                        <p className="line-clamp-2 text-xs text-muted-foreground" title={l.name}>{l.name}</p>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                        {qty(l.needed)} <span className="text-xs text-muted-foreground">{l.unitOfMeasureCode}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{qty(l.posted)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{qty(l.onHand)}</td>
                      <td className="px-3 py-2.5 text-xs">
                        {l.onOrder.map((o) => (
                          <div key={o.purchaseOrderReadableId + o.quantity} className="whitespace-nowrap">
                            PO {o.purchaseOrderReadableId} · {qty(o.quantity)}
                            {o.promisedDate ? ` · ${day(o.promisedDate)}` : ""}
                          </div>
                        ))}
                      </td>
                      <td className={cn("px-3 py-2.5 text-right tabular-nums", l.toBuy > 0 && "font-medium text-red-600")}>
                        {l.toBuy > 0 ? qty(l.toBuy) : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-xs">{l.vendor?.name ?? (l.toBuy > 0 ? <span className="text-red-600">No vendor</span> : "")}</td>
                      <td className="px-3 py-2.5 text-xs">{l.storageUnitName ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {hiddenCount > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setShowHidden((v) => !v)}>
                {showHidden ? <Trans>Hide per diem and labor lines</Trans> : <Trans>Show {hiddenCount} per diem and labor lines</Trans>}
              </Button>
            )}
          </VStack>
        )}
      </main>
    </div>
  );
}
