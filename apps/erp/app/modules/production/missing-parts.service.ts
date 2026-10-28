// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { fetchAll } from "@carbon/database/fetch-all";
import type { CalendarDate } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildMissingParts,
  type MissingPartsDemandLine,
  type MissingPartsItem,
  type MissingPartsJob,
  type MissingPartsPeriod,
  type MissingPartsProductionLine,
  type MissingPartsPurchaseLine,
  type MissingPartsResult,
  type MissingPartsSalesLine
} from "./ui/Jobs/missing-parts-logic";

// Every job that pulls on stock, released or not: the same demand window as
// get_job_quantity_on_hand and MRP (openJobMaterialLines).
const ACTIVE_JOB_STATUSES = [
  "Planned",
  "Ready",
  "In Progress",
  "Paused"
] as const satisfies readonly Database["public"]["Enums"]["jobStatus"][];

function chunks<T>(rows: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/**
 * The open orders behind the Jobs Missing Parts view, at one location: active
 * jobs, their open material lines, the open sales and purchase order lines and
 * jobs that supply the same parts, draft purchase orders, and on-hand. Reads
 * the views MRP reads, so the weeks agree with Purchase Planning's open orders.
 */
export async function getMissingParts(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    locationId: string;
    today: CalendarDate;
    periods: MissingPartsPeriod[];
  }
): Promise<{ data: MissingPartsResult | null; error: unknown }> {
  const { companyId, locationId, today, periods } = args;

  const [jobs, demand] = await Promise.all([
    fetchAll<{
      id: string;
      jobId: string;
      status: string;
      dueDate: string | null;
      customerId: string | null;
      item: { readableId: string } | null;
    }>(() =>
      client
        .from("job")
        .select("id, jobId, status, dueDate, customerId, item(readableId)")
        .eq("companyId", companyId)
        .eq("locationId", locationId)
        .in("status", ACTIVE_JOB_STATUSES)
        .order("id")
    ),
    fetchAll<{
      id: string;
      jobId: string;
      jobReadableId: string;
      itemId: string;
      quantityToIssue: number;
      dueDate: string | null;
      leadTime: number | null;
      itemTrackingType: string | null;
    }>(() =>
      client
        .from("openJobMaterialLines")
        .select(
          "id, jobId, jobReadableId, itemId, quantityToIssue, dueDate, leadTime, itemTrackingType"
        )
        .eq("companyId", companyId)
        .eq("locationId", locationId)
        .gt("quantityToIssue", 0)
        .order("id")
    )
  ]);
  if (jobs.error) return { data: null, error: jobs.error };
  if (demand.error) return { data: null, error: demand.error };

  // Non-Inventory parts aren't stocked, so they're never short.
  const demandLines: MissingPartsDemandLine[] = (demand.data ?? [])
    .filter((l) => l.itemTrackingType !== "Non-Inventory")
    .map((l) => ({
      id: l.id,
      jobId: l.jobId,
      jobReadableId: l.jobReadableId,
      itemId: l.itemId,
      quantityToIssue: Number(l.quantityToIssue),
      dueDate: l.dueDate,
      leadTime: l.leadTime
    }));
  const itemIds = [...new Set(demandLines.map((l) => l.itemId))];

  const items: MissingPartsItem[] = [];
  const onHandByItem: Record<string, number> = {};
  const salesLines: MissingPartsSalesLine[] = [];
  const purchaseLines: MissingPartsPurchaseLine[] = [];
  const productionLines: MissingPartsProductionLine[] = [];
  const draftPurchaseLines: MissingPartsPurchaseLine[] = [];

  for (const ids of chunks(itemIds)) {
    const [itemRows, quantities, sales, purchases, production, drafts] =
      await Promise.all([
        client
          .from("item")
          .select("id, readableIdWithRevision, name, unitOfMeasureCode")
          .in("id", ids),
        client
          .rpc("get_inventory_quantities", {
            company_id: companyId,
            location_id: locationId
          })
          .select("id, quantityOnHand")
          .in("id", ids),
        client
          .from("openSalesOrderLines")
          .select("id, salesOrderId, itemId, quantityToSend, promisedDate")
          .eq("companyId", companyId)
          .eq("locationId", locationId)
          .in("itemId", ids),
        client
          .from("openPurchaseOrderLines")
          .select(
            "id, purchaseOrderId, purchaseOrderReadableId, itemId, quantityToReceive, promisedDate, status"
          )
          .eq("companyId", companyId)
          .eq("locationId", locationId)
          .in("itemId", ids),
        client
          .from("openProductionOrders")
          .select("id, jobId, itemId, quantityToReceive, dueDate")
          .eq("companyId", companyId)
          .eq("locationId", locationId)
          .in("itemId", ids),
        // Draft orders aren't supply yet (openPurchaseOrderLines leaves them
        // out); they're listed so nobody orders a part twice.
        client
          .from("purchaseOrderLine")
          .select(
            "id, purchaseOrderId, itemId, quantityToReceive, conversionFactor, promisedDate, purchaseOrder!inner(purchaseOrderId, status)"
          )
          .eq("companyId", companyId)
          .eq("locationId", locationId)
          .eq("purchaseOrder.status", "Draft")
          .eq("receivedComplete", false)
          .in("itemId", ids)
      ]);
    for (const r of [
      itemRows,
      quantities,
      sales,
      purchases,
      production,
      drafts
    ]) {
      if (r.error) return { data: null, error: r.error };
    }

    for (const i of itemRows.data ?? []) {
      items.push({
        id: i.id,
        readableId: i.readableIdWithRevision ?? i.id,
        name: i.name,
        unitOfMeasureCode: i.unitOfMeasureCode
      });
    }
    for (const q of (quantities.data ?? []) as {
      id: string;
      quantityOnHand: number | null;
    }[]) {
      onHandByItem[q.id] = Number(q.quantityOnHand ?? 0);
    }
    for (const s of sales.data ?? []) {
      if (!s.itemId || !s.salesOrderId) continue;
      salesLines.push({
        id: s.id ?? "",
        salesOrderId: s.salesOrderId,
        salesOrderReadableId: null,
        itemId: s.itemId,
        quantityToSend: Number(s.quantityToSend ?? 0),
        promisedDate: s.promisedDate
      });
    }
    for (const p of purchases.data ?? []) {
      if (!p.itemId || !p.purchaseOrderId) continue;
      purchaseLines.push({
        id: p.id ?? "",
        purchaseOrderId: p.purchaseOrderId,
        purchaseOrderReadableId: p.purchaseOrderReadableId ?? "",
        itemId: p.itemId,
        quantityToReceive: Number(p.quantityToReceive ?? 0),
        promisedDate: p.promisedDate,
        status: p.status ?? ""
      });
    }
    for (const p of production.data ?? []) {
      if (!p.itemId || !p.id) continue;
      productionLines.push({
        id: p.id,
        jobId: p.id,
        jobReadableId: p.jobId,
        itemId: p.itemId,
        quantityToReceive: Number(p.quantityToReceive ?? 0),
        dueDate: p.dueDate
      });
    }
    for (const d of (drafts.data ?? []) as unknown as {
      id: string;
      purchaseOrderId: string;
      itemId: string;
      quantityToReceive: number | null;
      conversionFactor: number | null;
      promisedDate: string | null;
      purchaseOrder: { purchaseOrderId: string; status: string };
    }[]) {
      draftPurchaseLines.push({
        id: d.id,
        purchaseOrderId: d.purchaseOrderId,
        purchaseOrderReadableId: d.purchaseOrder.purchaseOrderId,
        itemId: d.itemId,
        quantityToReceive:
          Number(d.quantityToReceive ?? 0) * Number(d.conversionFactor ?? 1),
        promisedDate: d.promisedDate,
        status: d.purchaseOrder.status
      });
    }
  }

  // Sales order numbers for the week details.
  const salesOrderIds = [...new Set(salesLines.map((s) => s.salesOrderId))];
  const salesOrderNumbers = new Map<string, string>();
  for (const ids of chunks(salesOrderIds)) {
    const orders = await client
      .from("salesOrder")
      .select("id, salesOrderId")
      .in("id", ids);
    if (orders.error) return { data: null, error: orders.error };
    for (const o of orders.data ?? [])
      salesOrderNumbers.set(o.id, o.salesOrderId);
  }
  for (const s of salesLines) {
    s.salesOrderReadableId = salesOrderNumbers.get(s.salesOrderId) ?? null;
  }

  const jobRows: MissingPartsJob[] = (jobs.data ?? []).map((j) => ({
    id: j.id,
    jobId: j.jobId,
    status: j.status,
    dueDate: j.dueDate,
    customerId: j.customerId,
    itemReadableId: j.item?.readableId ?? null
  }));

  return {
    data: buildMissingParts({
      today,
      periods,
      jobs: jobRows,
      items,
      onHandByItem,
      demandLines,
      salesLines,
      purchaseLines,
      productionLines,
      draftPurchaseLines
    }),
    error: null
  };
}

/** The dashboard card: released jobs short of a part right now, or null when
 *  it can't be worked out (no location, a failed read). */
export async function countJobsMissingParts(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    locationId: string;
    today: CalendarDate;
    periods: MissingPartsPeriod[];
  }
): Promise<number | null> {
  const result = await getMissingParts(client, args);
  return result.data ? result.data.jobsMissingParts : null;
}
