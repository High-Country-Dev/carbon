// Fill Jobs (LAND-306): the pure part — which job material lines show, how each
// is colored, what "Fill from stock" posts and what "Order the rest" buys.
// No I/O here, so it is unit-tested (apps/erp/test/fill-jobs-logic.test.ts).
//
// ABS's flow (Pam's purchasing work instruction, 11/6): Engineering releases a
// job → Purchasing fills its requirements from stock → prints the traveler's
// Inventory Copy (Needed / On Hand / Posted / Short) → buys what is short,
// rounding lengths up to whole sticks with the extra going to stock.

export type FillLineInput = {
  materialId: string;
  jobOperationId: string | null;
  itemId: string;
  readableId: string;
  name: string;
  unitOfMeasureCode: string | null;
  needed: number; // jobMaterial.estimatedQuantity
  posted: number; // jobMaterial.quantityIssued
  stillNeeded: number; // jobMaterial.quantityToIssue
  onHand: number; // at the job's location
  onOrder: { purchaseOrderReadableId: string; quantity: number; promisedDate: string | null }[];
};

export type FillLineStatus = "filled" | "inStock" | "partial" | "onOrder" | "short";

export type FillLine = FillLineInput & {
  status: FillLineStatus;
  fromStock: number; // what Fill from stock would post now
  toBuy: number; // stock units still short after stock and open POs
  onOrderTotal: number;
};

// Per diem, labor and other service lines ABS keeps on jobs (N-PER DIEM,
// PM PER DIEM, LABOR ASSEMBLY, N-LABOR-OS) are set up as ordinary parts, so
// they are recognised by unit (days / hours) or name. Pam: "I can't order per
// diem" — they are hidden, behind a "show hidden lines" toggle (LAND-308).
const SERVICE_UNITS = new Set(["DAY", "HR", "HOUR", "HOURS", "DAYS"]);
const SERVICE_WORDS = /\b(per\s*diem|labor|labour|travel|mileage|hotel|meals?)\b/i;

export function isServiceLine(l: Pick<FillLineInput, "unitOfMeasureCode" | "readableId" | "name">): boolean {
  if (l.unitOfMeasureCode && SERVICE_UNITS.has(l.unitOfMeasureCode.toUpperCase())) return true;
  return SERVICE_WORDS.test(l.readableId) || SERVICE_WORDS.test(l.name);
}

const round = (n: number) => Math.round(n * 100000) / 100000;

export function classifyLine(l: FillLineInput): FillLine {
  const stillNeeded = Math.max(0, l.stillNeeded);
  const onHand = Math.max(0, l.onHand);
  const onOrderTotal = l.onOrder.reduce((s, o) => s + Math.max(0, o.quantity), 0);
  const fromStock = round(Math.min(stillNeeded, onHand));
  const afterStock = round(stillNeeded - fromStock);
  const toBuy = round(Math.max(0, afterStock - onOrderTotal));
  let status: FillLineStatus;
  if (stillNeeded <= 0) status = "filled";
  else if (afterStock <= 0) status = "inStock";
  else if (toBuy <= 0) status = "onOrder";
  else if (fromStock > 0) status = "partial";
  else status = "short";
  return { ...l, stillNeeded, onHand, status, fromStock, toBuy, onOrderTotal };
}

/**
 * How much to put on a PO for `stockQty` stock units of a part: in the vendor's
 * buying unit (`conversionFactor` stock units each), at least the vendor's
 * minimum and in whole multiples (a 21' stick: 10 ft needed → 21 ft; 300 in
 * needed → 25 ft → 42 ft). Returns the purchase quantity.
 */
export function purchaseQuantityFor(
  stockQty: number,
  vendor: { conversionFactor?: number | null; minimumOrderQuantity?: number | null; orderMultiple?: number | null }
): number {
  const f = vendor.conversionFactor && vendor.conversionFactor > 0 ? vendor.conversionFactor : 1;
  let q = Math.ceil(round(stockQty / f) * 100000) / 100000;
  const min = vendor.minimumOrderQuantity && vendor.minimumOrderQuantity > 0 ? vendor.minimumOrderQuantity : 0;
  if (q < min) q = min;
  const mult = vendor.orderMultiple && vendor.orderMultiple > 0 ? vendor.orderMultiple : 0;
  if (mult > 0) q = Math.ceil(round(q / mult)) * mult;
  return round(q);
}
