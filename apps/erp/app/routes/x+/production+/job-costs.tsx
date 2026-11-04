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
const LIMIT = 400;
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

  let q = client
    .from("job")
    .select(
      "id, jobId, status, dueDate, completedDate, customerId, itemId, quantity, salesOrderLineId"
    )
    .eq("companyId", companyId)
    .not("salesOrderLineId", "is", null)
    .in("status", statuses as any)
    .order("dueDate", { ascending: false, nullsFirst: false })
    .limit(LIMIT);
  if (search) q = q.ilike("jobId", `%${search}%`);
  const jobs = await q;
  if (jobs.error) throw jobs.error;
  const list = jobs.data ?? [];

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
  const rows = list.map((j) => ({
    id: j.id,
    jobId: j.jobId,
    status: j.status,
    dueDate: j.dueDate,
    customer: (j.customerId && customerName.get(j.customerId)) || "",
    part: (j.itemId && itemId.get(j.itemId)) || "",
    cost: costs.get(j.id)!
  }));

  if (url.searchParams.get("format") === "csv") {
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
  const totals = rows
    .filter((r) => FINISHED.includes(r.status as string))
    .reduce(
      (a, r) => {
        a.estimated += r.cost.total.estimated;
        a.actual += r.cost.total.actual;
        a.revenue += r.cost.revenue ?? 0;
        return a;
      },
      { estimated: 0, actual: 0, revenue: 0 }
    );
  return { rows, totals, statuses, search, limited: list.length === LIMIT };
}

export default function JobCostsRoute() {
  const { rows, totals, statuses, search, limited } =
    useLoaderData<typeof loader>();
  const { t } = useLingui();
  const money = useCurrencyFormatter();
  const pct = usePercentFormatter();
  const [params] = useSearchParams();
  const csvHref = `?${new URLSearchParams([...params.entries(), ["format", "csv"]]).toString()}`;
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
        {limited && <Trans>Showing the newest 400; search to narrow.</Trans>}
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
          <b>{money.format(totals.revenue - totals.actual)}</b>
          {totals.revenue > 0 &&
            ` (${pct.format((totals.revenue - totals.actual) / totals.revenue)})`}
        </span>
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
                  {c.revenue === null ? "" : money.format(c.revenue)}
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
    </VStack>
  );
}
