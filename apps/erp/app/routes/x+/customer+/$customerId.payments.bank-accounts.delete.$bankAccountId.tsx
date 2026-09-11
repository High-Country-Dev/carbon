import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { deleteCustomerBankAccount } from "~/modules/sales";
import { path } from "~/utils/path";

/** Action-only: the confirmation modal is rendered by CustomerBankAccounts. */
export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    delete: "sales"
  });

  const { customerId, bankAccountId } = params;
  if (!customerId) throw notFound("customerId not found");
  if (!bankAccountId) throw notFound("bankAccountId not found");

  const remove = await deleteCustomerBankAccount(
    client,
    bankAccountId,
    companyId
  );

  if (remove.error) {
    throw redirect(
      path.to.customerPayment(customerId),
      await flash(request, error(remove.error, "Failed to delete bank account"))
    );
  }

  throw redirect(
    path.to.customerPayment(customerId),
    await flash(request, success("Deleted bank account"))
  );
}
