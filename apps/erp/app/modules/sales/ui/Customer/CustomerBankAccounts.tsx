import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  useDisclosure,
  VStack
} from "@carbon/react";
import { maskAccountNumber } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useState } from "react";
import {
  LuEllipsisVertical,
  LuEye,
  LuEyeOff,
  LuPencil,
  LuTrash
} from "react-icons/lu";
import { Outlet, useNavigate, useParams } from "react-router";
import { New } from "~/components";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import type { CustomerBankAccount } from "~/modules/sales/types";
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
  const canEdit = permissions.can("create", "accounting");
  const isEmpty = !bankAccounts || bankAccounts.length === 0;

  const deleteModal = useDisclosure();
  const [selected, setSelected] = useState<CustomerBankAccount>();

  // Presentation only. The loader returns the full account number, so this
  // deters shoulder-surfing and screenshots — it is not an access control.
  // Access is enforced by the accounting_view RLS policy on the table.
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const toggleReveal = useCallback((id: string) => {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  return (
    <>
      <Card>
        <HStack className="justify-between items-start">
          <CardHeader>
            <CardTitle>
              <Trans>Bank Accounts</Trans>
            </CardTitle>
          </CardHeader>
          <CardAction>{canEdit && <New to="new" />}</CardAction>
        </HStack>
        <CardContent>
          {isEmpty ? (
            <div className="my-8 text-center w-full">
              <p className="text-muted-foreground text-sm">
                <Trans>No bank accounts have been added yet.</Trans>
              </p>
            </div>
          ) : (
            <ul className="flex flex-col w-full gap-4">
              {bankAccounts.map((account) => {
                const identifier = account.accountNumber ?? "";
                const isRevealed = revealed.has(account.id);

                return (
                  <li
                    key={account.id}
                    className="border rounded-lg p-4 flex justify-between items-start gap-4"
                  >
                    <VStack spacing={1}>
                      <HStack>
                        <span className="font-medium">{account.name}</span>
                      </HStack>
                      {account.bankName && (
                        <span className="text-muted-foreground text-sm">
                          {account.bankName}
                        </span>
                      )}
                      <HStack>
                        <span className="font-mono text-sm">
                          {isRevealed
                            ? identifier
                            : maskAccountNumber(identifier)}
                        </span>
                        {identifier && (
                          <IconButton
                            aria-label={
                              isRevealed
                                ? t`Hide account number`
                                : t`Reveal account number`
                            }
                            icon={isRevealed ? <LuEyeOff /> : <LuEye />}
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleReveal(account.id)}
                          />
                        )}
                      </HStack>
                    </VStack>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <IconButton
                          aria-label={t`More`}
                          icon={<LuEllipsisVertical />}
                          variant="secondary"
                        />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem
                          disabled={!permissions.can("update", "accounting")}
                          onClick={() => navigate(account.id)}
                        >
                          <LuPencil className="mr-2" />
                          <Trans>Edit</Trans>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          destructive
                          disabled={!permissions.can("delete", "accounting")}
                          onClick={() => {
                            setSelected(account);
                            deleteModal.onOpen();
                          }}
                        >
                          <LuTrash className="mr-2" />
                          <Trans>Delete</Trans>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {selected?.id && (
        <ConfirmDelete
          action={path.to.deleteCustomerBankAccount(customerId, selected.id)}
          name={selected.name}
          text={t`Are you sure you want to delete this bank account?`}
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
