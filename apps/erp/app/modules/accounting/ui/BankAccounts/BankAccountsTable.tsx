import { MenuIcon, MenuItem } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuBanknote,
  LuCircleCheck,
  LuGlobe,
  LuHash,
  LuLandmark,
  LuPencil,
  LuTrash
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { path } from "~/utils/path";
import type { BankAccountListItem } from "../../types";

type BankAccountsTableProps = {
  data: BankAccountListItem[];
  count: number;
};

/** Masked identifier, preferring the account number and falling back to the IBAN. */
function maskedIdentifier(row: BankAccountListItem) {
  const lastFour = row.accountNumberLastFour ?? row.ibanLastFour;
  return lastFour ? `•••• ${lastFour}` : "—";
}

const BankAccountsTable = memo(({ data, count }: BankAccountsTableProps) => {
  const { t } = useLingui();
  const [params] = useUrlParams();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const customColumns = useCustomColumns<BankAccountListItem>("bankAccount");

  const columns = useMemo<ColumnDef<BankAccountListItem>[]>(() => {
    const defaultColumns: ColumnDef<BankAccountListItem>[] = [
      {
        accessorKey: "name",
        header: t`Name`,
        cell: ({ row }) => (
          <Hyperlink to={`${row.original.id}?${params.toString()}`}>
            {row.original.name}
          </Hyperlink>
        ),
        meta: { icon: <LuLandmark /> }
      },
      {
        accessorKey: "bankName",
        header: t`Bank`,
        cell: (item) => item.getValue() ?? "—",
        meta: { icon: <LuBanknote /> }
      },
      {
        id: "identifier",
        header: t`Account`,
        cell: ({ row }) => maskedIdentifier(row.original),
        meta: { icon: <LuHash /> }
      },
      {
        accessorKey: "countryCode",
        header: t`Country`,
        cell: (item) => item.getValue(),
        meta: { icon: <LuGlobe /> }
      },
      {
        accessorKey: "currencyCode",
        header: t`Currency`,
        cell: (item) => <Enumerable value={item.getValue<string>()} />,
        meta: { icon: <LuBanknote /> }
      },
      {
        accessorKey: "active",
        header: t`Active`,
        cell: (item) => (item.getValue<boolean>() ? t`Yes` : t`No`),
        meta: { icon: <LuCircleCheck /> }
      }
    ];
    return [...defaultColumns, ...customColumns];
  }, [params, customColumns, t]);

  const renderContextMenu = useCallback(
    (row: BankAccountListItem) => {
      return (
        <>
          <MenuItem
            disabled={!permissions.can("update", "accounting")}
            onClick={() => {
              navigate(`${path.to.bankAccount(row.id)}?${params.toString()}`);
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            <Trans>Edit Bank Account</Trans>
          </MenuItem>
          <MenuItem
            disabled={!permissions.can("delete", "accounting")}
            onClick={() => {
              navigate(
                `${path.to.deleteBankAccount(row.id)}?${params.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            <Trans>Delete Bank Account</Trans>
          </MenuItem>
        </>
      );
    },
    [navigate, params, permissions]
  );

  return (
    <Table<BankAccountListItem>
      data={data}
      columns={columns}
      count={count}
      primaryAction={
        permissions.can("create", "accounting") && (
          <New label={t`Bank Account`} to={`new?${params.toString()}`} />
        )
      }
      renderContextMenu={renderContextMenu}
      title={t`Bank Accounts`}
    />
  );
});

BankAccountsTable.displayName = "BankAccountsTable";
export default BankAccountsTable;
