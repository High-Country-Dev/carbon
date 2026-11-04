// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// LAND-299 (ABS: "Job cost: estimate against actual"): one job-cost summary per job, in dollars, across every
// make method of the job (the Estimates vs Actuals card only reads the root method).
//
//   material  estimated = Σ estimatedQuantity × jobMaterial.unitCost (the cost when the job was made)
//             actual    = the cost ledger's Job Consumption cost for the job (what was issued, at its FIFO cost);
//                         jobs with no ledger rows fall back to Σ quantityIssued × the item's current unit cost
//             (Make to Order lines are left out: their cost is the sub-method's own steps and materials)
//   labor     setup + labor hours × the step's laborRate
//   machine   machine hours × machineRate
//   overhead  setup + labor + machine hours × overheadRate
//   outside   estimated = max(operationUnitCost × quantity, operationMinimumCost);
//             actual    = Σ PO lines on the step (purchaseQuantity × unitPrice)
//   revenue   the job's sales order line: unitPrice × job quantity (none for stock / sub-jobs)
//
// Estimated hours come from makeDurations (the same unit rules as the job page); actual hours from the step's
// production events (an open timer counts up to now).

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { makeDurations } from "~/utils/duration";

export type CostLine = { estimated: number; actual: number };
export type JobCost = {
  jobId: string;
  material: CostLine;
  labor: CostLine;
  machine: CostLine;
  overhead: CostLine;
  outside: CostLine;
  total: CostLine;
  hours: CostLine;
  revenue: number | null;
  margin: CostLine | null; // revenue − cost
};

const HOUR = 3600000;
// Small id batches keep the PostgREST URL short (Kong rejects very long query strings), and each batch pages
// past PostgREST's 1,000-row cap (every read has an ORDER BY, or the pages repeat and skip rows). Batches run a few at a time: a report over ~1,000 jobs is ~20 batches per
// table, and one at a time that was ~370 round trips (Sales by Customer took most of a minute).
const CHUNK = 50;
const PAGE = 1000;
const PARALLEL = 6;

export async function inChunks<T = any>(
  ids: string[],
  make: (chunk: string[]) => any
): Promise<T[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK)
    chunks.push(ids.slice(i, i + CHUNK));
  const results: T[][] = new Array(chunks.length);
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const n = next++;
      const rows: T[] = [];
      for (let from = 0; ; from += PAGE) {
        const r = await make(chunks[n]).range(from, from + PAGE - 1);
        if (r.error)
          throw new Error(
            `job cost query failed: ${r.error.message ?? r.error}`
          );
        const page = (r.data ?? []) as T[];
        rows.push(...page);
        if (page.length < PAGE) break;
      }
      results[n] = rows;
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(PARALLEL, chunks.length) }, worker)
  );
  return results.flat();
}

const line = (): CostLine => ({ estimated: 0, actual: 0 });

export async function getJobCosts(
  client: SupabaseClient<Database>,
  companyId: string,
  jobIds: string[]
): Promise<Map<string, JobCost>> {
  const result = new Map<string, JobCost>();
  if (jobIds.length === 0) return result;

  // Everything keyed by job runs together; then what needs the materials (item costs) and the order lines.
  // Clocked time and outside-processing POs are fetched by job too (through the step), not by step id:
  // ~5x fewer batches.
  const [jobs, operations, materials, events, outsidePo, consumed] =
    await Promise.all([
      inChunks(jobIds, (c) =>
        client
          .from("job")
          .select("id, quantity, productionQuantity, salesOrderLineId")
          .eq("companyId", companyId)
          .in("id", c)
          .order("id")
      ),
      inChunks(jobIds, (c) =>
        client
          .from("jobOperation")
          .select(
            "id, jobId, operationType, operationQuantity, setupTime, setupUnit, laborTime, laborUnit, machineTime, machineUnit, laborRate, overheadRate, machineRate, operationUnitCost, operationMinimumCost"
          )
          .eq("companyId", companyId)
          .in("jobId", c)
          .order("id")
      ),
      inChunks(jobIds, (c) =>
        client
          .from("jobMaterial")
          .select(
            "jobId, itemId, methodType, estimatedQuantity, quantityIssued, unitCost"
          )
          .eq("companyId", companyId)
          .in("jobId", c)
          .order("id")
      ),
      inChunks(jobIds, (c) =>
        client
          .from("productionEvent")
          .select(
            "jobOperationId, type, duration, startTime, endTime, jobOperation!inner(jobId)"
          )
          .eq("companyId", companyId)
          .in("jobOperation.jobId", c)
          .order("id")
      ),
      inChunks(jobIds, (c) =>
        client
          .from("purchaseOrderLine")
          .select(
            "jobOperationId, purchaseQuantity, unitPrice, jobOperation!inner(jobId)"
          )
          .eq("companyId", companyId)
          .in("jobOperation.jobId", c)
          .order("id")
      ),
      // Actual material: the cost ledger's consumption cost (negative = issued to the job).
      inChunks(jobIds, (c) =>
        client
          .from("costLedger")
          .select("documentId, cost")
          .eq("companyId", companyId)
          .eq("itemLedgerType", "Consumption")
          .in("documentId", c)
          .order("id")
      )
    ]);
  const consumedCost = new Map<string, number>();
  for (const r of consumed) {
    if (!r.documentId) continue;
    consumedCost.set(
      r.documentId,
      (consumedCost.get(r.documentId) ?? 0) - Number(r.cost ?? 0)
    );
  }
  const itemIds = [
    ...new Set(materials.map((m) => m.itemId).filter(Boolean))
  ] as string[];
  const soLineIds = [
    ...new Set(jobs.map((j) => j.salesOrderLineId).filter(Boolean))
  ] as string[];
  const [itemCosts, soLines] = await Promise.all([
    inChunks(itemIds, (c) =>
      client
        .from("itemCost")
        .select("itemId, unitCost")
        .eq("companyId", companyId)
        .in("itemId", c)
        .order("itemId")
    ),
    inChunks(soLineIds, (c) =>
      client
        .from("salesOrderLine")
        .select("id, unitPrice")
        .in("id", c)
        .order("id")
    )
  ]);

  const currentCost = new Map(
    itemCosts.map((c) => [c.itemId, Number(c.unitCost ?? 0)])
  );
  const soPrice = new Map(soLines.map((l) => [l.id, Number(l.unitPrice ?? 0)]));
  const now = Date.now();
  const actualMs = new Map<
    string,
    { setup: number; labor: number; machine: number }
  >();
  for (const e of events) {
    if (!e.jobOperationId || !e.type) continue;
    const a = actualMs.get(e.jobOperationId) ?? {
      setup: 0,
      labor: 0,
      machine: 0
    };
    const ms = e.endTime
      ? Number(e.duration ?? 0) * 1000
      : e.startTime
        ? Math.max(0, now - new Date(e.startTime).getTime())
        : 0;
    const k = e.type.toLowerCase() as "setup" | "labor" | "machine";
    if (k in a) a[k] += ms;
    actualMs.set(e.jobOperationId, a);
  }
  const poByOp = new Map<string, number>();
  for (const p of outsidePo) {
    if (!p.jobOperationId) continue;
    poByOp.set(
      p.jobOperationId,
      (poByOp.get(p.jobOperationId) ?? 0) +
        Number(p.purchaseQuantity ?? 0) * Number(p.unitPrice ?? 0)
    );
  }

  for (const j of jobs) {
    result.set(j.id, {
      jobId: j.id,
      material: line(),
      labor: line(),
      machine: line(),
      overhead: line(),
      outside: line(),
      total: line(),
      hours: line(),
      revenue:
        j.salesOrderLineId && soPrice.has(j.salesOrderLineId)
          ? soPrice.get(j.salesOrderLineId)! *
            Number(j.productionQuantity ?? j.quantity ?? 0)
          : null,
      margin: null
    });
  }

  for (const o of operations) {
    const jc = result.get(o.jobId);
    if (!jc) continue;
    if (o.operationType === "Outside Processing") {
      const qty = Number(o.operationQuantity ?? 0);
      jc.outside.estimated += Math.max(
        Number(o.operationUnitCost ?? 0) * qty,
        Number(o.operationMinimumCost ?? 0)
      );
      jc.outside.actual += poByOp.get(o.id) ?? 0;
      continue;
    }
    const est = makeDurations({
      setupTime: Number(o.setupTime ?? 0),
      setupUnit: o.setupUnit ?? undefined,
      laborTime: Number(o.laborTime ?? 0),
      laborUnit: o.laborUnit ?? undefined,
      machineTime: Number(o.machineTime ?? 0),
      machineUnit: o.machineUnit ?? undefined,
      operationQuantity: Number(o.operationQuantity ?? 0)
    });
    const act = actualMs.get(o.id) ?? { setup: 0, labor: 0, machine: 0 };
    const lr = Number(o.laborRate ?? 0),
      mr = Number(o.machineRate ?? 0),
      or = Number(o.overheadRate ?? 0);
    const estPeople = (est.setupDuration + est.laborDuration) / HOUR;
    const estMachine = est.machineDuration / HOUR;
    const actPeople = (act.setup + act.labor) / HOUR;
    const actMachine = act.machine / HOUR;
    jc.labor.estimated += estPeople * lr;
    jc.labor.actual += actPeople * lr;
    jc.machine.estimated += estMachine * mr;
    jc.machine.actual += actMachine * mr;
    jc.overhead.estimated += (estPeople + estMachine) * or;
    jc.overhead.actual += (actPeople + actMachine) * or;
    jc.hours.estimated += estPeople + estMachine;
    jc.hours.actual += actPeople + actMachine;
  }

  for (const m of materials) {
    const jc = result.get(m.jobId);
    if (!jc || m.methodType === "Make to Order") continue;
    jc.material.estimated +=
      Number(m.estimatedQuantity ?? 0) * Number(m.unitCost ?? 0);
    if (!consumedCost.has(m.jobId)) {
      jc.material.actual +=
        Number(m.quantityIssued ?? 0) *
        (currentCost.get(m.itemId) ?? Number(m.unitCost ?? 0));
    }
  }
  for (const [jobId, cost] of consumedCost) {
    const jc = result.get(jobId);
    if (jc) jc.material.actual += cost;
  }

  for (const jc of result.values()) {
    for (const k of ["estimated", "actual"] as const) {
      jc.total[k] =
        jc.material[k] +
        jc.labor[k] +
        jc.machine[k] +
        jc.overhead[k] +
        jc.outside[k];
    }
    if (jc.revenue !== null) {
      jc.margin = {
        estimated: jc.revenue - jc.total.estimated,
        actual: jc.revenue - jc.total.actual
      };
    }
  }
  return result;
}
