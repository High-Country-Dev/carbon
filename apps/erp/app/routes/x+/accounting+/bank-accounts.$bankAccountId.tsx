import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { bankFieldValuesFromStorage } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import { bankAccountValidator, getBankAccount } from "~/modules/accounting";
import { upsertBankAccount } from "~/modules/accounting/accounting.ee.server";
import { BankAccountForm } from "~/modules/accounting/ui/BankAccounts";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const { bankAccountId } = params;
  if (!bankAccountId) throw notFound("bankAccountId not found");

  const bankAccount = await getBankAccount(client, bankAccountId, companyId);
  if (bankAccount.error) {
    throw redirect(
      `${path.to.bankAccounts}?${getParams(request)}`,
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
    update: "accounting"
  });

  const { bankAccountId } = params;
  if (!bankAccountId) throw notFound("bankAccountId not found");

  const formData = await request.formData();
  const validation = await validator(bankAccountValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _id, storedSecrets: _storedSecrets, ...rest } = validation.data;

  const updateBankAccount = await upsertBankAccount(client, {
    ...rest,
    id: bankAccountId,
    companyId,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (updateBankAccount.error) {
    return data(
      {},
      await flash(
        request,
        error(updateBankAccount.error, "Failed to update bank account")
      )
    );
  }

  throw redirect(
    `${path.to.bankAccounts}?${getParams(request)}`,
    await flash(request, success("Updated bank account"))
  );
}

export default function EditBankAccountRoute() {
  const { bankAccount } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  // The stored account number and IBAN are deliberately absent: they live in the vault
  // and never reach the client. The form renders their last four as a placeholder, and
  // leaving the input empty keeps what the server already holds.
  const initialValues = {
    id: bankAccount?.id ?? undefined,
    name: bankAccount?.name ?? "",
    glAccountId: bankAccount?.glAccountId ?? "",
    active: bankAccount?.active ?? true,
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
    <BankAccountForm
      key={initialValues.id}
      initialValues={initialValues}
      storedLastFour={{
        accountNumber: bankAccount?.accountNumberLastFour,
        iban: bankAccount?.ibanLastFour
      }}
      onClose={() => navigate(-1)}
    />
  );
}
