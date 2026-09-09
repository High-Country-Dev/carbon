import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { proposeCustomerBankChange } from "~/modules/sales";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

/**
 * Action-only: the confirmation modal is rendered by CustomerBankAccounts.
 *
 * Deactivation retires the version rather than deleting it — `customerBankAccount` has no
 * DELETE policy, and the history is the point.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  const { companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { customerId, bankAccountId } = params;
  if (!customerId) throw notFound("customerId not found");
  if (!bankAccountId) throw notFound("bankAccountId not found");

  try {
    await proposeCustomerBankChange(getDatabaseClient(), {
      changeType: "Deactivate",
      companyId,
      customerId,
      userId,
      replacesId: bankAccountId
    });
  } catch (err) {
    throw redirect(
      path.to.customerPayment(customerId),
      await flash(request, error(err, "Failed to deactivate bank account"))
    );
  }

  throw redirect(
    path.to.customerPayment(customerId),
    await flash(request, success("Deactivated bank account"))
  );
}
