import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deleteBankAccount, getBankAccount } from "~/modules/accounting";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting"
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
  const { client, companyId } = await requirePermissions(request, {
    delete: "accounting"
  });

  const { bankAccountId } = params;
  if (!bankAccountId) {
    throw redirect(
      `${path.to.bankAccounts}?${getParams(request)}`,
      await flash(request, error(params, "Failed to get a bank account id"))
    );
  }

  const { error: deleteError } = await deleteBankAccount(
    client,
    bankAccountId,
    companyId
  );

  if (deleteError) {
    // 23503: something already references this account (a posted payment, later on).
    const message =
      deleteError.code === "23503"
        ? "Bank account is used elsewhere, cannot delete"
        : "Failed to delete bank account";
    throw redirect(
      `${path.to.bankAccounts}?${getParams(request)}`,
      await flash(request, error(deleteError, message))
    );
  }

  throw redirect(
    `${path.to.bankAccounts}?${getParams(request)}`,
    await flash(request, success("Successfully deleted bank account"))
  );
}

export default function DeleteBankAccountRoute() {
  const { bankAccountId } = useParams();
  const { bankAccount } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { t } = useLingui();

  if (!bankAccountId || !bankAccount) return null;

  const onCancel = () => navigate(path.to.bankAccounts);

  return (
    <ConfirmDelete
      action={path.to.deleteBankAccount(bankAccountId)}
      name={bankAccount.name}
      text={t`Are you sure you want to delete the bank account: ${bankAccount.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
