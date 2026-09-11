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
  useDisclosure,
  VStack
} from "@carbon/react";
import { parseBankFields, summarizeBankFields } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useState } from "react";
import { LuPencil, LuTrash } from "react-icons/lu";
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

const CustomerBankAccounts = ({ bankAccounts }: CustomerBankAccountsProps) => {
  const { t } = useLingui();
  const navigate = useNavigate();
  const { customerId } = useParams();
  if (!customerId) throw new Error("customerId not found");

  const permissions = usePermissions();
  const canEdit = permissions.can("update", "sales");
  const canDelete = permissions.can("delete", "sales");

  const deleteModal = useDisclosure();
  const [selected, setSelected] = useState<CustomerBankAccount>();

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
      }
      if (canDelete) {
        actions.push({
          label: t`Delete Bank Account`,
          icon: <LuTrash />,
          onClick: () => {
            setSelected(account);
            deleteModal.onOpen();
          }
        });
      }
      return actions;
    },
    [canDelete, canEdit, deleteModal, navigate, customerId, t]
  );

  const renderRow = (account: CustomerBankAccount) => {
    const summary = summarizeBankFields(parseBankFields(account.fields));

    return (
      <li
        key={account.id}
        className="flex items-start justify-between gap-4 border rounded-lg p-4 w-full"
      >
        {/* min-w-0 so a long account name truncates instead of pushing the action menu
            off the row — a flex item's default min-width is its content. */}
        <VStack spacing={1} className="min-w-0">
          <span className="font-medium line-clamp-1">{account.name}</span>
          <span className="text-muted-foreground text-sm line-clamp-1">
            {[account.bankName, summary].filter(Boolean).join(" · ")}
          </span>
          <span className="text-muted-foreground text-xs line-clamp-1">
            {[account.countryCode, account.currencyCode]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </VStack>
        {getActions(account).length > 0 && (
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
  };

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
            {permissions.can("create", "sales") && (
              <New to={path.to.newCustomerBankAccount(customerId)} />
            )}
          </CardAction>
        </HStack>
        <CardContent>
          {bankAccounts.length === 0 ? (
            <div className="my-8 text-center w-full">
              <p className="text-muted-foreground text-sm">
                <Trans>No bank accounts have been recorded yet.</Trans>
              </p>
            </div>
          ) : (
            <ul className="flex flex-col w-full gap-4">
              {bankAccounts.map(renderRow)}
            </ul>
          )}
        </CardContent>
      </Card>

      {selected && (
        <ConfirmDelete
          action={path.to.deleteCustomerBankAccount(customerId, selected.id)}
          name={selected.name}
          title={t`Delete Bank Account`}
          text={t`Are you sure you want to delete ${selected.name}? This cannot be undone.`}
          isOpen={deleteModal.isOpen}
          onCancel={deleteModal.onClose}
          onSubmit={deleteModal.onClose}
        />
      )}

      <Outlet />
    </>
  );
};

export default CustomerBankAccounts;
