import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { bankFieldValuesFromStorage } from "@carbon/utils";
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
  proposeCustomerBankChange
} from "~/modules/sales";
import CustomerBankAccountForm from "~/modules/sales/ui/Customer/CustomerBankAccountForm";
import { getDatabaseClient } from "~/services/database.server";
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
  const { companyId, userId } = await requirePermissions(request, {
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

  const { id: _id, storedSecrets: _storedSecrets, ...rest } = validation.data;

  try {
    // Inserts a new version and retires this one; the row itself is never updated.
    await proposeCustomerBankChange(getDatabaseClient(), {
      ...rest,
      changeType: "Update",
      companyId,
      customerId,
      userId,
      replacesId: bankAccountId,
      customFields: setCustomFields(formData)
    });
  } catch (err) {
    return data(
      {},
      await flash(request, error(err, "Failed to update bank account"))
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

  // The stored account number and IBAN stay in the vault. The form renders their last
  // four as a placeholder; leaving the input empty carries them onto the new version.
  const initialValues = {
    id: bankAccount?.id ?? undefined,
    name: bankAccount?.name ?? "",
    bankName: bankAccount?.bankName ?? "",
    accountHolderName: bankAccount?.accountHolderName ?? "",
    countryCode: bankAccount?.countryCode ?? "",
    currencyCode: bankAccount?.currencyCode ?? "",
    ...bankFieldValuesFromStorage({
      formatId: bankAccount?.formatId,
      countryCode: bankAccount?.countryCode,
      swiftBic: bankAccount?.swiftBic,
      routingNumber: bankAccount?.routingNumber,
      bankIdentifiers: bankAccount?.bankIdentifiers as Record<string, unknown>
    }),
    ...getCustomFields(bankAccount?.customFields)
  };

  return (
    <CustomerBankAccountForm
      key={initialValues.id}
      customerId={customerId}
      initialValues={initialValues}
      storedLastFour={{
        accountNumber: bankAccount?.accountNumberLastFour,
        iban: bankAccount?.ibanLastFour
      }}
      onClose={() => navigate(path.to.customerPayment(customerId))}
    />
  );
}
