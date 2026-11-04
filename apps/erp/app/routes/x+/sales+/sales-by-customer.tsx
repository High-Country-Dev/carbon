// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// LAND-296 / LAND-299 (ABS, Steve and Eric: "sales by customer"): one row per customer for a date range —
// what we invoiced, what's been paid, what's still owed and overdue, open orders, quotes, and the margin on
// their sales-order jobs (estimate vs actual, from the job cost service). Margin columns need Resources
// access (costs, LAND-271). ?format=csv downloads it.
import { hasPermission } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import {
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
import {
  useCurrencyFormatter,
  usePercentFormatter,
  usePermissions
} from "~/hooks";
import { getJobCosts } from "~/modules/production/job-cost.service";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Sales by Customer`,
  to: path.to.salesByCustomer
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
        `sales by customer query failed: ${(r.error as any).message ?? r.error}`
      );
    out.push(...(r.data ?? []));
    if ((r.data ?? []).length < 1000) break;
  }
  return out;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, permissions } = await requirePermissions(request, {
    view: "sales",
    bypassRls: true
  });
  const url = new URL(request.url);
  const today = new Date();
  const from =
    url.searchParams.get("from") ||
    iso(new Date(today.getFullYear() - 1, today.getMonth(), today.getDate()));
  const to = url.searchParams.get("to") || iso(today);
  const canSeeCosts = hasPermission(
    permissions,
    "resources",
    "view",
    companyId
  );

  const [invoices, orders, quotes, customers] = await Promise.all([
    all((a, b) =>
      client
        .from("salesInvoices")
        .select(
          "id, customerId, status, dateIssued, dateDue, datePaid, invoiceTotal, balance"
        )
        .eq("companyId", companyId)
        .gte("dateIssued", from)
        .lte("dateIssued", to)
        .not("status", "in", '("Draft","Voided")')
        .order("id")
        .range(a, b)
    ),
    all((a, b) =>
      client
        .from("salesOrders")
        .select("id, customerId, status, orderDate, orderTotal")
        .eq("companyId", companyId)
        .order("id")
        .range(a, b)
    ),
    all((a, b) =>
      client
        .from("quote")
        .select("id, customerId, status, createdAt")
        .eq("companyId", companyId)
        .gte("createdAt", from)
        .lte("createdAt", `${to}T23:59:59`)
        .order("id")
        .range(a, b)
    ),
    all((a, b) =>
      client
        .from("customer")
        .select("id, name")
        .eq("companyId", companyId)
        .order("id")
        .range(a, b)
    )
  ]);

  type Row = {
    id: string;
    name: string;
    invoiced: number;
    paid: number;
    open: number;
    overdue: number;
    invoices: number;
    openOrders: number;
    openOrderValue: number;
    quotes: number;
    quotesWon: number;
    jobs: number;
    revenue: number;
    costEstimated: number;
    costActual: number;
  };
  const rows = new Map<string, Row>();
  const name = new Map((customers as any[]).map((c) => [c.id, c.name]));
  const row = (id: string) => {
    let r = rows.get(id);
    if (!r) {
      r = {
        id,
        name: name.get(id) ?? id,
        invoiced: 0,
        paid: 0,
        open: 0,
        overdue: 0,
        invoices: 0,
        openOrders: 0,
        openOrderValue: 0,
        quotes: 0,
        quotesWon: 0,
        jobs: 0,
        revenue: 0,
        costEstimated: 0,
        costActual: 0
      };
      rows.set(id, r);
    }
    return r;
  };
  const todayIso = iso(today);
  for (const i of invoices as any[]) {
    if (!i.customerId) continue;
    const r = row(i.customerId);
    const total = Number(i.invoiceTotal ?? 0),
      bal = Number(i.balance ?? 0);
    r.invoices += 1;
    r.invoiced += total;
    r.open += bal;
    r.paid += total - bal;
    if (bal > 0 && i.dateDue && i.dateDue < todayIso) r.overdue += bal;
  }
  for (const o of orders as any[]) {
    if (!o.customerId) continue;
    if (["Completed", "Cancelled", "Closed", "Invoiced"].includes(o.status))
      continue;
    const r = row(o.customerId);
    r.openOrders += 1;
    r.openOrderValue += Number(o.orderTotal ?? 0);
  }
  for (const q of quotes as any[]) {
    if (!q.customerId) continue;
    const r = row(q.customerId);
    r.quotes += 1;
    if (["Ordered", "Partial"].includes(q.status)) r.quotesWon += 1;
  }

  const sorted = [...rows.values()].sort((a, b) => b.invoiced - a.invoiced);
  // Paged (25 customers): job margins are worked out only for the customers on this page; the CSV takes them all.
  const isCsv = url.searchParams.get("format") === "csv";
  const PAGE_SIZE = 25;
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const list = isCsv
    ? sorted
    : sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageCustomers = new Set(list.map((r) => r.id));
  if (canSeeCosts) {
    const jobs = await all((a, b) =>
      client
        .from("job")
        .select("id, customerId, completedDate, dueDate, status")
        .eq("companyId", companyId)
        .not("salesOrderLineId", "is", null)
        .in("status", ["Completed", "Closed"])
        .order("id")
        .range(a, b)
    );
    const inRange = (jobs as any[]).filter((j) => {
      const d = (j.completedDate ?? j.dueDate ?? "").slice(0, 10);
      return (
        j.customerId && pageCustomers.has(j.customerId) && d >= from && d <= to
      );
    });
    const costs = await getJobCosts(
      client,
      companyId,
      inRange.map((j) => j.id)
    );
    for (const j of inRange) {
      const c = costs.get(j.id);
      if (!c || c.revenue === null) continue;
      const r = row(j.customerId);
      r.jobs += 1;
      r.revenue += c.revenue;
      r.costEstimated += c.total.estimated;
      r.costActual += c.total.actual;
    }
  }

  if (url.searchParams.get("format") === "csv") {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = [
      "Customer",
      "Invoices",
      "Invoiced",
      "Paid",
      "Open",
      "Overdue",
      "Open orders",
      "Open order value",
      "Quotes",
      "Quotes won",
      ...(canSeeCosts
        ? [
            "Jobs closed",
            "Job sales",
            "Est. cost",
            "Actual cost",
            "Est. margin",
            "Actual margin"
          ]
        : [])
    ];
    const n = (x: number) => x.toFixed(2);
    const body = list.map((r) => [
      r.name,
      r.invoices,
      n(r.invoiced),
      n(r.paid),
      n(r.open),
      n(r.overdue),
      r.openOrders,
      n(r.openOrderValue),
      r.quotes,
      r.quotesWon,
      ...(canSeeCosts
        ? [
            r.jobs,
            n(r.revenue),
            n(r.costEstimated),
            n(r.costActual),
            n(r.revenue - r.costEstimated),
            n(r.revenue - r.costActual)
          ]
        : [])
    ]);
    return new Response(
      [head, ...body].map((r) => r.map(esc).join(",")).join("\n"),
      {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="sales-by-customer.csv"`
        }
      }
    );
  }
  const sum = (k: "invoiced" | "paid" | "open" | "overdue") =>
    sorted.reduce((a, r) => a + r[k], 0);
  const totals = {
    invoiced: sum("invoiced"),
    paid: sum("paid"),
    open: sum("open"),
    overdue: sum("overdue")
  };
  return {
    rows: list,
    from,
    to,
    page,
    pages,
    customers: sorted.length,
    totals
  };
}

export default function SalesByCustomerRoute() {
  const { rows, from, to, page, pages, customers, totals } =
    useLoaderData<typeof loader>();
  const { t } = useLingui();
  const money = useCurrencyFormatter();
  const pct = usePercentFormatter();
  const canSeeCosts = usePermissions().can("view", "resources");
  const [params] = useSearchParams();
  const csvHref = `?${new URLSearchParams([...[...params.entries()].filter(([k]) => k !== "page"), ["format", "csv"]]).toString()}`;
  const sum = (k: "invoiced" | "paid" | "open" | "overdue") => totals[k];
  const pageHref = (p: number) => {
    const q = new URLSearchParams(params);
    q.set("page", String(p));
    return `?${q.toString()}`;
  };
  return (
    <VStack spacing={4} className="p-4 w-full h-full overflow-y-auto">
      <HStack className="w-full justify-between">
        <h2 className="text-2xl font-semibold">
          <Trans>Sales by Customer</Trans>
        </h2>
        <a className="text-sm underline" href={csvHref}>
          <Trans>Download CSV</Trans>
        </a>
      </HStack>
      <Form method="get" className="flex flex-wrap gap-3 items-center text-sm">
        <label className="flex items-center gap-1">
          <Trans>From</Trans>
          <input
            type="date"
            name="from"
            defaultValue={from}
            className="border rounded px-2 py-1 bg-background"
          />
        </label>
        <label className="flex items-center gap-1">
          <Trans>To</Trans>
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
      <p className="text-sm text-muted-foreground">
        <Trans>
          Invoices issued in the dates above (not drafts or voided). Open orders
          are every order not yet completed. Margin is for sales-order jobs
          completed or closed in the dates above: sale price minus job cost.
        </Trans>
      </p>
      <HStack spacing={6} className="text-sm">
        <span>
          <Trans>Invoiced</Trans>: <b>{money.format(sum("invoiced"))}</b>
        </span>
        <span>
          <Trans>Paid</Trans>: <b>{money.format(sum("paid"))}</b>
        </span>
        <span>
          <Trans>Still owed</Trans>: <b>{money.format(sum("open"))}</b>
        </span>
        <span>
          <Trans>Overdue</Trans>: <b>{money.format(sum("overdue"))}</b>
        </span>
      </HStack>
      <Table>
        <Thead>
          <Tr>
            <Th>
              <Trans>Customer</Trans>
            </Th>
            <Th className="text-right">
              <Trans>Invoiced</Trans>
            </Th>
            <Th className="text-right">
              <Trans>Paid</Trans>
            </Th>
            <Th className="text-right">
              <Trans>Still owed</Trans>
            </Th>
            <Th className="text-right">
              <Trans>Overdue</Trans>
            </Th>
            <Th className="text-right">
              <Trans>Open orders</Trans>
            </Th>
            <Th className="text-right">
              <Trans>Quotes (won)</Trans>
            </Th>
            {canSeeCosts && (
              <Th className="text-right">
                <Trans>Job margin est.</Trans>
              </Th>
            )}
            {canSeeCosts && (
              <Th className="text-right">
                <Trans>Job margin actual</Trans>
              </Th>
            )}
          </Tr>
        </Thead>
        <Tbody>
          {rows.map((r) => {
            const est = r.revenue - r.costEstimated,
              act = r.revenue - r.costActual;
            const p = (x: number) =>
              r.revenue ? ` (${pct.format(x / r.revenue)})` : "";
            return (
              <Tr key={r.id}>
                <Td>
                  <Link className="underline" to={path.to.customer(r.id)}>
                    {r.name}
                  </Link>
                </Td>
                <Td className="text-right">{money.format(r.invoiced)}</Td>
                <Td className="text-right">{money.format(r.paid)}</Td>
                <Td className="text-right">{money.format(r.open)}</Td>
                <Td
                  className={cn("text-right", r.overdue > 0 && "text-red-500")}
                >
                  {money.format(r.overdue)}
                </Td>
                <Td className="text-right">
                  {r.openOrders
                    ? `${money.format(r.openOrderValue)} (${r.openOrders})`
                    : ""}
                </Td>
                <Td className="text-right">
                  {r.quotes ? `${r.quotes} (${r.quotesWon})` : ""}
                </Td>
                {canSeeCosts && (
                  <Td className="text-right">
                    {r.jobs ? money.format(est) + p(est) : ""}
                  </Td>
                )}
                {canSeeCosts && (
                  <Td
                    className={cn(
                      "text-right",
                      r.jobs > 0 && act < 0 && "text-red-500"
                    )}
                  >
                    {r.jobs ? money.format(act) + p(act) : ""}
                  </Td>
                )}
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
            Page {page} of {pages} ({customers} customers, most invoiced first)
          </Trans>
        </span>
        {page < pages && (
          <Link className="underline" to={pageHref(page + 1)}>
            <Trans>Next</Trans>
          </Link>
        )}
      </HStack>
      <p className="text-xs text-muted-foreground">{t`Paid = invoiced minus what's still owed on those invoices.`}</p>
    </VStack>
  );
}
