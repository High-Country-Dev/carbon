import {
  assertEquals,
  assertThrows
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { type BatchMergeParent, buildBatchMergeRecords } from "./batch-merge.ts";

function parent(overrides: Partial<BatchMergeParent> = {}): BatchMergeParent {
  return {
    id: "p1",
    readableId: "LOT-A",
    quantity: 10,
    status: "Available",
    sourceDocument: "Job",
    sourceDocumentId: "item-1",
    sourceDocumentReadableId: "SALAD-01",
    itemId: "item-1",
    expirationDate: null,
    attributes: null,
    bin: { storageUnitId: "bin-1", locationId: "loc-1" },
    ...overrides
  };
}

const base = {
  mergedId: "merged-1",
  mergeActivityId: "act-1",
  readableId: "LOT-M",
  companyId: "co",
  userId: "user",
  postingDate: "2026-09-16"
};

Deno.test("merges two lots into one entity with the summed quantity", () => {
  const records = buildBatchMergeRecords({
    ...base,
    parents: [
      parent({ id: "p1", quantity: 45 }),
      parent({ id: "p2", readableId: "LOT-B", quantity: 44 })
    ]
  });

  assertEquals(records.mergedEntityInsert.quantity, 89);
  assertEquals(records.mergedEntityInsert.status, "Available");
  assertEquals(records.mergedEntityInsert.readableId, "LOT-M");
  assertEquals(records.mergedEntityInsert.attributes["Merged From Entity IDs"], [
    "p1",
    "p2"
  ]);
  assertEquals(records.parentUpdates, [
    { id: "p1", status: "Consumed" },
    { id: "p2", status: "Consumed" }
  ]);
  assertEquals(records.activityInsert.type, "Merge");
  assertEquals(records.activityInputInserts.length, 2);
  assertEquals(records.activityInputInserts[0].quantity, 45);
  assertEquals(records.activityInputInserts[1].quantity, 44);
  assertEquals(records.activityOutputInsert.trackedEntityId, "merged-1");
  assertEquals(records.activityOutputInsert.quantity, 89);
});

Deno.test("ledger rows are net-zero: −q per parent, +Σq for the merged lot", () => {
  const records = buildBatchMergeRecords({
    ...base,
    parents: [
      parent({ id: "p1", quantity: 45, bin: { storageUnitId: "bin-1", locationId: "loc-1" } }),
      parent({ id: "p2", quantity: 44, bin: { storageUnitId: "bin-2", locationId: "loc-1" } })
    ]
  });

  assertEquals(records.ledgerInserts.length, 3);
  const net = records.ledgerInserts.reduce((sum, l) => sum + l.quantity, 0);
  assertEquals(net, 0);
  // Each parent's negative row books at ITS bin; the merged row at the first's.
  assertEquals(records.ledgerInserts[0].storageUnitId, "bin-1");
  assertEquals(records.ledgerInserts[1].storageUnitId, "bin-2");
  assertEquals(records.ledgerInserts[2].storageUnitId, "bin-1");
  assertEquals(records.ledgerInserts[2].quantity, 89);
  for (const l of records.ledgerInserts) {
    assertEquals(l.documentType, "Batch Merge");
  }
});

Deno.test("earliest parent expiry wins", () => {
  const records = buildBatchMergeRecords({
    ...base,
    parents: [
      parent({ id: "p1", expirationDate: "2026-10-01" }),
      parent({ id: "p2", expirationDate: "2026-09-20" }),
      parent({ id: "p3", expirationDate: null })
    ]
  });
  assertEquals(records.mergedEntityInsert.expirationDate, "2026-09-20");
});

Deno.test("attributes kept only where every parent agrees; pointer keys dropped", () => {
  const records = buildBatchMergeRecords({
    ...base,
    parents: [
      parent({
        id: "p1",
        attributes: {
          Supplier: "Acme",
          "Grow Room": "R1",
          "Split From Entity ID": "old"
        }
      }),
      parent({
        id: "p2",
        attributes: { Supplier: "Acme", "Grow Room": "R2" }
      })
    ]
  });
  assertEquals(records.mergedEntityInsert.attributes["Supplier"], "Acme");
  assertEquals(records.mergedEntityInsert.attributes["Grow Room"], undefined);
  assertEquals(
    records.mergedEntityInsert.attributes["Split From Entity ID"],
    undefined
  );
});

Deno.test("rejects mixed items", () => {
  assertThrows(
    () =>
      buildBatchMergeRecords({
        ...base,
        parents: [
          parent({ id: "p1" }),
          parent({ id: "p2", itemId: "item-2", sourceDocumentId: "item-2" })
        ]
      }),
    Error,
    "same item"
  );
});

Deno.test("rejects fewer than two lots", () => {
  assertThrows(
    () => buildBatchMergeRecords({ ...base, parents: [parent()] }),
    Error,
    "At least two"
  );
});

Deno.test("rejects unavailable or empty parents", () => {
  assertThrows(
    () =>
      buildBatchMergeRecords({
        ...base,
        parents: [parent(), parent({ id: "p2", status: "Consumed" })]
      }),
    Error,
    "not available"
  );
  assertThrows(
    () =>
      buildBatchMergeRecords({
        ...base,
        parents: [parent(), parent({ id: "p2", quantity: 0 })]
      }),
    Error,
    "no quantity"
  );
});
