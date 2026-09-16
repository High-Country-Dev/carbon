/**
 * Validation for counterparty bank identifiers.
 *
 * These are format/checksum checks only — they prove a value is well-formed,
 * not that the account exists or belongs to the supplier. Confirming that is
 * an out-of-band process (a phone call to a known number), not a regex.
 */

/**
 * ISO 13616 IBAN check: move the first four characters to the end, expand
 * letters to digits (A=10 … Z=35), then the whole number mod 97 must equal 1.
 */
export function isValidIban(raw: string): boolean {
  const iban = raw.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{1,30}$/.test(iban)) return false;

  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const expanded = rearranged.replace(/[A-Z]/g, (c) =>
    (c.charCodeAt(0) - 55).toString()
  );

  // The expanded value exceeds Number.MAX_SAFE_INTEGER, so fold digit by digit
  // rather than parsing it as a single number.
  let remainder = 0;
  for (const digit of expanded) {
    remainder = (remainder * 10 + Number(digit)) % 97;
  }

  return remainder === 1;
}

/**
 * ABA routing transit number check: exactly 9 digits, and the 3-7-1 weighted
 * sum must be divisible by 10.
 */
export function isValidAbaRouting(raw: string): boolean {
  const digits = raw.replace(/\s+/g, "");
  if (!/^[0-9]{9}$/.test(digits)) return false;

  const weights = [3, 7, 1, 3, 7, 1, 3, 7, 1] as const;
  const sum = digits
    .split("")
    .reduce((acc, digit, i) => acc + Number(digit) * (weights[i] ?? 0), 0);

  return sum % 10 === 0;
}

/** ISO 9362 BIC: 8 or 11 characters — 6 letters, then 2 alphanumerics, then an optional 3-character branch. */
export function isValidSwiftBic(raw: string): boolean {
  const bic = raw.replace(/\s+/g, "").toUpperCase();
  return /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic);
}

/**
 * Last four characters of an account identifier, for display.
 * Returns "••••" when the value is too short to partially mask.
 */
export function maskAccountNumber(value: string | null | undefined): string {
  if (!value) return "";
  const trimmed = value.replace(/\s+/g, "");
  if (trimmed.length <= 4) return "••••";
  return `••••${trimmed.slice(-4)}`;
}

/**
 * Per-country bank field configuration.
 *
 * Countries differ in what the account identifier is called (IBAN, account
 * number) and whether they use a routing identifier at all (ABA, sort code,
 * BSB, IFSC, transit number). Rather than one column per scheme — which needs a
 * migration per country — `accountNumber` and `bankCode` are generic, and this
 * map decides how each is labelled and validated. Adding a country is an entry
 * here, not a schema change.
 *
 * A country with no entry falls back to DEFAULT_BANK_FIELDS: both fields
 * present, format-checked only. That is deliberate — an unlisted country must
 * still be enterable.
 */
export type AccountLabelKey = "accountNumber" | "iban";
export type BankCodeLabelKey =
  | "aba"
  | "sortCode"
  | "bsb"
  | "ifsc"
  | "transit"
  | "bankCode";

export type BankFieldConfig = {
  /**
   * Label KEYS, not display strings — @carbon/utils has no Lingui runtime, and
   * a hardcoded English label here would be untranslatable. The form maps these
   * to `t` messages.
   */
  accountLabel: AccountLabelKey;
  /** Routing identifier label key, or null when the country has none. */
  bankCodeLabel: BankCodeLabelKey | null;
  /** Validator for the account identifier; undefined = format check only. */
  validateAccount?: (value: string) => boolean;
  /** Validator for the routing identifier. */
  validateBankCode?: (value: string) => boolean;
  /** True when SWIFT/BIC is expected for cross-border payment. */
  requiresSwift?: boolean;
};

/** UK sort code: six digits, conventionally written 00-00-00. */
export function isValidSortCode(raw: string): boolean {
  return /^[0-9]{6}$/.test(raw.replace(/[\s-]/g, ""));
}

/** Australian BSB: six digits, conventionally written 000-000. */
export function isValidBsb(raw: string): boolean {
  return /^[0-9]{6}$/.test(raw.replace(/[\s-]/g, ""));
}

/** Indian IFSC: four letters, a zero, then six alphanumerics. */
export function isValidIfsc(raw: string): boolean {
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(raw.replace(/\s/g, "").toUpperCase());
}

/** Canadian routing: five-digit transit plus three-digit institution. */
export function isValidCanadianRouting(raw: string): boolean {
  return /^[0-9]{8}$/.test(raw.replace(/[\s-]/g, ""));
}

const IBAN_COUNTRY: BankFieldConfig = {
  accountLabel: "iban",
  bankCodeLabel: null,
  validateAccount: isValidIban,
  requiresSwift: true
};

const BANK_FIELDS: Record<string, BankFieldConfig> = {
  US: {
    accountLabel: "accountNumber",
    bankCodeLabel: "aba",
    validateBankCode: isValidAbaRouting
  },
  GB: {
    accountLabel: "accountNumber",
    bankCodeLabel: "sortCode",
    validateBankCode: isValidSortCode
  },
  AU: {
    accountLabel: "accountNumber",
    bankCodeLabel: "bsb",
    validateBankCode: isValidBsb
  },
  IN: {
    accountLabel: "accountNumber",
    bankCodeLabel: "ifsc",
    validateBankCode: isValidIfsc
  },
  CA: {
    accountLabel: "accountNumber",
    bankCodeLabel: "transit",
    validateBankCode: isValidCanadianRouting
  },
  // SEPA: the IBAN carries the bank identifier, so there is no separate code.
  AT: IBAN_COUNTRY,
  BE: IBAN_COUNTRY,
  DE: IBAN_COUNTRY,
  ES: IBAN_COUNTRY,
  FI: IBAN_COUNTRY,
  FR: IBAN_COUNTRY,
  IE: IBAN_COUNTRY,
  IT: IBAN_COUNTRY,
  NL: IBAN_COUNTRY,
  PL: IBAN_COUNTRY,
  PT: IBAN_COUNTRY,
  SE: IBAN_COUNTRY
};

export const DEFAULT_BANK_FIELDS: BankFieldConfig = {
  accountLabel: "accountNumber",
  bankCodeLabel: "bankCode",
  requiresSwift: true
};

export function getBankFieldConfig(
  countryCode: string | null | undefined
): BankFieldConfig {
  if (!countryCode) return DEFAULT_BANK_FIELDS;
  return BANK_FIELDS[countryCode.toUpperCase()] ?? DEFAULT_BANK_FIELDS;
}
