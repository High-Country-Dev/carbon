import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { parseBankFields } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  redirect,
  useLoaderData,
  useNavigate,
  useParams
} from "react-router";
import {
  customerBankAccountValidator,
  getCustomerBankAccount,
  upsertCustomerBankAccount
} from "~/modules/sales";
import CustomerBankAccountForm from "~/modules/sales/ui/Customer/CustomerBankAccountForm";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });

  const { customerId, bankAccountId } = params;
  if (!customerId) throw notFound("customerId not found");
  if (!bankAccountId) throw notFound("bankAccountId not found");

  const bankAccount = await getCustomerBankAccount(
    client,
    bankAccountId,
    companyId
  );

  if (bankAccount.error) {
    throw redirect(
      path.to.customerPayment(customerId),
      await flash(
        request,
        error(bankAccount.error, "Failed to get bank account")
      )
    );
  }

  return { bankAccount: bankAccount.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { customerId, bankAccountId } = params;
  if (!customerId) throw notFound("customerId not found");
  if (!bankAccountId) throw notFound("bankAccountId not found");

  const formData = await request.formData();
  const validation = await validator(customerBankAccountValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _id, ...rest } = validation.data;

  const update = await upsertCustomerBankAccount(client, {
    ...rest,
    id: bankAccountId,
    companyId,
    customerId,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (update.error) {
    return data(
      {},
      await flash(request, error(update.error, "Failed to update bank account"))
    );
  }

  throw redirect(
    path.to.customerPayment(customerId),
    await flash(request, success("Updated bank account"))
  );
}

export default function EditCustomerBankAccountRoute() {
  const { bankAccount } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const { customerId } = useParams();
  if (!customerId) throw new Error("customerId not found");

  const fields = parseBankFields(bankAccount?.fields);

  const initialValues = {
    id: bankAccount?.id ?? undefined,
    name: bankAccount?.name ?? "",
    bankName: bankAccount?.bankName ?? "",
    accountHolderName: bankAccount?.accountHolderName ?? "",
    countryCode: bankAccount?.countryCode ?? "",
    currencyCode: bankAccount?.currencyCode ?? "",
    fields: JSON.stringify(fields),
    ...getCustomFields(bankAccount?.customFields)
  };

  return (
    <CustomerBankAccountForm
      key={initialValues.id}
      customerId={customerId}
      initialValues={initialValues}
      storedFields={fields}
      onClose={() => navigate(path.to.customerPayment(customerId))}
    />
  );
}
