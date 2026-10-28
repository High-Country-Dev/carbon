// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Jobs missing parts: which released jobs can't be filled from stock, and how
// the stock of each short part moves week by week. Pure — the route reads the
// open orders and this lays them out, so the logic is unit-tested
// (apps/erp/test/missing-parts-logic.test.ts).
//
// Totals only: a purchase order is never assigned to a job. Carbon buys to
// stock and jobs pull from stock, so a part's weeks show every job pulling it
// and every order arriving, and its projected stock is what's left after both.
//
// Weeks follow MRP (packages/planning/src/mrp/mrp.ts): a job material is needed
// its job's lead time before the job's due date, a purchase order line arrives
// on its promised date, and anything dated before today lands in the first week.

import { type CalendarDate, parseDate } from "@internationalized/date";

export type MissingPartsPeriod = {
  id: string;
  startDate: string;
  endDate: string;
};

/** Weeks shown: about a quarter, enough to see a part come back. */
export const MISSING_PARTS_WEEKS = 16;

/** The job statuses that count as released to the floor (the dashboard's
 *  Active Jobs: `activeJobStatuses` in @carbon/database). */
export const RELEASED_JOB_STATUSES: readonly string[] = [
  "Ready",
  "In Progress",
  "Paused"
];

export type MissingPartsJob = {
  id: string;
  jobId: string;
  status: string;
  dueDate: string | null;
  customerId: string | null;
  itemReadableId: string | null;
};

/** An open job material line (the `openJobMaterialLines` view): demand. */
export type MissingPartsDemandLine = {
  id: string;
  jobId: string;
  jobReadableId: string;
  itemId: string;
  quantityToIssue: number;
  dueDate: string | null;
  leadTime: number | null;
};

/** An open sales order line (`openSalesOrderLines`): demand on stock too. */
export type MissingPartsSalesLine = {
  id: string;
  salesOrderId: string;
  salesOrderReadableId: string | null;
  itemId: string;
  quantityToSend: number;
  promisedDate: string | null;
};

/** An open purchase order line (`openPurchaseOrderLines`): supply. */
export type MissingPartsPurchaseLine = {
  id: string;
  purchaseOrderId: string;
  purchaseOrderReadableId: string;
  itemId: string;
  quantityToReceive: number;
  promisedDate: string | null;
  status: string;
};

/** A job making the part (`openProductionOrders`): supply. */
export type MissingPartsProductionLine = {
  id: string;
  jobId: string;
  jobReadableId: string | null;
  itemId: string;
  quantityToReceive: number;
  dueDate: string | null;
};

export type MissingPartsItem = {
  id: string;
  readableId: string;
  name: string;
  unitOfMeasureCode: string | null;
};

export type WeekDemand =
  | { kind: "job"; id: string; label: string; quantity: number }
  | { kind: "sales"; id: string; label: string; quantity: number };

export type WeekSupply =
  | {
      kind: "purchase";
      id: string;
      label: string;
      quantity: number;
      date: string | null;
    }
  | {
      kind: "production";
      id: string;
      label: string;
      quantity: number;
      date: string | null;
    };

export type PartWeek = {
  demand: WeekDemand[];
  supply: WeekSupply[];
  /** Projected stock at the end of the week. */
  projected: number;
};

export type PartProjection = {
  item: MissingPartsItem;
  onHand: number;
  weeks: PartWeek[];
  /** Draft purchase orders: not counted until they're finalized. */
  draftPurchaseLines: MissingPartsPurchaseLine[];
};

/**
 * - `missing`: this line needs more than is on hand right now.
 * - `at-risk`: on hand covers this line, but stock goes below zero in some
 *   week (all the jobs and orders pulling on the part need more than is on
 *   hand and on order).
 */
export type MissingPartStatus = "missing" | "at-risk";

export type MissingPartLine = {
  materialId: string;
  itemId: string;
  quantityToIssue: number;
  onHand: number;
  status: MissingPartStatus;
  /** Index of the week the job needs the part. */
  needWeek: number;
  /** First week from the need week on where projected stock is back to zero
   *  or more; null when it never is within the planning weeks. */
  coveredWeek: number | null;
};

export type JobMissingParts = {
  job: MissingPartsJob;
  lines: MissingPartLine[];
  missingCount: number;
};

export type MissingPartsResult = {
  jobs: JobMissingParts[];
  parts: Record<string, PartProjection>;
  /** Released jobs with at least one line that is short right now. */
  jobsMissingParts: number;
};

/** The week a date falls in; dates before today land in the first week, past
 *  the last week nothing (outside the plan). */
export function weekIndexOf(
  date: string | null,
  today: CalendarDate,
  periods: MissingPartsPeriod[]
): number | null {
  if (periods.length === 0) return null;
  const day = date ? parseDate(date.slice(0, 10)) : today;
  if (day.compare(today) < 0) return 0;
  const index = periods.findIndex(
    (p) =>
      parseDate(p.startDate).compare(day) <= 0 &&
      parseDate(p.endDate).compare(day) >= 0
  );
  if (index >= 0) return index;
  return day.compare(parseDate(periods[0].startDate)) < 0 ? 0 : null;
}

/** The week a job needs a material: its lead time before the job's due date. */
export function needWeekOf(
  line: Pick<MissingPartsDemandLine, "dueDate" | "leadTime">,
  today: CalendarDate,
  periods: MissingPartsPeriod[]
): number | null {
  const due = line.dueDate ? parseDate(line.dueDate.slice(0, 10)) : today;
  const needed = due.add({ days: -(line.leadTime ?? 7) });
  return weekIndexOf(needed.toString(), today, periods);
}

export function buildMissingParts(input: {
  today: CalendarDate;
  periods: MissingPartsPeriod[];
  jobs: MissingPartsJob[];
  items: MissingPartsItem[];
  onHandByItem: Record<string, number>;
  demandLines: MissingPartsDemandLine[];
  salesLines: MissingPartsSalesLine[];
  purchaseLines: MissingPartsPurchaseLine[];
  productionLines: MissingPartsProductionLine[];
  draftPurchaseLines: MissingPartsPurchaseLine[];
}): MissingPartsResult {
  const { today, periods } = input;
  const released = new Map(
    input.jobs
      .filter((j) => RELEASED_JOB_STATUSES.includes(j.status))
      .map((j) => [j.id, j] as const)
  );
  const itemById = new Map(input.items.map((i) => [i.id, i] as const));

  // The parts of interest: anything a released job still has to issue.
  const partIds = new Set(
    input.demandLines
      .filter((l) => released.has(l.jobId) && l.quantityToIssue > 0)
      .map((l) => l.itemId)
  );

  const parts: Record<string, PartProjection> = {};
  for (const itemId of partIds) {
    const item = itemById.get(itemId);
    if (!item) continue;
    parts[itemId] = {
      item,
      onHand: input.onHandByItem[itemId] ?? 0,
      weeks: periods.map(() => ({ demand: [], supply: [], projected: 0 })),
      draftPurchaseLines: []
    };
  }

  for (const line of input.demandLines) {
    const part = parts[line.itemId];
    if (!part || line.quantityToIssue <= 0) continue;
    const week = needWeekOf(line, today, periods);
    if (week === null) continue;
    part.weeks[week].demand.push({
      kind: "job",
      id: line.jobId,
      label: line.jobReadableId,
      quantity: line.quantityToIssue
    });
  }
  for (const line of input.salesLines) {
    const part = parts[line.itemId];
    if (!part || line.quantityToSend <= 0) continue;
    const week = weekIndexOf(line.promisedDate, today, periods);
    if (week === null) continue;
    part.weeks[week].demand.push({
      kind: "sales",
      id: line.salesOrderId,
      label: line.salesOrderReadableId ?? line.salesOrderId,
      quantity: line.quantityToSend
    });
  }
  for (const line of input.purchaseLines) {
    const part = parts[line.itemId];
    if (!part || line.quantityToReceive <= 0) continue;
    const week = weekIndexOf(line.promisedDate, today, periods);
    if (week === null) continue;
    part.weeks[week].supply.push({
      kind: "purchase",
      id: line.purchaseOrderId,
      label: line.purchaseOrderReadableId,
      quantity: line.quantityToReceive,
      date: line.promisedDate
    });
  }
  for (const line of input.productionLines) {
    const part = parts[line.itemId];
    if (!part || line.quantityToReceive <= 0) continue;
    const week = weekIndexOf(line.dueDate, today, periods);
    if (week === null) continue;
    part.weeks[week].supply.push({
      kind: "production",
      id: line.jobId,
      label: line.jobReadableId ?? line.jobId,
      quantity: line.quantityToReceive,
      date: line.dueDate
    });
  }
  for (const line of input.draftPurchaseLines) {
    const part = parts[line.itemId];
    if (part && line.quantityToReceive > 0) part.draftPurchaseLines.push(line);
  }

  for (const part of Object.values(parts)) {
    let running = part.onHand;
    for (const week of part.weeks) {
      for (const s of week.supply) running += s.quantity;
      for (const d of week.demand) running -= d.quantity;
      week.projected = running;
    }
  }

  const linesByJob = new Map<string, MissingPartLine[]>();
  for (const line of input.demandLines) {
    if (!released.has(line.jobId) || line.quantityToIssue <= 0) continue;
    const part = parts[line.itemId];
    if (!part) continue;
    const needWeek = needWeekOf(line, today, periods) ?? 0;
    const goesShort = part.weeks.some((w) => w.projected < 0);
    const status: MissingPartStatus | null =
      line.quantityToIssue > part.onHand
        ? "missing"
        : goesShort
          ? "at-risk"
          : null;
    if (!status) continue;
    let coveredWeek: number | null = null;
    for (let w = needWeek; w < part.weeks.length; w++) {
      if (part.weeks[w].projected >= 0) {
        coveredWeek = w;
        break;
      }
    }
    const list = linesByJob.get(line.jobId) ?? [];
    list.push({
      materialId: line.id,
      itemId: line.itemId,
      quantityToIssue: line.quantityToIssue,
      onHand: part.onHand,
      status,
      needWeek,
      coveredWeek
    });
    linesByJob.set(line.jobId, list);
  }

  const jobs: JobMissingParts[] = [];
  for (const [jobId, lines] of linesByJob) {
    const job = released.get(jobId);
    if (!job) continue;
    lines.sort(
      (a, b) =>
        (a.status === "missing" ? 0 : 1) - (b.status === "missing" ? 0 : 1) ||
        (itemById.get(a.itemId)?.readableId ?? "").localeCompare(
          itemById.get(b.itemId)?.readableId ?? ""
        )
    );
    jobs.push({
      job,
      lines,
      missingCount: lines.filter((l) => l.status === "missing").length
    });
  }
  // Jobs short right now first, then by due date, then number.
  jobs.sort(
    (a, b) =>
      (a.missingCount > 0 ? 0 : 1) - (b.missingCount > 0 ? 0 : 1) ||
      (a.job.dueDate ?? "9999").localeCompare(b.job.dueDate ?? "9999") ||
      a.job.jobId.localeCompare(b.job.jobId)
  );

  return {
    jobs,
    parts,
    jobsMissingParts: jobs.filter((j) => j.missingCount > 0).length
  };
}
