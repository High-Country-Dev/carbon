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
import type { SupplierBankAccount } from "~/modules/purchasing/types";
import type { Action } from "~/types";
import { path } from "~/utils/path";

type SupplierBankAccountsProps = {
  bankAccounts: SupplierBankAccount[];
};

/** Masked identifier — the full account number never leaves the server. */
function maskedIdentifier(account: SupplierBankAccount) {
  const lastFour = account.accountNumberLastFour ?? account.ibanLastFour;
  return lastFour ? `•••• ${lastFour}` : "—";
}

const SupplierBankAccounts = ({ bankAccounts }: SupplierBankAccountsProps) => {
  const { t } = useLingui();
  const navigate = useNavigate();
  const { supplierId } = useParams();
  if (!supplierId) throw new Error("supplierId not found");

  const permissions = usePermissions();
  const canEdit = permissions.can("update", "purchasing");

  const deactivateModal = useDisclosure();
  const [selected, setSelected] = useState<SupplierBankAccount>();

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
    (account: SupplierBankAccount) => {
      const actions: Action[] = [];
      if (canEdit) {
        actions.push({
          label: t`Edit Bank Account`,
          icon: <LuPencil />,
          onClick: () => {
            navigate(path.to.supplierBankAccount(supplierId, account.id));
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
    [canEdit, deactivateModal, navigate, supplierId, t]
  );

  const renderRow = (account: SupplierBankAccount, isActive: boolean) => (
    <li
      key={account.id}
      className="flex items-start justify-between gap-4 border rounded-lg p-4 w-full"
    >
      {/* min-w-0 so a long account name truncates instead of pushing the action menu
          off the row — a flex item's default min-width is its content. */}
      <VStack spacing={1} className="min-w-0">
        <HStack className="items-center gap-2 max-w-full">
          <span className="font-medium line-clamp-1">{account.name}</span>
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
        <span className="text-muted-foreground text-sm line-clamp-1">
          {[account.bankName, maskedIdentifier(account)]
            .filter(Boolean)
            .join(" · ")}
        </span>
        <span className="text-muted-foreground text-xs line-clamp-1">
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
            {canEdit && <New to={path.to.newSupplierBankAccount(supplierId)} />}
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
          action={path.to.deactivateSupplierBankAccount(
            supplierId,
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

export default SupplierBankAccounts;
