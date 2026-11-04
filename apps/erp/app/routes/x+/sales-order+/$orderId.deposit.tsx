// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
// LAND-299 (ABS office: "Bill a deposit or milestone"): a Draft sales invoice for part of an order — a percent
// of the order total or a fixed amount — as one Service line ("Deposit / progress billing"). The invoice shares
// the order's opportunity, so it shows under the order's Invoices. The office checks and posts it as usual.
// When the order ships, the final invoice is made from the shipment; take the deposits off it with a negative
// line on the same service (the modal shows what's already been billed).
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  insertSalesInvoice,
  upsertSalesInvoiceLine
} from "~/modules/invoicing/invoicing.service";
import { upsertService } from "~/modules/items/items.service";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

const DEPOSIT_SERVICE = "Deposit / progress billing";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {
      create: "invoicing",
      bypassRls: true
    });
  const { orderId } = params;
  if (!orderId) throw new Error("orderId not found");
  const form = await request.formData();
  const percent = Number(form.get("percent") || 0);
  const amountIn = Number(form.get("amount") || 0);
  const label = String(form.get("description") || "").trim();

  const order = await client
    .from("salesOrders")
    .select(
      "id, salesOrderId, customerId, opportunityId, customerReference, currencyCode, locationId, orderTotal, companyId"
    )
    .eq("id", orderId)
    .eq("companyId", companyId)
    .single();
  if (order.error || !order.data) {
    throw redirect(
      path.to.salesOrder(orderId),
      await flash(request, error(order.error, "Order not found"))
    );
  }
  const total = Number(order.data.orderTotal ?? 0);
  const amount = amountIn > 0 ? amountIn : Math.round(total * percent) / 100;
  if (!(amount > 0))
    return data({ error: "Enter a percent or an amount" }, { status: 400 });

  let service = await client
    .from("item")
    .select("id")
    .eq("companyId", companyId)
    .eq("type", "Service")
    .eq("readableId", DEPOSIT_SERVICE)
    .maybeSingle();
  if (!service.data) {
    const created = await upsertService(client, getDatabaseClient(), {
      name: DEPOSIT_SERVICE,
      description: "Deposits and milestone bills on a sales order (LAND-299)",
      replenishmentSystem: "Buy",
      defaultMethodType: "Pull from Inventory",
      itemTrackingType: "Non-Inventory",
      unitOfMeasureCode: "EA",
      unitCost: 0,
      active: true,
      companyId,
      createdBy: userId
    } as any);
    if (created.error) {
      throw redirect(
        path.to.salesOrder(orderId),
        await flash(
          request,
          error(created.error, "Could not make the deposit service")
        )
      );
    }
    service = await client
      .from("item")
      .select("id")
      .eq("companyId", companyId)
      .eq("type", "Service")
      .eq("readableId", DEPOSIT_SERVICE)
      .maybeSingle();
  }

  const invoice = await insertSalesInvoice(client, {
    customerId: order.data.customerId!,
    companyId,
    companyGroupId,
    createdBy: userId,
    customerReference: order.data.customerReference ?? undefined,
    currencyCode: order.data.currencyCode ?? undefined,
    locationId: order.data.locationId ?? undefined
  });
  if (invoice.error || !invoice.data) {
    throw redirect(
      path.to.salesOrder(orderId),
      await flash(request, error(invoice.error, "Could not make the invoice"))
    );
  }
  // Share the order's opportunity so the invoice is listed under the order.
  if (order.data.opportunityId) {
    await client
      .from("salesInvoice")
      .update({ opportunityId: order.data.opportunityId })
      .eq("id", invoice.data.id);
  }
  const description =
    label ||
    (amountIn > 0
      ? `Progress billing on ${order.data.salesOrderId}`
      : `Deposit ${percent}% of ${order.data.salesOrderId}`);
  const line = await upsertSalesInvoiceLine(client, {
    invoiceId: invoice.data.id,
    invoiceLineType: "Service",
    methodType: "Pull from Inventory",
    itemId: service.data?.id ?? undefined,
    description,
    quantity: 1,
    unitPrice: amount,
    unitOfMeasureCode: "EA",
    addOnCost: 0,
    nonTaxableAddOnCost: 0,
    shippingCost: 0,
    taxPercent: 0,
    locationId: order.data.locationId ?? undefined,
    companyId,
    createdBy: userId
  } as any);
  if (line.error) {
    throw redirect(
      path.to.salesInvoice(invoice.data.id),
      await flash(
        request,
        error(line.error, "Invoice made, but the line failed")
      )
    );
  }
  await client
    .from("salesInvoiceLine")
    .update({ salesOrderId: order.data.id })
    .eq("invoiceId", invoice.data.id);
  throw redirect(path.to.salesInvoice(invoice.data.id));
}
