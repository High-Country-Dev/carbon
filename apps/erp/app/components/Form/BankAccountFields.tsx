import { useControlField } from "@carbon/form";
import {
  Button,
  CreatableCombobox,
  HStack,
  IconButton,
  Input as InputBase,
  VStack
} from "@carbon/react";
import type { BankFieldEntry } from "@carbon/utils";
import {
  customBankField,
  getSeededBankField,
  hasBankFieldWarning,
  serializeBankFields,
  suggestBankFields
} from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useRef, useState } from "react";
import { LuPlus, LuTrash, LuTriangleAlert } from "react-icons/lu";
import { Hidden, Input } from "~/components/Form";
import Country from "~/components/Form/Country";
import Currency from "~/components/Form/Currency";

/**
 * The identifier half of every bank account form — the company's own accounts, suppliers'
 * and customers' alike.
 *
 * A bank account's identifiers are not a fixed set of inputs. The user adds as many as the
 * account needs, choosing each one from the catalog Carbon seeds or typing a name of their
 * own, and the whole bag is submitted as a single JSON string in the hidden `fields` input.
 * The country selection reorders the catalog; it never restricts it, because a supplier
 * abroad can bank anywhere.
 *
 * Rows live in local state rather than as registered form fields. A registered field per
 * row would mean the field set changing shape as the user edits it, which `ValidatedForm`
 * has no way to express — and the server wants one bag anyway.
 */

type BankAccountFieldsProps = {
  /** The bag already stored, when editing. */
  initialFields?: BankFieldEntry[];
};

/** A row in the editor. `rowId` is stable across re-renders; the key can be edited. */
type FieldRow = BankFieldEntry & { rowId: string };

const BankAccountFields = ({ initialFields }: BankAccountFieldsProps) => {
  const { t } = useLingui();
  const [countryCode] = useControlField<string>("countryCode");

  // Monotonic, so removing a row never lets a later one reuse its key and inherit its
  // uncommitted input state.
  const nextRowId = useRef(0);
  const makeRow = (entry: BankFieldEntry): FieldRow => ({
    ...entry,
    rowId: `row-${nextRowId.current++}`
  });

  const [rows, setRows] = useState<FieldRow[]>(() =>
    (initialFields ?? []).map(makeRow)
  );

  const suggestions = useMemo(
    () => suggestBankFields(countryCode),
    [countryCode]
  );

  const updateRow = (rowId: string, patch: Partial<BankFieldEntry>) =>
    setRows((current) =>
      current.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row))
    );

  const addRow = () =>
    setRows((current) => [
      ...current,
      makeRow({ key: "", label: "", value: "" })
    ]);

  const removeRow = (rowId: string) =>
    setRows((current) => current.filter((row) => row.rowId !== rowId));

  const renderRow = (row: FieldRow) => {
    // A row whose key is not in the catalog — a custom one, or a seeded key retired since
    // the row was saved — still has to render as the selected option.
    const options = suggestions.map((field) => ({
      value: field.key,
      label: field.label
    }));
    if (row.key && !suggestions.some((field) => field.key === row.key)) {
      options.unshift({ value: row.key, label: row.label || row.key });
    }

    const seeded = getSeededBankField(row.key);
    const showWarning = hasBankFieldWarning(row.key, row.value);

    return (
      <VStack key={row.rowId} spacing={1} className="w-full">
        {/* 140px keeps the name, the value and the remove button on one line inside a
            standard drawer; below that the pair wraps rather than crushing both inputs. */}
        <HStack className="w-full items-center gap-2 flex-wrap">
          <div className="flex-1 min-w-[140px]">
            <CreatableCombobox
              value={row.key}
              options={options}
              placeholder={t`Select a detail`}
              inlineAddLabel={t`Add`}
              onChange={(key) => {
                const field = getSeededBankField(key);
                updateRow(row.rowId, {
                  key,
                  label: field?.label ?? row.label ?? key
                });
              }}
              onCreateOption={(typed) => {
                const field = customBankField(typed);
                updateRow(row.rowId, { key: field.key, label: field.label });
              }}
            />
          </div>
          <div className="flex-1 min-w-[140px]">
            <InputBase
              value={row.value}
              placeholder={seeded?.placeholder}
              autoComplete="off"
              aria-label={row.label || t`Value`}
              onChange={(event) =>
                updateRow(row.rowId, { value: event.target.value })
              }
            />
          </div>
          <IconButton
            aria-label={t`Remove`}
            variant="ghost"
            className="shrink-0"
            icon={<LuTrash />}
            onClick={() => removeRow(row.rowId)}
          />
        </HStack>
        {showWarning && (
          <HStack className="items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
            <LuTriangleAlert />
            <span>
              <Trans>
                This does not look like a valid {row.label}. Saved as entered.
              </Trans>
            </span>
          </HStack>
        )}
      </VStack>
    );
  };

  return (
    <VStack spacing={4}>
      <Input name="bankName" label={t`Bank Name`} />
      <Input name="accountHolderName" label={t`Account Holder`} />
      {/* The account's own country, not the party's — a supplier abroad can bank here. */}
      <Country
        name="countryCode"
        label={t`Bank Country`}
        helperText={t`Where the account is held. This orders the suggested details below.`}
      />
      <Currency name="currencyCode" label={t`Currency`} />

      <VStack spacing={2}>
        {/* A plain label, not `FormLabel` — that reads `useFormControlContext` and
            throws outside a `FormControl`, and this heading labels the whole list
            rather than any one input. */}
        <span className="text-xs font-medium text-muted-foreground">
          <Trans>Bank Details</Trans>
        </span>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            <Trans>
              Add the details your bank quotes — an IBAN, an account and routing
              number, or anything else this account needs.
            </Trans>
          </p>
        ) : (
          rows.map(renderRow)
        )}
        <Button
          variant="secondary"
          leftIcon={<LuPlus />}
          onClick={addRow}
          type="button"
        >
          <Trans>Add Detail</Trans>
        </Button>
        {/* Carries the whole bag, and the place the bag-level error renders. Serialized
            here rather than on the server so what is validated is what is stored. */}
        <Hidden
          name="fields"
          value={JSON.stringify(serializeBankFields(rows))}
        />
      </VStack>
    </VStack>
  );
};

export default BankAccountFields;
