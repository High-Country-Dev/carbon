import type { Validator } from "@carbon/form";
import type { BankFieldKey, BankFieldValues } from "@carbon/utils";
import { validateBankFields } from "@carbon/utils";
import { z } from "zod";
import { zfd } from "zod-form-data";

export type TypeOfValidator<U extends Validator<any>> =
  U extends Validator<infer T> ? T : unknown;

export const address = {
  addressId: zfd.text(z.string().optional()),
  addressLine1: zfd.text(z.string().optional()),
  addressLine2: zfd.text(z.string().optional()),
  city: zfd.text(z.string().optional()),
  stateProvince: zfd.text(z.string().optional()),
  postalCode: zfd.text(z.string().optional()),
  countryCode: zfd.text(z.string().optional()),
  phone: zfd.text(z.string().optional()),
  fax: zfd.text(z.string().optional())
};

export const contact = {
  contactId: z.string().optional(),
  firstName: zfd.text(z.string().optional()),
  lastName: zfd.text(z.string().optional()),
  title: zfd.text(z.string().optional()),
  email: z
    .string()
    .min(1, { message: "Email is required" })
    .email("Must be a valid email"),
  mobilePhone: zfd.text(z.string().optional()),
  homePhone: zfd.text(z.string().optional()),
  workPhone: zfd.text(z.string().optional()),
  notes: zfd.text(z.string().optional())
};

export const favoriteSchema = z.object({
  id: z.string(),
  favorite: z.enum(["favorite", "unfavorite"])
});

/**
 * The fields a bank account form can submit, across every country. Which of them are
 * actually required is decided per country by the format registry in `@carbon/utils`,
 * applied through `refineBankFields` below — a country's unused fields are simply
 * ignored, so a stale value left over from switching country never blocks a save.
 *
 * `storedSecrets` is how an edit avoids re-typing what the server already holds: the form
 * renders a masked placeholder and submits the names of the secrets already on the record
 * (`accountNumber`, `iban`), which count as satisfying a required field.
 */
export const bankAccountFields = {
  bankName: zfd.text(z.string().optional()),
  accountHolderName: zfd.text(z.string().optional()),
  countryCode: z.string().min(1, { message: "Country is required" }),
  currencyCode: z.string().min(1, { message: "Currency is required" }),
  storedSecrets: zfd.text(z.string().optional()),

  accountNumber: zfd.text(z.string().optional()),
  accountType: zfd.text(z.string().optional()),
  bankCode: zfd.text(z.string().optional()),
  bsb: zfd.text(z.string().optional()),
  iban: zfd.text(z.string().optional()),
  institutionNumber: zfd.text(z.string().optional()),
  routingNumber: zfd.text(z.string().optional()),
  sortCode: zfd.text(z.string().optional()),
  swiftBic: zfd.text(z.string().optional()),
  transitNumber: zfd.text(z.string().optional())
};

type BankAccountFieldValues = {
  countryCode?: string;
  storedSecrets?: string;
} & BankFieldValues;

const BANK_FIELD_MESSAGES: Record<
  BankFieldKey,
  { required: string; invalid: string }
> = {
  accountNumber: {
    required: "Account number is required",
    invalid: "Account number is not valid for this country"
  },
  accountType: {
    required: "Account type is required",
    invalid: "Account type is not valid"
  },
  bankCode: {
    required: "Bank code is required",
    invalid: "Bank code is not valid"
  },
  bsb: { required: "BSB is required", invalid: "BSB must be 6 digits" },
  iban: { required: "IBAN is required", invalid: "IBAN is not valid" },
  institutionNumber: {
    required: "Institution number is required",
    invalid: "Institution number must be 3 digits"
  },
  routingNumber: {
    required: "Routing number is required",
    invalid: "Routing number is not valid"
  },
  sortCode: {
    required: "Sort code is required",
    invalid: "Sort code must be 6 digits"
  },
  swiftBic: {
    required: "SWIFT/BIC is required",
    invalid: "SWIFT/BIC is not valid"
  },
  transitNumber: {
    required: "Transit number is required",
    invalid: "Transit number must be 5 digits"
  }
};

/**
 * Apply the selected country's bank format to a schema built on `bankAccountFields`.
 * Every issue is attached to the field that caused it so the form can surface it inline.
 */
export function refineBankFields<T extends BankAccountFieldValues>(
  values: T,
  ctx: z.RefinementCtx
) {
  const stored = new Set(
    (values.storedSecrets ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean)
  );

  for (const issue of validateBankFields(values.countryCode, values)) {
    // A secret the server already holds satisfies the requirement without re-entry.
    if (issue.code === "required" && stored.has(issue.field)) continue;

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [issue.field],
      message: BANK_FIELD_MESSAGES[issue.field][issue.code]
    });
  }
}
