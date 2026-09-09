import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { VStack } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import {
  getSupplierBankAccounts,
  getSupplierPayment,
  supplierPaymentValidator,
  updateSupplierPayment
} from "~/modules/purchasing";
import SupplierBankAccounts from "~/modules/purchasing/ui/Supplier/SupplierBankAccounts";
import SupplierPaymentForm from "~/modules/purchasing/ui/Supplier/SupplierPaymentForm";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "purchasing"
  });

  const { supplierId } = params;
  if (!supplierId) throw new Error("Could not find supplierId");

  const [supplierPayment, bankAccounts] = await Promise.all([
    getSupplierPayment(client, supplierId),
    getSupplierBankAccounts(client, supplierId, companyId)
  ]);

  if (supplierPayment.error || !supplierPayment.data) {
    throw redirect(
      path.to.supplier(supplierId),
      await flash(
        request,
        error(supplierPayment.error, "Failed to load supplier payment terms")
      )
    );
  }

  return {
    supplierPayment: supplierPayment.data,
    bankAccounts: bankAccounts.data ?? []
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "purchasing"
  });

  const { supplierId } = params;
  if (!supplierId) throw new Error("Could not find supplierId");

  const formData = await request.formData();
  const validation = await validator(supplierPaymentValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const update = await updateSupplierPayment(client, {
    ...validation.data,
    supplierId,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });
  if (update.error) {
    throw redirect(
      path.to.supplier(supplierId),
      await flash(
        request,
        error(update.error, "Failed to update supplier payment terms")
      )
    );
  }

  throw redirect(
    path.to.supplierPayment(supplierId),
    await flash(request, success("Updated supplier payment terms"))
  );
}

export default function SupplierPaymentRoute() {
  const { supplierPayment, bankAccounts } = useLoaderData<typeof loader>();
  const initialValues = {
    supplierId: supplierPayment?.supplierId ?? "",
    invoiceSupplierId: supplierPayment?.invoiceSupplierId ?? "",
    invoiceSupplierContactId: supplierPayment?.invoiceSupplierContactId ?? "",
    invoiceSupplierLocationId: supplierPayment?.invoiceSupplierLocationId ?? "",
    paymentTermId: supplierPayment?.paymentTermId ?? "",
    ...getCustomFields(supplierPayment?.customFields)
  };

  return (
    <VStack spacing={4} className="w-full">
      <SupplierPaymentForm
        key={initialValues.supplierId}
        initialValues={initialValues}
      />
      {/* Renders the drawer routes through its own Outlet. */}
      <SupplierBankAccounts bankAccounts={bankAccounts} />
    </VStack>
  );
}
