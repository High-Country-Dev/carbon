// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// LAND-299 (ABS, Pam and accounting: "Reports for accounting: usage by job and stock value").
//   ?view=value  stock on hand × the item's unit cost, by item posting group (inventory account) and part
//   ?view=usage  material issued to each job, at its cost-ledger (FIFO) cost, for jobs completed / due in the
//                dates. JobBOSS history was posted on the load dates, so the dates filter on the job, not the posting.
// ?format=csv downloads either view (usage includes one row per part per job). Costs: Resources access.
import { requirePermissions } from "@carbon/auth/auth.server";
import { HStack, Table, Tbody, Td, Th, Thead, Tr, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Form, Link, useLoaderData, useSearchParams } from "react-router";
import { useCurrencyFormatter } from "~/hooks";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Stock Value & Usage`,
  to: path.to.inventoryValueAndUsage
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

async function all<T>(
  q: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: unknown }>
) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const r = await q(from, from + 999);
    if (r.error)
      throw new Error(
        `value and usage query failed: ${(r.error as any).message ?? r.error}`
      );
    out.push(...(r.data ?? []));
    if ((r.data ?? []).length < 1000) break;
  }
  return out;
}

const csv = (name: string, head: string[], body: unknown[][]) => {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return new Response(
    [head, ...body].map((r) => r.map(esc).join(",")).join("\n"),
    {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${name}.csv"`
      }
    }
  );
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: ["inventory", "resources"],
    bypassRls: true
  });
  const url = new URL(request.url);
  const view = url.searchParams.get("view") === "usage" ? "usage" : "value";
  const format = url.searchParams.get("format");
  const today = new Date();
  const from =
    url.searchParams.get("from") || iso(new Date(today.getFullYear(), 0, 1));
  const to = url.searchParams.get("to") || iso(today);

  const items = await all((a, b) =>
    client
      .from("item")
      .select("id, readableId, name, unitOfMeasureCode")
      .eq("companyId", companyId)
      .order("id")
      .range(a, b)
  );
  const item = new Map((items as any[]).map((i) => [i.id, i]));

  if (view === "value") {
    const [ledger, costs, groups] = await Promise.all([
      all((a, b) =>
        // Carbon's own on-hand table (one row per item and location), not a scan of the whole ledger
        client
          .from("itemStockQuantities")
          .select("itemId, quantityOnHand")
          .eq("companyId", companyId)
          .order("itemId")
          .range(a, b)
      ),
      all((a, b) =>
        client
          .from("itemCost")
          .select("itemId, unitCost, itemPostingGroupId")
          .eq("companyId", companyId)
          .order("itemId")
          .range(a, b)
      ),
      client
        .from("itemPostingGroup")
        .select("id, name")
        .eq("companyId", companyId)
    ]);
    const onHand = new Map<string, number>();
    for (const l of ledger as any[])
      onHand.set(
        l.itemId,
        (onHand.get(l.itemId) ?? 0) + Number(l.quantity ?? 0)
      );
    const cost = new Map((costs as any[]).map((c) => [c.itemId, c]));
    const groupName = new Map(
      ((groups.data ?? []) as any[]).map((g) => [g.id, g.name])
    );
    const rows = [...onHand.entries()]
      .filter(([, q]) => q > 0.0001)
      .map(([itemId, qty]) => {
        const c = cost.get(itemId);
        const unitCost = Number(c?.unitCost ?? 0);
        return {
          itemId,
          part: item.get(itemId)?.readableId ?? itemId,
          name: item.get(itemId)?.name ?? "",
          uom: item.get(itemId)?.unitOfMeasureCode ?? "",
          group:
            (c?.itemPostingGroupId && groupName.get(c.itemPostingGroupId)) ||
            "No group",
          qty,
          unitCost,
          value: qty * unitCost
        };
      })
      .sort((a, b) => b.value - a.value);
    if (format === "csv") {
      return csv(
        "stock-value",
        [
          "Part",
          "Description",
          "Group",
          "On hand",
          "Unit",
          "Unit cost",
          "Value"
        ],
        rows.map((r) => [
          r.part,
          r.name,
          r.group,
          r.qty,
          r.uom,
          r.unitCost.toFixed(4),
          r.value.toFixed(2)
        ])
      );
    }
    const byGroup = new Map<string, { value: number; parts: number }>();
    for (const r of rows) {
      const g = byGroup.get(r.group) ?? { value: 0, parts: 0 };
      g.value += r.value;
      g.parts += 1;
      byGroup.set(r.group, g);
    }
    return {
      view,
      from,
      to,
      total: rows.reduce((a, r) => a + r.value, 0),
      groups: [...byGroup.entries()]
        .map(([name, g]) => ({ name, ...g }))
        .sort((a, b) => b.value - a.value),
      parts: rows.slice(0, 200),
      jobs: [] as any[],
      page: 1,
      pages: 1,
      jobCount: 0
    };
  }

  // usage by job
  const jobs = await all((a, b) =>
    client
      .from("job")
      .select("id, jobId, status, customerId, completedDate, dueDate")
      .eq("companyId", companyId)
      .order("id")
      .range(a, b)
  );
  // Paged: 50 jobs per page, newest first; the ledger is read only for this page's jobs (the CSV takes them all).
  const isCsv = format === "csv";
  const PAGE_SIZE = 50;
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const allInRange = (jobs as any[])
    .filter((j) => {
      const d = String(j.completedDate ?? j.dueDate ?? "").slice(0, 10);
      return d >= from && d <= to;
    })
    .sort(
      (a, b) =>
        String(b.completedDate ?? b.dueDate ?? "").localeCompare(
          String(a.completedDate ?? a.dueDate ?? "")
        ) || String(a.jobId).localeCompare(String(b.jobId))
    );
  const pages = Math.max(1, Math.ceil(allInRange.length / PAGE_SIZE));
  const inRange = isCsv
    ? allInRange
    : allInRange.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const ids = inRange.map((j) => j.id);
  const lines: any[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    lines.push(
      ...(await all((a, b) =>
        client
          .from("costLedger")
          .select("documentId, itemId, quantity, cost")
          .eq("companyId", companyId)
          .eq("itemLedgerType", "Consumption")
          .in("documentId", ids.slice(i, i + 50))
          .order("id")
          .range(a, b)
      ))
    );
  }
  const customers = await client
    .from("customer")
    .select("id, name")
    .in("id", [
      ...new Set(inRange.map((j) => j.customerId).filter(Boolean))
    ] as string[]);
  const cname = new Map(
    ((customers.data ?? []) as any[]).map((c) => [c.id, c.name])
  );
  const jobById = new Map(inRange.map((j) => [j.id, j]));
  const perJob = new Map<string, { cost: number; lines: number }>();
  const perPart = new Map<
    string,
    { jobId: string; itemId: string; qty: number; cost: number }
  >();
  for (const l of lines) {
    const used = -Number(l.cost ?? 0),
      qty = -Number(l.quantity ?? 0);
    const j = perJob.get(l.documentId) ?? { cost: 0, lines: 0 };
    j.cost += used;
    j.lines += 1;
    perJob.set(l.documentId, j);
    const k = `${l.documentId}|${l.itemId}`;
    const p = perPart.get(k) ?? {
      jobId: l.documentId,
      itemId: l.itemId,
      qty: 0,
      cost: 0
    };
    p.qty += qty;
    p.cost += used;
    perPart.set(k, p);
  }
  if (format === "csv") {
    return csv(
      "material-usage-by-job",
      [
        "Job",
        "Customer",
        "Status",
        "Completed",
        "Part",
        "Description",
        "Quantity",
        "Unit",
        "Cost"
      ],
      [...perPart.values()].map((p) => {
        const j = jobById.get(p.jobId);
        const it = item.get(p.itemId);
        return [
          j?.jobId,
          cname.get(j?.customerId) ?? "",
          j?.status,
          j?.completedDate ?? "",
          it?.readableId,
          it?.name,
          p.qty,
          it?.unitOfMeasureCode,
          p.cost.toFixed(2)
        ];
      })
    );
  }
  const jobRows = [...perJob.entries()]
    .map(([id, v]) => {
      const j = jobById.get(id);
      return {
        id,
        jobId: j?.jobId,
        customer: cname.get(j?.customerId) ?? "",
        status: j?.status,
        completed: j?.completedDate,
        ...v
      };
    })
    .sort((a, b) => b.cost - a.cost);
  return {
    view,
    from,
    to,
    total: jobRows.reduce((a, r) => a + r.cost, 0),
    groups: [],
    parts: [],
    jobs: jobRows,
    page,
    pages,
    jobCount: allInRange.length
  };
}

export default function ValueAndUsageRoute() {
  const { view, from, to, total, groups, parts, jobs, page, pages, jobCount } =
    useLoaderData<typeof loader>();
  const { t } = useLingui();
  const money = useCurrencyFormatter();
  const [params] = useSearchParams();
  const csvHref = `?${new URLSearchParams([...[...params.entries()].filter(([k]) => k !== "page" && k !== "view"), ["view", view], ["format", "csv"]]).toString()}`;
  const pageHref = (p: number) => {
    const q = new URLSearchParams(params);
    q.set("page", String(p));
    return `?${q.toString()}`;
  };
  return (
    <VStack spacing={4} className="p-4 w-full h-full overflow-y-auto">
      <HStack className="w-full justify-between">
        <h2 className="text-2xl font-semibold">
          {view === "value" ? t`Stock Value` : t`Material Used by Job`}
        </h2>
        <HStack spacing={4} className="text-sm">
          <Link
            className={view === "value" ? "font-semibold" : "underline"}
            to="?view=value"
          >
            <Trans>Stock value</Trans>
          </Link>
          <Link
            className={view === "usage" ? "font-semibold" : "underline"}
            to="?view=usage"
          >
            <Trans>Used by job</Trans>
          </Link>
          <a className="underline" href={csvHref}>
            <Trans>Download CSV</Trans>
          </a>
        </HStack>
      </HStack>
      {view === "usage" && (
        <Form
          method="get"
          className="flex flex-wrap gap-3 items-center text-sm"
        >
          <input type="hidden" name="view" value="usage" />
          <label className="flex items-center gap-1">
            <Trans>Jobs completed or due from</Trans>
            <input
              type="date"
              name="from"
              defaultValue={from}
              className="border rounded px-2 py-1 bg-background"
            />
          </label>
          <label className="flex items-center gap-1">
            <Trans>to</Trans>
            <input
              type="date"
              name="to"
              defaultValue={to}
              className="border rounded px-2 py-1 bg-background"
            />
          </label>
          <button type="submit" className="border rounded px-3 py-1">
            <Trans>Show</Trans>
          </button>
        </Form>
      )}
      <p className="text-sm">
        <Trans>Total</Trans>: <b>{money.format(total)}</b>
        {view === "value" && (
          <span className="text-muted-foreground">
            {" "}
            — <Trans>on-hand quantity × each part's unit cost, today.</Trans>
          </span>
        )}
        {view === "usage" && (
          <span className="text-muted-foreground">
            {" "}
            —{" "}
            <Trans>
              material issued to these jobs, at the cost it came out of stock.
              The CSV lists every part.
            </Trans>
          </span>
        )}
      </p>
      {view === "value" ? (
        <>
          <Table>
            <Thead>
              <Tr>
                <Th>
                  <Trans>Group (inventory account)</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Parts</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Value</Trans>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {groups.map((g) => (
                <Tr key={g.name}>
                  <Td>{g.name}</Td>
                  <Td className="text-right">{g.parts}</Td>
                  <Td className="text-right">{money.format(g.value)}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
          <h3 className="text-lg font-semibold">
            <Trans>Top 200 parts by value</Trans>
          </h3>
          <Table>
            <Thead>
              <Tr>
                <Th>
                  <Trans>Part</Trans>
                </Th>
                <Th>
                  <Trans>Description</Trans>
                </Th>
                <Th>
                  <Trans>Group</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>On hand</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Unit cost</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Value</Trans>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {parts.map((p) => (
                <Tr key={p.itemId}>
                  <Td>{p.part}</Td>
                  <Td className="max-w-[320px] truncate">{p.name}</Td>
                  <Td>{p.group}</Td>
                  <Td className="text-right">{`${Number(p.qty.toFixed(3))} ${p.uom}`}</Td>
                  <Td className="text-right">{money.format(p.unitCost)}</Td>
                  <Td className="text-right">{money.format(p.value)}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </>
      ) : (
        <Table>
          <Thead>
            <Tr>
              <Th>
                <Trans>Job</Trans>
              </Th>
              <Th>
                <Trans>Customer</Trans>
              </Th>
              <Th>
                <Trans>Status</Trans>
              </Th>
              <Th>
                <Trans>Completed</Trans>
              </Th>
              <Th className="text-right">
                <Trans>Lines</Trans>
              </Th>
              <Th className="text-right">
                <Trans>Material cost</Trans>
              </Th>
            </Tr>
          </Thead>
          <Tbody>
            {jobs.map((j) => (
              <Tr key={j.id}>
                <Td>
                  <Link className="underline" to={path.to.jobMaterials(j.id)}>
                    {j.jobId}
                  </Link>
                </Td>
                <Td>{j.customer}</Td>
                <Td>{j.status}</Td>
                <Td>{String(j.completed ?? "").slice(0, 10)}</Td>
                <Td className="text-right">{j.lines}</Td>
                <Td className="text-right">{money.format(j.cost)}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
      {view === "usage" && (
        <HStack spacing={4} className="text-sm">
          {page > 1 && (
            <Link className="underline" to={pageHref(page - 1)}>
              <Trans>Previous</Trans>
            </Link>
          )}
          <span>
            <Trans>
              Page {page} of {pages} ({jobCount} jobs, newest first; jobs with
              no material are left out); the total is for this page.
            </Trans>
          </span>
          {page < pages && (
            <Link className="underline" to={pageHref(page + 1)}>
              <Trans>Next</Trans>
            </Link>
          )}
        </HStack>
      )}
    </VStack>
  );
}
