import { describe, expect, it } from "vitest";
import {
  classifyLine,
  isServiceLine,
  purchaseQuantityFor,
  type FillLineInput
} from "~/modules/purchasing/fill-jobs-logic";

const line = (over: Partial<FillLineInput>): FillLineInput => ({
  materialId: "m1",
  jobOperationId: "op1",
  itemId: "i1",
  readableId: "PP-0100-CS-SCH40",
  name: "Pipe 1in CS Sch 40",
  unitOfMeasureCode: "INCH",
  needed: 300,
  posted: 0,
  stillNeeded: 300,
  onHand: 0,
  onOrder: [],
  ...over
});

describe("classifyLine", () => {
  it("in stock: fill all of it from stock", () => {
    const l = classifyLine(line({ onHand: 1680, stillNeeded: 1200, needed: 1200 }));
    expect(l.status).toBe("inStock");
    expect(l.fromStock).toBe(1200);
    expect(l.toBuy).toBe(0);
  });
  it("partly in stock: posts what's there, buys the rest", () => {
    const l = classifyLine(line({ onHand: 100 }));
    expect(l.status).toBe("partial");
    expect(l.fromStock).toBe(100);
    expect(l.toBuy).toBe(200);
  });
  it("already on a PO: nothing more to buy", () => {
    const l = classifyLine(
      line({ onOrder: [{ purchaseOrderReadableId: "13311", quantity: 300, promisedDate: "2026-11-20" }] })
    );
    expect(l.status).toBe("onOrder");
    expect(l.toBuy).toBe(0);
  });
  it("short and not on order", () => {
    const l = classifyLine(line({}));
    expect(l.status).toBe("short");
    expect(l.toBuy).toBe(300);
  });
  it("filled when nothing is still needed", () => {
    expect(classifyLine(line({ posted: 300, stillNeeded: 0 })).status).toBe("filled");
  });
});

describe("purchaseQuantityFor", () => {
  const stick = { conversionFactor: 12, minimumOrderQuantity: 21, orderMultiple: 21 };
  it("10 ft needed buys one 21' stick", () => {
    expect(purchaseQuantityFor(120, stick)).toBe(21);
  });
  it("300 in (25 ft) buys two sticks", () => {
    expect(purchaseQuantityFor(300, stick)).toBe(42);
  });
  it("each-items without a vendor setup buy exactly what's short", () => {
    expect(purchaseQuantityFor(3, {})).toBe(3);
  });
  it("a minimum without a multiple is a floor only", () => {
    expect(purchaseQuantityFor(5, { minimumOrderQuantity: 20 })).toBe(20);
    expect(purchaseQuantityFor(25, { minimumOrderQuantity: 20 })).toBe(25);
  });
});

describe("isServiceLine", () => {
  it("hides per diem and labor lines", () => {
    expect(isServiceLine({ unitOfMeasureCode: "DAY", readableId: "N-PER DIEM", name: "" })).toBe(true);
    expect(isServiceLine({ unitOfMeasureCode: "EA", readableId: "PM PER DIEM", name: "" })).toBe(true);
    expect(isServiceLine({ unitOfMeasureCode: "EA", readableId: "LABOR ASSEMBLY", name: "" })).toBe(true);
  });
  it("keeps real parts", () => {
    expect(isServiceLine({ unitOfMeasureCode: "INCH", readableId: "PP-0100-CS-SCH40", name: "Pipe" })).toBe(false);
  });
});
