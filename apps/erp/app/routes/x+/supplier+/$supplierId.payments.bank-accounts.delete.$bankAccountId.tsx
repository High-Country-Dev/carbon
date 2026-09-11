import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { deleteSupplierBankAccount } from "~/modules/purchasing";
import { path } from "~/utils/path";

/** Action-only: the confirmation modal is rendered by SupplierBankAccounts. */
export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    delete: "purchasing"
  });

  const { supplierId, bankAccountId } = params;
  if (!supplierId) throw notFound("supplierId not found");
  if (!bankAccountId) throw notFound("bankAccountId not found");

  const remove = await deleteSupplierBankAccount(
    client,
    bankAccountId,
    companyId
  );

  if (remove.error) {
    throw redirect(
      path.to.supplierPayment(supplierId),
      await flash(request, error(remove.error, "Failed to delete bank account"))
    );
  }

  throw redirect(
    path.to.supplierPayment(supplierId),
    await flash(request, success("Deleted bank account"))
  );
}
