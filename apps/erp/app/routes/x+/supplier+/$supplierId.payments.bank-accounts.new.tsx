import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect, useNavigate, useParams } from "react-router";
import { useUser } from "~/hooks";
import {
  proposeSupplierBankChange,
  supplierBankAccountValidator
} from "~/modules/purchasing";
import SupplierBankAccountForm from "~/modules/purchasing/ui/Supplier/SupplierBankAccountForm";
import { getDatabaseClient } from "~/services/database.server";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "purchasing"
  });

  const { supplierId } = params;
  if (!supplierId) throw notFound("supplierId not found");

  const formData = await request.formData();
  const validation = await validator(supplierBankAccountValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _id, storedSecrets: _storedSecrets, ...rest } = validation.data;

  try {
    await proposeSupplierBankChange(getDatabaseClient(), {
      ...rest,
      changeType: "Create",
      companyId,
      supplierId,
      userId,
      customFields: setCustomFields(formData)
    });
  } catch (err) {
    return data(
      {},
      await flash(request, error(err, "Failed to create bank account"))
    );
  }

  throw redirect(
    path.to.supplierPayment(supplierId),
    await flash(request, success("Bank account created"))
  );
}

export default function NewSupplierBankAccountRoute() {
  const navigate = useNavigate();
  const { company } = useUser();
  const { supplierId } = useParams();
  if (!supplierId) throw new Error("supplierId not found");

  const initialValues = {
    name: "",
    bankName: "",
    accountHolderName: "",
    // Defaults to the company's own country and currency; the account can be anywhere.
    countryCode: company?.countryCode ?? "",
    currencyCode: company?.baseCurrencyCode ?? ""
  };

  return (
    <SupplierBankAccountForm
      supplierId={supplierId}
      initialValues={initialValues}
      onClose={() => navigate(path.to.supplierPayment(supplierId))}
    />
  );
}
