import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useNavigate } from "react-router";
import { useUser } from "~/hooks";
import { bankAccountValidator } from "~/modules/accounting";
import { upsertBankAccount } from "~/modules/accounting/accounting.ee.server";
import { BankAccountForm } from "~/modules/accounting/ui/BankAccounts";
import { setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "accounting"
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "accounting"
  });

  const formData = await request.formData();
  const validation = await validator(bankAccountValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _id, ...rest } = validation.data;

  const insertBankAccount = await upsertBankAccount(client, {
    ...rest,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (insertBankAccount.error) {
    return data(
      {},
      await flash(
        request,
        error(insertBankAccount.error, "Failed to create bank account")
      )
    );
  }

  throw redirect(
    `${path.to.bankAccounts}?${getParams(request)}`,
    await flash(request, success("Bank account created"))
  );
}

export default function NewBankAccountRoute() {
  const navigate = useNavigate();
  const { company } = useUser();

  const initialValues = {
    name: "",
    glAccountId: "",
    active: true,
    bankName: "",
    accountHolderName: company?.name ?? "",
    // Default to where the company is, then let the user change it — a company can
    // hold an account outside its own country.
    countryCode: company?.countryCode ?? "",
    currencyCode: company?.baseCurrencyCode ?? "",
    fields: "[]"
  };

  return (
    <BankAccountForm
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
