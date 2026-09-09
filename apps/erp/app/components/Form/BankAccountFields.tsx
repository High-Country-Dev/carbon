import { useControlField } from "@carbon/form";
import { VStack } from "@carbon/react";
import type { BankFieldSpec } from "@carbon/utils";
import { resolveBankFormat, US_ACCOUNT_TYPES } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { Hidden, Input, Select } from "~/components/Form";
import Country from "~/components/Form/Country";
import Currency from "~/components/Form/Currency";

/**
 * The bank-identifier half of every bank account form — the company's own accounts,
 * suppliers' and customers' alike.
 *
 * Which inputs appear is decided by the account's country through the format registry in
 * `@carbon/utils`: pick the United States and you get a routing number, an account number
 * and an account type; pick Germany and you get an IBAN. The fields for other countries
 * are not hidden, they are unmounted, so their values never reach FormData — and
 * `splitBankFieldsForStorage` drops anything the format does not declare anyway, so a
 * stale identifier cannot ride onto a row by either path.
 *
 * Account numbers and IBANs are never sent to the client. On an existing record the input
 * renders the stored last four as its placeholder and stays empty; leaving it that way
 * keeps what the server already holds, and `storedSecrets` tells the validator so.
 */

type BankAccountFieldsProps = {
  /** Last four of the identifiers already stored, when editing. */
  storedLastFour?: {
    accountNumber?: string | null;
    iban?: string | null;
  };
};

const BankAccountFields = ({ storedLastFour }: BankAccountFieldsProps) => {
  const { t } = useLingui();
  const [countryCode] = useControlField<string>("countryCode");

  const format = resolveBankFormat(countryCode);

  const storedSecrets = [
    storedLastFour?.accountNumber ? "accountNumber" : null,
    storedLastFour?.iban ? "iban" : null
  ]
    .filter(Boolean)
    .join(",");

  const masked = (lastFour: string | null | undefined) =>
    lastFour ? `•••• ${lastFour}` : undefined;

  // `isRequired` comes from the format rather than the zod schema: every identifier is
  // optional in the schema and enforced per country by `refineBankFields`, so the label
  // would otherwise read "Optional" on a field the save is about to reject.
  const renderField = ({ key, required }: BankFieldSpec) => {
    switch (key) {
      case "accountNumber":
        return (
          <Input
            key={key}
            name="accountNumber"
            isRequired={required}
            label={t`Account Number`}
            placeholder={masked(storedLastFour?.accountNumber)}
            autoComplete="off"
          />
        );
      case "accountType":
        return (
          <Select
            key={key}
            name="accountType"
            isRequired={required}
            label={t`Account Type`}
            options={US_ACCOUNT_TYPES.map((type) => ({
              value: type,
              label: type
            }))}
          />
        );
      case "bankCode":
        return (
          <Input
            key={key}
            name="bankCode"
            isRequired={required}
            label={t`Bank Code`}
            helperText={t`The domestic clearing code your bank uses, if it has one.`}
          />
        );
      case "bsb":
        return (
          <Input
            key={key}
            name="bsb"
            isRequired={required}
            label={t`BSB`}
            placeholder={t`e.g. 083-004`}
          />
        );
      case "iban":
        return (
          <Input
            key={key}
            name="iban"
            isRequired={required}
            label={t`IBAN`}
            placeholder={
              masked(storedLastFour?.iban) ??
              t`e.g. DE89 3704 0044 0532 0130 00`
            }
            autoComplete="off"
          />
        );
      case "institutionNumber":
        return (
          <Input
            key={key}
            name="institutionNumber"
            isRequired={required}
            label={t`Institution Number`}
            placeholder={t`e.g. 003`}
          />
        );
      case "routingNumber":
        return (
          <Input
            key={key}
            name="routingNumber"
            isRequired={required}
            label={t`Routing Number`}
            placeholder={t`e.g. 021000021`}
          />
        );
      case "sortCode":
        return (
          <Input
            key={key}
            name="sortCode"
            isRequired={required}
            label={t`Sort Code`}
            placeholder={t`e.g. 12-34-56`}
          />
        );
      case "swiftBic":
        return (
          <Input
            key={key}
            name="swiftBic"
            isRequired={required}
            label={t`SWIFT / BIC`}
            placeholder={t`e.g. CHASUS33`}
            helperText={t`Needed for international payments.`}
          />
        );
      case "transitNumber":
        return (
          <Input
            key={key}
            name="transitNumber"
            isRequired={required}
            label={t`Transit Number`}
            placeholder={t`e.g. 12345`}
          />
        );
      default:
        return null;
    }
  };

  return (
    <VStack spacing={4}>
      <Hidden name="storedSecrets" value={storedSecrets} />
      <Input name="bankName" label={t`Bank Name`} />
      <Input name="accountHolderName" label={t`Account Holder`} />
      {/* The account's own country, not the party's — a supplier abroad can bank here. */}
      <Country
        name="countryCode"
        label={t`Bank Country`}
        helperText={t`Where the account is held. This decides which details are required.`}
      />
      <Currency name="currencyCode" label={t`Currency`} />
      {format.fields.map((field) => renderField(field))}
    </VStack>
  );
};

export default BankAccountFields;
