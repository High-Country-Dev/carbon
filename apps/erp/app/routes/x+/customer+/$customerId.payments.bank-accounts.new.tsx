import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect, useNavigate, useParams } from "react-router";
import { useUser } from "~/hooks";
import {
  customerBankAccountValidator,
  upsertCustomerBankAccount
} from "~/modules/sales";
import CustomerBankAccountForm from "~/modules/sales/ui/Customer/CustomerBankAccountForm";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "sales"
  });

  const { customerId } = params;
  if (!customerId) throw notFound("customerId not found");

  const formData = await request.formData();
  const validation = await validator(customerBankAccountValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _id, ...rest } = validation.data;

  const insert = await upsertCustomerBankAccount(client, {
    ...rest,
    companyId,
    customerId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (insert.error) {
    return data(
      {},
      await flash(request, error(insert.error, "Failed to create bank account"))
    );
  }

  throw redirect(
    path.to.customerPayment(customerId),
    await flash(request, success("Bank account created"))
  );
}

export default function NewCustomerBankAccountRoute() {
  const navigate = useNavigate();
  const { company } = useUser();
  const { customerId } = useParams();
  if (!customerId) throw new Error("customerId not found");

  const initialValues = {
    name: "",
    bankName: "",
    accountHolderName: "",
    // Defaults to the company's own country and currency; the account can be anywhere.
    countryCode: company?.countryCode ?? "",
    currencyCode: company?.baseCurrencyCode ?? "",
    fields: "[]"
  };

  return (
    <CustomerBankAccountForm
      customerId={customerId}
      initialValues={initialValues}
      onClose={() => navigate(path.to.customerPayment(customerId))}
    />
  );
}
