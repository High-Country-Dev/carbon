import type { Validator } from "@carbon/form";
import { parseBankFields } from "@carbon/utils";
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
 * The fields a bank account form submits.
 *
 * The identifiers themselves are NOT individual form fields — they are an ordered bag the
 * user builds by picking or naming each one, submitted as a single JSON string in
 * `fields`. That is what lets a user record an identifier Carbon has never heard of, and
 * it is why this fragment is the same four inputs for every country.
 *
 * `refineBankFields` rejects only an unreadable bag or an empty one. Whether a particular
 * identifier is present is the user's business — nothing reads these rows yet, and the
 * user is looking at the bank's own paperwork.
 */
export const bankAccountFields = {
  bankName: zfd.text(z.string().optional()),
  accountHolderName: zfd.text(z.string().optional()),
  countryCode: z.string().min(1, { message: "Country is required" }),
  currencyCode: z.string().min(1, { message: "Currency is required" }),
  /** JSON array of `{ key, label, value }`; see `@carbon/utils` `parseBankFields`. */
  fields: zfd.text(z.string().optional())
};

type BankAccountFieldValues = { fields?: string };

/** Attach bag-level issues to the `fields` path so the form can surface them inline. */
export function refineBankFields<T extends BankAccountFieldValues>(
  values: T,
  ctx: z.RefinementCtx
) {
  const raw = values.fields?.trim();

  // An unparseable bag reads as zero entries, which is indistinguishable from an empty
  // form. Check the string itself so a serialization bug cannot present as user error.
  if (raw && raw !== "[]") {
    try {
      if (!Array.isArray(JSON.parse(raw))) throw new Error("not an array");
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fields"],
        message: "Bank details could not be read"
      });
      return;
    }
  }

  if (parseBankFields(raw).filter((field) => field.value.trim()).length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["fields"],
      message: "Add at least one bank detail"
    });
  }
}
