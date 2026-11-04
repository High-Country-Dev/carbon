// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// LAND-299 (ABS, Eric/Chris: "Job cost: estimate against actual"): every sales-order job with its estimated and
// actual cost, sale price and margin. Resources access only (rates and costs, LAND-271). ?format=csv downloads it.
import { requirePermissions } from "@carbon/auth/auth.server";
import {
  Badge,
  cn,
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
import type { LoaderFunctionArgs } from "react-router";
import { Form, Link, useLoaderData, useSearchParams } from "react-router";
import { useCurrencyFormatter, usePercentFormatter } from "~/hooks";
import { getJobCosts, inChunks } from "~/modules/production/job-cost.service";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Job Costs`,
  to: path.to.productionJobCosts
};

const STATUSES = [
  "In Progress",
  "Ready",
  "Paused",
  "Completed",
  "Closed"
] as const;
const PAGE_SIZE = 50;
const CSV_LIMIT = 2000;
const FINISHED = ["Completed", "Closed"];

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: ["production", "resources"],
    bypassRls: true
  });
  const url = new URL(request.url);
  const status = url.searchParams.getAll("status").filter(Boolean);
  const search = (url.searchParams.get("search") ?? "").trim();
  // Default: finished jobs — the actual cost of an open job isn't final yet.
  const statuses = status.length ? status : ["Completed", "Closed"];

  // Paged: job costs are worked out only for the jobs on this page (the CSV takes them all, up to CSV_LIMIT).
  const isCsv = url.searchParams.get("format") === "csv";
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const showEmpty = url.searchParams.get("empty") === "1";
  let q = client
    .from("job")
    .select(
      "id, jobId, status, dueDate, completedDate, customerId, itemId, quantity, salesOrderLineId",
      { count: "exact" }
    )
    .eq("companyId", companyId)
    .not("salesOrderLineId", "is", null)
    .in("status", statuses as any)
    .order("dueDate", { ascending: false, nullsFirst: false })
    .order("jobId", { ascending: true });
  if (search) q = q.ilike("jobId", `%${search}%`);
  q = isCsv
    ? q.range(0, CSV_LIMIT - 1)
    : q.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  const jobs = await q;
  if (jobs.error) throw jobs.error;
  const list = jobs.data ?? [];
  const totalJobs = jobs.count ?? list.length;

  const [costs, customers, items] = await Promise.all([
    getJobCosts(
      client,
      companyId,
      list.map((j) => j.id)
    ),
    inChunks<{ id: string; name: string }>(
      [...new Set(list.map((j) => j.customerId).filter(Boolean))] as string[],
      (c) => client.from("customer").select("id, name").in("id", c)
    ),
    inChunks<{ id: string; readableId: string }>(
      [...new Set(list.map((j) => j.itemId).filter(Boolean))] as string[],
      (c) => client.from("item").select("id, readableId").in("id", c)
    )
  ]);
  const customerName = new Map(customers.map((c) => [c.id, c.name]));
  const itemId = new Map(items.map((i) => [i.id, i.readableId]));
  const allRows = list.map((j) => ({
    id: j.id,
    jobId: j.jobId,
    status: j.status,
    dueDate: j.dueDate,
    customer: (j.customerId && customerName.get(j.customerId)) || "",
    part: (j.itemId && itemId.get(j.itemId)) || "",
    cost: costs.get(j.id)!
  }));
  // Jobs with no cost at all (resale, surcharges, lines billed without a job's work) are hidden unless asked for.
  const hasCost = (r: (typeof allRows)[number]) =>
    r.cost.total.estimated !== 0 || r.cost.total.actual !== 0;
  const rows = showEmpty || isCsv ? allRows : allRows.filter(hasCost);
  const hiddenEmpty = allRows.length - rows.length;

  if (isCsv) {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = [
      "Job",
      "Customer",
      "Part",
      "Status",
      "Due",
      "Estimated cost",
      "Actual cost",
      "Material est",
      "Material act",
      "Labor est",
      "Labor act",
      "Overhead est",
      "Overhead act",
      "Outside est",
      "Outside act",
      "Hours est",
      "Hours act",
      "Sale price",
      "Margin est",
      "Margin act"
    ];
    const n = (x: number | null | undefined) =>
      x === null || x === undefined ? "" : x.toFixed(2);
    const body = rows.map((r) => [
      r.jobId,
      r.customer,
      r.part,
      r.status,
      r.dueDate,
      n(r.cost.total.estimated),
      n(r.cost.total.actual),
      n(r.cost.material.estimated),
      n(r.cost.material.actual),
      n(r.cost.labor.estimated),
      n(r.cost.labor.actual),
      n(r.cost.overhead.estimated),
      n(r.cost.overhead.actual),
      n(r.cost.outside.estimated),
      n(r.cost.outside.actual),
      n(r.cost.hours.estimated),
      n(r.cost.hours.actual),
      n(r.cost.revenue),
      n(r.cost.margin?.estimated),
      n(r.cost.margin?.actual)
    ]);
    const csv = [head, ...body].map((r) => r.map(esc).join(",")).join("\n");
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="job-costs.csv"`
      }
    });
  }

  // Totals and actual margin count finished jobs only; open jobs show their estimate and cost so far.
  // Margin counts only jobs with a sale price: a $0 order line has no price to measure against.
  const totals = rows
    .filter((r) => FINISHED.includes(r.status as string))
    .reduce(
      (a, r) => {
        a.estimated += r.cost.total.estimated;
        a.actual += r.cost.total.actual;
        if (r.cost.revenue !== null) {
          a.revenue += r.cost.revenue;
          a.pricedActual += r.cost.total.actual;
        } else if (r.cost.noPrice) a.noPrice += 1;
        return a;
      },
      { estimated: 0, actual: 0, revenue: 0, pricedActual: 0, noPrice: 0 }
    );
  return {
    rows,
    totals,
    statuses,
    search,
    page,
    pages: Math.max(1, Math.ceil(totalJobs / PAGE_SIZE)),
    totalJobs,
    hiddenEmpty,
    showEmpty
  };
}

export default function JobCostsRoute() {
  const {
    rows,
    totals,
    statuses,
    search,
    page,
    pages,
    totalJobs,
    hiddenEmpty,
    showEmpty
  } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const money = useCurrencyFormatter();
  const pct = usePercentFormatter();
  const [params] = useSearchParams();
  const csvHref = `?${new URLSearchParams([...[...params.entries()].filter(([k]) => k !== "page"), ["format", "csv"]]).toString()}`;
  const pageHref = (p: number) => {
    const q = new URLSearchParams(params);
    q.set("page", String(p));
    return `?${q.toString()}`;
  };
  return (
    <VStack spacing={4} className="p-4 w-full h-full overflow-y-auto">
      <HStack className="w-full justify-between">
        <h2 className="text-2xl font-semibold">
          <Trans>Job Costs</Trans>
        </h2>
        <a className="text-sm underline" href={csvHref}>
          <Trans>Download CSV</Trans>
        </a>
      </HStack>
      <Form method="get" className="flex flex-wrap gap-3 items-center text-sm">
        <input
          name="search"
          defaultValue={search}
          placeholder={t`Job number`}
          className="border rounded px-2 py-1 bg-background"
        />
        {STATUSES.map((s) => (
          <label key={s} className="flex items-center gap-1">
            <input
              type="checkbox"
              name="status"
              value={s}
              defaultChecked={statuses.includes(s)}
            />
            {s}
          </label>
        ))}
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            name="empty"
            value="1"
            defaultChecked={showEmpty}
          />
          <Trans>Include jobs with no cost</Trans>
        </label>
        <button type="submit" className="border rounded px-3 py-1">
          <Trans>Show</Trans>
        </button>
      </Form>
      <p className="text-sm text-muted-foreground">
        <Trans>
          Jobs on a sales order. Cost = material + labor + machine + overhead +
          outside processing; actual uses the hours clocked and the material
          issued. Margin = sale price − cost.
        </Trans>{" "}
        <Trans>
          Page {page} of {pages} ({totalJobs} jobs, newest due first); totals
          are for this page.
        </Trans>
        {hiddenEmpty > 0 && (
          <>
            {" "}
            <Trans>{hiddenEmpty} jobs with no cost hidden on this page.</Trans>
          </>
        )}
      </p>
      <HStack spacing={6} className="text-sm">
        <span>
          <Trans>Estimated cost</Trans>: <b>{money.format(totals.estimated)}</b>
        </span>
        <span>
          <Trans>Actual cost</Trans>: <b>{money.format(totals.actual)}</b>
        </span>
        <span>
          <Trans>Sales</Trans>: <b>{money.format(totals.revenue)}</b>
        </span>
        <span>
          <Trans>Margin</Trans>:{" "}
          <b>{money.format(totals.revenue - totals.pricedActual)}</b>
          {totals.revenue > 0 &&
            ` (${pct.format((totals.revenue - totals.pricedActual) / totals.revenue)})`}
        </span>
        {totals.noPrice > 0 && (
          <span className="text-muted-foreground">
            <Trans>
              {totals.noPrice} finished jobs have a $0 sale price and are left
              out of the margin.
            </Trans>
          </span>
        )}
      </HStack>
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
              <Trans>Part</Trans>
            </Th>
            <Th>
              <Trans>Status</Trans>
            </Th>
            <Th className="text-right">
              <Trans>Est. cost</Trans>
            </Th>
            <Th className="text-right">
              <Trans>Actual cost</Trans>
            </Th>
            <Th className="text-right">
              <Trans>Sale price</Trans>
            </Th>
            <Th className="text-right">
              <Trans>Est. margin</Trans>
            </Th>
            <Th className="text-right">
              <Trans>Actual margin</Trans>
            </Th>
          </Tr>
        </Thead>
        <Tbody>
          {rows.map((r) => {
            const c = r.cost;
            const over =
              c.total.estimated > 0 && c.total.actual > c.total.estimated;
            const m = (x?: number) =>
              c.revenue && x !== undefined
                ? ` (${pct.format(x / c.revenue)})`
                : "";
            return (
              <Tr key={r.id}>
                <Td>
                  <Link className="underline" to={path.to.jobDetails(r.id)}>
                    {r.jobId}
                  </Link>
                </Td>
                <Td>{r.customer}</Td>
                <Td>{r.part}</Td>
                <Td>
                  <Badge variant="secondary">{r.status}</Badge>
                </Td>
                <Td className="text-right">
                  {money.format(c.total.estimated)}
                </Td>
                <Td className={cn("text-right", over && "text-red-500")}>
                  {money.format(c.total.actual)}
                </Td>
                <Td className="text-right">
                  {c.revenue !== null ? (
                    money.format(c.revenue)
                  ) : c.noPrice ? (
                    <span className="text-muted-foreground">
                      <Trans>$0 on order</Trans>
                    </span>
                  ) : (
                    ""
                  )}
                </Td>
                <Td className="text-right">
                  {c.margin
                    ? money.format(c.margin.estimated) + m(c.margin.estimated)
                    : ""}
                </Td>
                <Td
                  className={cn(
                    "text-right",
                    (c.margin?.actual ?? 0) < 0 && "text-red-500"
                  )}
                >
                  {c.margin && FINISHED.includes(r.status as string)
                    ? money.format(c.margin.actual) + m(c.margin.actual)
                    : c.margin
                      ? t`open`
                      : ""}
                </Td>
              </Tr>
            );
          })}
        </Tbody>
      </Table>
      <HStack spacing={4} className="text-sm">
        {page > 1 && (
          <Link className="underline" to={pageHref(page - 1)}>
            <Trans>Previous</Trans>
          </Link>
        )}
        <span>
          <Trans>
            Page {page} of {pages}
          </Trans>
        </span>
        {page < pages && (
          <Link className="underline" to={pageHref(page + 1)}>
            <Trans>Next</Trans>
          </Link>
        )}
      </HStack>
    </VStack>
  );
}
