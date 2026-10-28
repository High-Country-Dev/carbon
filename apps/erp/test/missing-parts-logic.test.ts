// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { parseDate } from "@internationalized/date";
import { describe, expect, it } from "vitest";
import {
  buildMissingParts,
  needWeekOf,
  weekIndexOf
} from "../app/modules/production/ui/Jobs/missing-parts-logic";

const today = parseDate("2026-10-28");
// Weeks start on Sunday, as getOrCreatePeriods makes them.
const periods = [0, 1, 2, 3].map((w) => {
  const start = parseDate("2026-10-25").add({ weeks: w });
  return {
    id: `p${w}`,
    startDate: start.toString(),
    endDate: start.add({ days: 6 }).toString()
  };
});

const job = (id: string, status = "Ready", dueDate: string | null = null) => ({
  id,
  jobId: id.toUpperCase(),
  status,
  dueDate,
  customerId: null,
  itemReadableId: null
});
const item = (id: string) => ({
  id,
  readableId: id.toUpperCase(),
  name: id,
  unitOfMeasureCode: "EA"
});
const demand = (
  id: string,
  jobId: string,
  itemId: string,
  quantityToIssue: number,
  dueDate: string | null = null,
  leadTime = 7
) => ({
  id,
  jobId,
  jobReadableId: jobId.toUpperCase(),
  itemId,
  quantityToIssue,
  dueDate,
  leadTime
});
const po = (
  id: string,
  itemId: string,
  quantityToReceive: number,
  promisedDate: string | null,
  status = "To Receive"
) => ({
  id,
  purchaseOrderId: `po-${id}`,
  purchaseOrderReadableId: `PO-${id}`,
  itemId,
  quantityToReceive,
  promisedDate,
  status
});
const empty = {
  salesLines: [],
  productionLines: [],
  draftPurchaseLines: []
};

describe("weekIndexOf", () => {
  it("puts past dates and no date in the first week", () => {
    expect(weekIndexOf("2026-09-01", today, periods)).toBe(0);
    expect(weekIndexOf(null, today, periods)).toBe(0);
  });
  it("finds the week a date falls in, and nothing past the plan", () => {
    expect(weekIndexOf("2026-11-03", today, periods)).toBe(1);
    expect(weekIndexOf("2027-03-01", today, periods)).toBeNull();
  });
});

describe("needWeekOf", () => {
  it("needs the part the job's lead time before its due date", () => {
    // due Nov 17, 7 days lead -> Nov 10, the third week
    expect(
      needWeekOf({ dueDate: "2026-11-17", leadTime: 7 }, today, periods)
    ).toBe(2);
  });
});

describe("buildMissingParts", () => {
  it("flags a line that needs more than is on hand and shows when stock is back", () => {
    const result = buildMissingParts({
      today,
      periods,
      jobs: [job("j1")],
      items: [item("pipe")],
      onHandByItem: { pipe: 3 },
      demandLines: [demand("m1", "j1", "pipe", 10)],
      purchaseLines: [po("1", "pipe", 20, "2026-11-12")],
      ...empty
    });
    expect(result.jobsMissingParts).toBe(1);
    const [line] = result.jobs[0].lines;
    expect(line.status).toBe("missing");
    expect(line.needWeek).toBe(0);
    expect(result.parts.pipe.weeks.map((w) => w.projected)).toEqual([
      -7, -7, 13, 13
    ]);
    expect(line.coveredWeek).toBe(2);
    expect(result.parts.pipe.weeks[2].supply[0]).toMatchObject({
      label: "PO-1",
      quantity: 20
    });
  });

  it("marks a line at risk when on hand covers it but other jobs overdraw the part", () => {
    const result = buildMissingParts({
      today,
      periods,
      jobs: [job("j1"), job("j2", "Planned")],
      items: [item("bolt")],
      onHandByItem: { bolt: 10 },
      demandLines: [
        demand("m1", "j1", "bolt", 6),
        demand("m2", "j2", "bolt", 8)
      ],
      purchaseLines: [],
      ...empty
    });
    // j2 is Planned, not released: it pulls on stock but isn't listed.
    expect(result.jobs.map((j) => j.job.id)).toEqual(["j1"]);
    expect(result.jobs[0].lines[0].status).toBe("at-risk");
    expect(result.jobsMissingParts).toBe(0);
    expect(result.parts.bolt.weeks[0].demand.map((d) => d.label)).toEqual([
      "J1",
      "J2"
    ]);
  });

  it("leaves out lines that stock covers in every week", () => {
    const result = buildMissingParts({
      today,
      periods,
      jobs: [job("j1")],
      items: [item("nut")],
      onHandByItem: { nut: 100 },
      demandLines: [demand("m1", "j1", "nut", 5)],
      purchaseLines: [],
      ...empty
    });
    expect(result.jobs).toEqual([]);
  });

  it("lists draft purchase orders without counting them", () => {
    const result = buildMissingParts({
      today,
      periods,
      jobs: [job("j1")],
      items: [item("valve")],
      onHandByItem: {},
      demandLines: [demand("m1", "j1", "valve", 2)],
      purchaseLines: [],
      salesLines: [],
      productionLines: [],
      draftPurchaseLines: [po("9", "valve", 2, "2026-11-04", "Draft")]
    });
    expect(result.parts.valve.weeks.every((w) => w.projected === -2)).toBe(
      true
    );
    expect(result.parts.valve.draftPurchaseLines).toHaveLength(1);
    expect(result.jobs[0].lines[0].coveredWeek).toBeNull();
  });
});
