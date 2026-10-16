// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Blind receiving against the live database: with
// `companySettings.receiptQuantitiesStartAtZero` on, a purchase-order receipt's
// lines start at 0, and posting it books only the lines that were received.

import { expect } from "vitest";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER,
  unwrap
} from "./always-post-test-fixture";
import create from "./create";
import { databaseTest } from "./local-database-test-fixture";
import postReceipt from "./post-receipt";

/** A purchase order with two lines of 10 of the fixture's part. */
async function purchaseOrderWithTwoLines(f: Fixture): Promise<string> {
  const purchaseOrderId = `${f.prefix}-po-blind`;
  await seed(f, async (trx) => {
    const interaction = await trx
      .insertInto("supplierInteraction")
      .values({ supplierId: f.supplierId, companyId: f.companyId })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("purchaseOrder")
      .values({
        id: purchaseOrderId,
        purchaseOrderId: "PO-BLIND",
        supplierId: f.supplierId,
        supplierInteractionId: interaction.id,
        currencyCode: "USD",
        exchangeRate: 1,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("purchaseOrderDelivery")
      .values({
        id: purchaseOrderId,
        locationId: f.locationId,
        companyId: f.companyId
      })
      .execute();
    await trx
      .insertInto("purchaseOrderLine")
      .values(
        ["line-1", "line-2"].map((key) => ({
          id: `${f.prefix}-pol-${key}`,
          purchaseOrderId,
          purchaseOrderLineType: "Part" as const,
          itemId: f.partId,
          purchaseQuantity: 10,
          supplierUnitPrice: 10,
          exchangeRate: 1,
          conversionFactor: 1,
          inventoryUnitOfMeasureCode: "EA",
          locationId: f.locationId,
          companyId: f.companyId,
          createdBy: USER
        }))
      )
      .execute();
  });
  return purchaseOrderId;
}

async function setStartAtZero(f: Fixture, value: boolean) {
  await f.db
    .updateTable("companySettings")
    .set({ receiptQuantitiesStartAtZero: value })
    .where("id", "=", f.companyId)
    .execute();
}

async function receiptLines(f: Fixture, receiptId: string) {
  return f.db
    .selectFrom("receiptLine")
    .select(["id", "lineId", "receivedQuantity", "outstandingQuantity"])
    .where("receiptId", "=", receiptId)
    .where("companyId", "=", f.companyId)
    .orderBy("lineId")
    .execute();
}

databaseTest(
  "a receipt starts each line at the quantity to receive when the setting is off",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const purchaseOrderId = await purchaseOrderWithTwoLines(f);
      const receipt = unwrap(
        await create(f.ctx, {
          type: "receiptFromPurchaseOrder",
          purchaseOrderId,
          locationId: f.locationId
        })
      );

      const lines = await receiptLines(f, receipt.id);
      expect(lines.map((l) => Number(l.receivedQuantity))).toEqual([10, 10]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "with the setting on, a receipt starts at 0 and posts only the lines that were received",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await setStartAtZero(f, true);
      const purchaseOrderId = await purchaseOrderWithTwoLines(f);
      const receipt = unwrap(
        await create(f.ctx, {
          type: "receiptFromPurchaseOrder",
          purchaseOrderId,
          locationId: f.locationId
        })
      );

      const lines = await receiptLines(f, receipt.id);
      expect(
        lines.map((l) => [
          Number(l.receivedQuantity),
          Number(l.outstandingQuantity)
        ])
      ).toEqual([
        [0, 10],
        [0, 10]
      ]);

      // The receiver counts 4 on the first line; nothing arrived for the second.
      await f.db
        .updateTable("receiptLine")
        .set({ receivedQuantity: 4 })
        .where("id", "=", lines[0]!.id)
        .where("companyId", "=", f.companyId)
        .execute();

      unwrap(await postReceipt(f.ctx, { type: "post", receiptId: receipt.id }));

      const ledger = await f.db
        .selectFrom("itemLedger")
        .select("quantity")
        .where("documentId", "=", receipt.id)
        .where("companyId", "=", f.companyId)
        .execute();
      expect(ledger.map((row) => Number(row.quantity))).toEqual([4]);

      const purchaseOrderLines = await f.db
        .selectFrom("purchaseOrderLine")
        .select(["id", "quantityReceived", "receivedComplete"])
        .where("purchaseOrderId", "=", purchaseOrderId)
        .where("companyId", "=", f.companyId)
        .orderBy("id")
        .execute();
      expect(
        purchaseOrderLines.map((l) => [
          Number(l.quantityReceived),
          l.receivedComplete
        ])
      ).toEqual([
        [4, false],
        [0, false]
      ]);
    } finally {
      await f.cleanup();
    }
  }
);
