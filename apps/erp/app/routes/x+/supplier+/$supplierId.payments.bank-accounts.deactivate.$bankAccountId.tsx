import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { proposeSupplierBankChange } from "~/modules/purchasing";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

/**
 * Action-only: the confirmation modal is rendered by SupplierBankAccounts.
 *
 * Deactivation retires the version rather than deleting it — `supplierBankAccount` has no
 * DELETE policy, and the history is the point.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  const { companyId, userId } = await requirePermissions(request, {
    update: "purchasing"
  });

  const { supplierId, bankAccountId } = params;
  if (!supplierId) throw notFound("supplierId not found");
  if (!bankAccountId) throw notFound("bankAccountId not found");

  try {
    await proposeSupplierBankChange(getDatabaseClient(), {
      changeType: "Deactivate",
      companyId,
      supplierId,
      userId,
      replacesId: bankAccountId
    });
  } catch (err) {
    throw redirect(
      path.to.supplierPayment(supplierId),
      await flash(request, error(err, "Failed to deactivate bank account"))
    );
  }

  throw redirect(
    path.to.supplierPayment(supplierId),
    await flash(request, success("Deactivated bank account"))
  );
}
