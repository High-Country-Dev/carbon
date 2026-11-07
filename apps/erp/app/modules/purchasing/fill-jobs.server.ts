// Fill Jobs (LAND-306): Purchasing's one page for a released job — see what it
// needs, fill it from stock, order the rest. Logic in fill-jobs-logic.ts.
//
// Fill from stock posts through the `issue` posting's `partToOperation` (the
// MES's issue-material path): stock leaves its bin and lands on the job line,
// like JobBOSS's posting (Declan, 11/6). Order the rest raises one Draft PO per
// vendor; each line carries the job (receiving ignores it for parts; the PO
// sign-off then counts it as job material, not a non-job purchase).

import { CarbonError, defineServiceFn } from "@carbon/api/service-fn.server";
import type { Database } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { issueMaterial } from "~/modules/inventory/inventory.service";
import { invokePosting } from "~/modules/shared/shared.service";
import {
  classifyLine,
  type FillLine,
  isServiceLine,
  purchaseQuantityFor
} from "./fill-jobs-logic";
import * as service from "./purchasing.service";

const logger = getLogger("erp", "purchasing/fill-jobs");

/** Released jobs Purchasing fills: Ready or In Progress at the location. */
const FILL_JOB_STATUSES = ["Ready", "In Progress"] as const;

export type FillJob = {
  id: string;
  jobId: string;
  status: string;
  releasedDate: string | null;
  dueDate: string | null;
  itemReadableId: string | null;
  itemName: string | null;
};

export async function getFillJobs(
  client: SupabaseClient<Database>,
  args: { companyId: string; locationId: string }
): Promise<{ data: FillJob[]; error: unknown }> {
  const res = await client
    .from("job")
    .select("id, jobId, status, releasedDate, dueDate, item(readableId, name)")
    .eq("companyId", args.companyId)
    .eq("locationId", args.locationId)
    .in(
      "status",
      FILL_JOB_STATUSES as unknown as Database["public"]["Enums"]["jobStatus"][]
    )
    .order("releasedDate", { ascending: false, nullsFirst: false })
    .limit(500);
  return {
    error: res.error,
    data: (res.data ?? []).map((j) => {
      const item = j.item as unknown as {
        readableId: string;
        name: string;
      } | null;
      return {
        id: j.id,
        jobId: j.jobId,
        status: j.status as string,
        releasedDate: j.releasedDate ?? null,
        dueDate: j.dueDate ?? null,
        itemReadableId: item?.readableId ?? null,
        itemName: item?.name ?? null
      };
    })
  };
}

export type FillJobLine = FillLine & {
  hidden: boolean; // per diem / labor (LAND-308)
  storageUnitName: string | null;
  vendor: {
    supplierId: string;
    name: string;
    supplierUnitOfMeasureCode: string | null;
    conversionFactor: number;
    minimumOrderQuantity: number | null;
    orderMultiple: number | null;
    supplierUnitPrice: number | null;
  } | null;
  unitCost: number;
};

export async function getFillJobLines(
  client: SupabaseClient<Database>,
  args: { companyId: string; locationId: string; jobId: string }
): Promise<{
  data: {
    job: { id: string; jobId: string; locationId: string | null };
    lines: FillJobLine[];
  } | null;
  error: unknown;
}> {
  const { companyId, jobId } = args;
  const job = await client
    .from("job")
    .select("id, jobId, locationId")
    .eq("id", jobId)
    .eq("companyId", companyId)
    .single();
  if (job.error || !job.data)
    return { data: null, error: job.error ?? new Error("Job not found") };
  const locationId = job.data.locationId ?? args.locationId;

  const mats = await client
    .from("jobMaterial")
    .select(
      "id, jobOperationId, itemId, description, unitOfMeasureCode, estimatedQuantity, quantityIssued, quantityToIssue, methodType, storageUnitId, order, item(readableId, name, unitOfMeasureCode), storageUnit:storageUnit!jobMaterial_storageUnitId_fkey(name)"
    )
    .eq("jobId", jobId)
    .eq("companyId", companyId)
    .order("order");
  if (mats.error) return { data: null, error: mats.error };
  const rows = (mats.data ?? []) as unknown as {
    id: string;
    jobOperationId: string | null;
    itemId: string;
    description: string | null;
    unitOfMeasureCode: string | null;
    estimatedQuantity: number | null;
    quantityIssued: number | null;
    quantityToIssue: number | null;
    methodType: string;
    storageUnitId: string | null;
    item: {
      readableId: string;
      name: string;
      unitOfMeasureCode: string | null;
    } | null;
    storageUnit: { name: string } | null;
  }[];
  const itemIds = [...new Set(rows.map((r) => r.itemId))];
  if (itemIds.length === 0)
    return {
      data: { job: { ...job.data, locationId }, lines: [] },
      error: null
    };

  const [stock, openPos, draftPos, repl, parts, costs] = await Promise.all([
    client
      .from("itemStockQuantities")
      .select("itemId, quantityOnHand")
      .eq("companyId", companyId)
      .eq("locationId", locationId!)
      .in("itemId", itemIds),
    client
      .from("openPurchaseOrderLines")
      .select(
        "itemId, purchaseOrderReadableId, quantityToReceive, promisedDate, dueDate"
      )
      .eq("companyId", companyId)
      .in("itemId", itemIds),
    // Drafts aren't in openPurchaseOrderLines; count them so a second "Order the
    // rest" doesn't raise a duplicate PO.
    client
      .from("purchaseOrderLine")
      .select(
        "itemId, quantityToReceive, conversionFactor, requiredDate, purchaseOrder!inner(purchaseOrderId, status)"
      )
      .eq("companyId", companyId)
      .eq("purchaseOrder.status", "Draft")
      .neq("purchaseOrderLineType", "Service")
      .in("itemId", itemIds),
    client
      .from("itemReplenishment")
      .select("itemId, preferredSupplierId")
      .eq("companyId", companyId)
      .in("itemId", itemIds),
    client
      .from("supplierPart")
      .select(
        "itemId, supplierId, supplierUnitOfMeasureCode, conversionFactor, minimumOrderQuantity, orderMultiple, supplierUnitPrice, supplier(name, supplierStatus)"
      )
      .eq("companyId", companyId)
      .in("itemId", itemIds),
    client
      .from("itemCost")
      .select("itemId, unitCost")
      .eq("companyId", companyId)
      .in("itemId", itemIds)
  ]);
  for (const r of [stock, openPos, draftPos, repl, parts, costs])
    if (r.error) return { data: null, error: r.error };

  const onHand = new Map<string, number>();
  for (const s of stock.data ?? [])
    onHand.set(
      s.itemId!,
      (onHand.get(s.itemId!) ?? 0) + Number(s.quantityOnHand ?? 0)
    );
  const orders = new Map<string, FillLine["onOrder"]>();
  for (const o of openPos.data ?? []) {
    const list = orders.get(o.itemId!) ?? [];
    list.push({
      purchaseOrderReadableId: o.purchaseOrderReadableId ?? "",
      quantity: Number(o.quantityToReceive ?? 0),
      promisedDate: o.promisedDate ?? o.dueDate ?? null
    });
    orders.set(o.itemId!, list);
  }
  for (const o of (draftPos.data ?? []) as unknown as {
    itemId: string;
    quantityToReceive: number | null;
    conversionFactor: number | null;
    requiredDate: string | null;
    purchaseOrder: { purchaseOrderId: string };
  }[]) {
    const list = orders.get(o.itemId) ?? [];
    list.push({
      purchaseOrderReadableId: o.purchaseOrder.purchaseOrderId,
      quantity:
        Number(o.quantityToReceive ?? 0) *
        (Number(o.conversionFactor ?? 1) || 1),
      promisedDate: o.requiredDate,
      draft: true
    });
    orders.set(o.itemId, list);
  }
  const preferred = new Map(
    (repl.data ?? []).map((r) => [r.itemId, r.preferredSupplierId])
  );
  const cost = new Map(
    (costs.data ?? []).map((c) => [c.itemId, Number(c.unitCost ?? 0)])
  );
  const vendorFor = (itemId: string): FillJobLine["vendor"] => {
    const all = (
      (parts.data ?? []) as unknown as {
        itemId: string;
        supplierId: string;
        supplierUnitOfMeasureCode: string | null;
        conversionFactor: number | null;
        minimumOrderQuantity: number | null;
        orderMultiple: number | null;
        supplierUnitPrice: number | null;
        supplier: { name: string; supplierStatus: string } | null;
      }[]
    ).filter(
      (p) => p.itemId === itemId && p.supplier?.supplierStatus !== "Inactive"
    );
    const pick =
      all.find((p) => p.supplierId === preferred.get(itemId)) ??
      all.find((p) => p.supplierUnitPrice != null) ??
      all[0];
    if (!pick) return null;
    return {
      supplierId: pick.supplierId,
      name: pick.supplier?.name ?? "",
      supplierUnitOfMeasureCode: pick.supplierUnitOfMeasureCode,
      conversionFactor: Number(pick.conversionFactor ?? 1) || 1,
      minimumOrderQuantity:
        pick.minimumOrderQuantity != null
          ? Number(pick.minimumOrderQuantity)
          : null,
      orderMultiple:
        pick.orderMultiple != null ? Number(pick.orderMultiple) : null,
      supplierUnitPrice:
        pick.supplierUnitPrice != null ? Number(pick.supplierUnitPrice) : null
    };
  };

  const lines: FillJobLine[] = rows.map((r) => {
    const base = {
      materialId: r.id,
      jobOperationId: r.jobOperationId,
      itemId: r.itemId,
      readableId: r.item?.readableId ?? "",
      name: r.item?.name ?? r.description ?? "",
      unitOfMeasureCode:
        r.unitOfMeasureCode ?? r.item?.unitOfMeasureCode ?? null,
      needed: Number(r.estimatedQuantity ?? 0),
      posted: Number(r.quantityIssued ?? 0),
      stillNeeded: Number(r.quantityToIssue ?? 0),
      onHand: onHand.get(r.itemId) ?? 0,
      onOrder: orders.get(r.itemId) ?? []
    };
    return {
      ...classifyLine(base),
      hidden: isServiceLine(base),
      storageUnitName: r.storageUnit?.name ?? null,
      vendor: vendorFor(r.itemId),
      unitCost: cost.get(r.itemId) ?? 0
    };
  });
  // Stock is shared by the lines of one job that pull the same part: hand it
  // out in order, so two lines can't both claim the same 10 ft.
  const left = new Map(onHand);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const avail = left.get(l.itemId) ?? 0;
    if (avail !== l.onHand)
      lines[i] = { ...l, ...classifyLine({ ...l, onHand: avail }) };
    left.set(l.itemId, Math.max(0, avail - lines[i].fromStock));
  }
  return { data: { job: { ...job.data, locationId }, lines }, error: null };
}

const selection = z.object({
  jobId: z.string().min(1),
  /** Only these job material lines; all eligible lines when omitted. */
  materialIds: z.array(z.string()).optional()
});

export const fillJobFromStock = defineServiceFn({
  input: selection,
  permission: { update: "inventory" },
  async run(ctx, { jobId, materialIds }) {
    const loaded = await getFillJobLines(ctx.asCaller.supabase, {
      companyId: ctx.company.id,
      locationId: "",
      jobId
    });
    if (!loaded.data)
      return ctx.error("notFound", "Job not found", loaded.error);
    const want = materialIds ? new Set(materialIds) : null;
    const todo = loaded.data.lines.filter(
      (l) =>
        !l.hidden &&
        l.fromStock > 0 &&
        l.jobOperationId &&
        (!want || want.has(l.materialId))
    );
    const filled: { readableId: string; quantity: number }[] = [];
    const failed: { readableId: string; message: string }[] = [];
    for (const l of todo) {
      const res = await invokePosting(
        ctx,
        "issue",
        {
          type: "partToOperation",
          id: l.jobOperationId!,
          itemId: l.itemId,
          materialId: l.materialId,
          quantity: l.fromStock,
          // "Negative Adjmt." = stock goes out to the job (the MES consume path).
          // "Positive Adjmt." is the return-to-stock direction.
          adjustmentType: "Negative Adjmt."
        },
        issueMaterial
      );
      if (res.error)
        failed.push({ readableId: l.readableId, message: res.error.message });
      else filled.push({ readableId: l.readableId, quantity: l.fromStock });
    }
    logger.info("Filled job from stock", {
      jobId,
      filled: filled.length,
      failed: failed.length
    });
    return { filled, failed };
  }
});

export const orderJobShortages = defineServiceFn({
  input: selection,
  permission: { create: "purchasing" },
  async run(ctx, { jobId, materialIds }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const loaded = await getFillJobLines(client, {
      companyId,
      locationId: "",
      jobId
    });
    if (!loaded.data)
      return ctx.error("notFound", "Job not found", loaded.error);
    const { job, lines } = loaded.data;
    const want = materialIds ? new Set(materialIds) : null;
    const todo = lines.filter(
      (l) => !l.hidden && l.toBuy > 0 && (!want || want.has(l.materialId))
    );

    const noVendor = todo.filter((l) => !l.vendor).map((l) => l.readableId);
    const bySupplier = new Map<string, FillJobLine[]>();
    for (const l of todo) {
      if (!l.vendor) continue;
      bySupplier.set(l.vendor.supplierId, [
        ...(bySupplier.get(l.vendor.supplierId) ?? []),
        l
      ]);
    }

    const created: {
      id: string;
      purchaseOrderId: string;
      supplier: string;
      lines: number;
    }[] = [];
    const failed: string[] = [];
    for (const [supplierId, group] of bySupplier) {
      const po = await service.insertPurchaseOrder(client, {
        supplierId,
        purchaseOrderType: "Purchase",
        status: "Draft",
        locationId: job.locationId ?? undefined,
        companyId,
        companyGroupId: ctx.company.groupId,
        createdBy: ctx.auditUserId
      });
      if (po.error || !po.data) {
        failed.push(
          `${group[0].vendor!.name}: ${po.error?.message ?? "PO not created"}`
        );
        continue;
      }
      let n = 0;
      for (const l of group) {
        const v = l.vendor!;
        // Whole units and stick multiples only. The vendor minimum came from
        // JobBOSS's first price-break quantity (7 flanges when the job needs 2),
        // so it isn't applied here; Pam can raise a draft line herself.
        const purchaseQuantity = purchaseQuantityFor(l.toBuy, {
          ...v,
          minimumOrderQuantity: null
        });
        const price =
          v.supplierUnitPrice ??
          Math.round(l.unitCost * v.conversionFactor * 100000) / 100000;
        const line = await service.upsertPurchaseOrderLine(client, {
          purchaseOrderId: po.data.id,
          purchaseOrderLineType: "Part",
          itemId: l.itemId,
          description: l.name,
          purchaseQuantity,
          purchaseUnitOfMeasureCode:
            v.supplierUnitOfMeasureCode ?? l.unitOfMeasureCode ?? "EA",
          inventoryUnitOfMeasureCode: l.unitOfMeasureCode ?? "EA",
          conversionFactor: v.conversionFactor,
          supplierUnitPrice: price,
          supplierShippingCost: 0,
          exchangeRate: po.data.exchangeRate,
          taxPercent: 0,
          jobId: job.id,
          locationId: job.locationId ?? undefined,
          companyId,
          createdBy: ctx.auditUserId
        } as Parameters<typeof service.upsertPurchaseOrderLine>[1]);
        if (line.error) failed.push(`${l.readableId}: ${line.error.message}`);
        else n++;
      }
      created.push({
        id: po.data.id,
        purchaseOrderId: po.data.purchaseOrderId,
        supplier: group[0].vendor!.name,
        lines: n
      });
    }
    if (created.length === 0 && failed.length) {
      return ctx.error(
        "internal",
        `No purchase orders created: ${failed.join("; ")}`,
        new CarbonError("internal", failed.join("; "))
      );
    }
    return { created, noVendor, failed };
  }
});
