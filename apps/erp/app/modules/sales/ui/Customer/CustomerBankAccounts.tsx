import {
  ActionMenu,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  DropdownMenuIcon,
  DropdownMenuItem,
  HStack,
  Status,
  useDisclosure,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useState } from "react";
import { LuBan, LuPencil } from "react-icons/lu";
import { Outlet, useNavigate, useParams } from "react-router";
import { New } from "~/components";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import type { CustomerBankAccount } from "~/modules/sales/types";
import type { Action } from "~/types";
import { path } from "~/utils/path";

type CustomerBankAccountsProps = {
  bankAccounts: CustomerBankAccount[];
};

/** Masked identifier — the full account number never leaves the server. */
function maskedIdentifier(account: CustomerBankAccount) {
  const lastFour = account.accountNumberLastFour ?? account.ibanLastFour;
  return lastFour ? `•••• ${lastFour}` : "—";
}

const CustomerBankAccounts = ({ bankAccounts }: CustomerBankAccountsProps) => {
  const { t } = useLingui();
  const navigate = useNavigate();
  const { customerId } = useParams();
  if (!customerId) throw new Error("customerId not found");

  const permissions = usePermissions();
  const canEdit = permissions.can("update", "sales");

  const deactivateModal = useDisclosure();
  const [selected, setSelected] = useState<CustomerBankAccount>();

  const active = bankAccounts.filter((account) => account.status === "Active");
  const superseded = bankAccounts.filter(
    (account) => account.status !== "Active"
  );

  // A retired version was either replaced by a newer one or deactivated outright. Only
  // the first is "superseded", and the history is the surface a reviewer reads.
  const replacedIds = new Set(
    bankAccounts
      .map((account) => account.replacesId)
      .filter((id): id is string => Boolean(id))
  );

  const getActions = useCallback(
    (account: CustomerBankAccount) => {
      const actions: Action[] = [];
      if (canEdit) {
        actions.push({
          label: t`Edit Bank Account`,
          icon: <LuPencil />,
          onClick: () => {
            navigate(path.to.customerBankAccount(customerId, account.id));
          }
        });
        actions.push({
          label: t`Deactivate Bank Account`,
          icon: <LuBan />,
          onClick: () => {
            setSelected(account);
            deactivateModal.onOpen();
          }
        });
      }
      return actions;
    },
    [canEdit, deactivateModal, navigate, customerId, t]
  );

  const renderRow = (account: CustomerBankAccount, isActive: boolean) => (
    <li
      key={account.id}
      className="flex items-start justify-between gap-4 border rounded-lg p-4 w-full"
    >
      <VStack spacing={1}>
        <HStack className="items-center gap-2">
          <span className="font-medium">{account.name}</span>
          {!isActive && (
            <Status color="gray">
              {replacedIds.has(account.id) ? (
                <Trans>Superseded</Trans>
              ) : (
                <Trans>Deactivated</Trans>
              )}
            </Status>
          )}
        </HStack>
        <span className="text-muted-foreground text-sm">
          {[account.bankName, maskedIdentifier(account)]
            .filter(Boolean)
            .join(" · ")}
        </span>
        <span className="text-muted-foreground text-xs">
          {[account.countryCode, account.currencyCode]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </VStack>
      {isActive && getActions(account).length > 0 && (
        <ActionMenu>
          {getActions(account).map((action) => (
            <DropdownMenuItem key={action.label} onClick={action.onClick}>
              <DropdownMenuIcon icon={action.icon} />
              {action.label}
            </DropdownMenuItem>
          ))}
        </ActionMenu>
      )}
    </li>
  );

  return (
    <>
      <Card>
        <HStack className="justify-between items-start">
          <CardHeader>
            <CardTitle>
              <Trans>Bank Accounts</Trans>
            </CardTitle>
          </CardHeader>
          <CardAction>
            {canEdit && <New to={path.to.newCustomerBankAccount(customerId)} />}
          </CardAction>
        </HStack>
        <CardContent>
          {active.length === 0 ? (
            <div className="my-8 text-center w-full">
              <p className="text-muted-foreground text-sm">
                <Trans>No bank accounts have been recorded yet.</Trans>
              </p>
            </div>
          ) : (
            <ul className="flex flex-col w-full gap-4">
              {active.map((account) => renderRow(account, true))}
            </ul>
          )}

          {superseded.length > 0 && (
            <VStack spacing={2} className="mt-6">
              <span className="text-muted-foreground text-xs uppercase tracking-wide">
                <Trans>History</Trans>
              </span>
              <ul className="flex flex-col w-full gap-4">
                {superseded.map((account) => renderRow(account, false))}
              </ul>
            </VStack>
          )}
        </CardContent>
      </Card>

      {selected && (
        <ConfirmDelete
          action={path.to.deactivateCustomerBankAccount(
            customerId,
            selected.id
          )}
          name={selected.name}
          title={t`Deactivate Bank Account`}
          deleteText={t`Deactivate`}
          text={t`Deactivate ${selected.name}? It stays in the history, but stops being an account we can pay to.`}
          isOpen={deactivateModal.isOpen}
          onCancel={deactivateModal.onClose}
          onSubmit={deactivateModal.onClose}
        />
      )}

      <Outlet />
    </>
  );
};

export default CustomerBankAccounts;
