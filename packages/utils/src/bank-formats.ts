/**
 * Bank account formats by country.
 *
 * The fields a bank account needs are a function of the account's country, not of the
 * party that owns it — a German supplier can hold a USD account in the US. This module is
 * the single declaration of which fields each country uses, how to validate them, and
 * where each one is stored. It drives three consumers that must never disagree: the zod
 * validator, the conditional form renderer, and the persistence mapping.
 *
 * Supporting a new country is an entry in `BANK_ACCOUNT_FORMATS` plus a test. It is never
 * a migration, because the storage target is part of the field spec rather than part of
 * the schema:
 *
 *   - `swiftBic`      → the `swiftBic` column
 *   - `routingNumber` → the `routingNumber` column, which holds the primary DOMESTIC
 *                       clearing code whatever the country calls it (ABA routing number,
 *                       sort code, BSB, branch transit, generic bank code). At most one
 *                       field per format targets it.
 *   - `secret`        → the Vault secret bag, with only a last-four kept on the row
 *   - `identifier`    → the `bankIdentifiers` JSONB bag, for secondary parts that would
 *                       otherwise each earn a column
 *
 * Labels and placeholders deliberately live in the ERP form component, not here, so they
 * go through Lingui extraction. This module stays pure and translation-free.
 */

export type BankFieldKey =
  | "iban"
  | "swiftBic"
  | "accountNumber"
  | "accountType"
  | "routingNumber"
  | "sortCode"
  | "bsb"
  | "institutionNumber"
  | "transitNumber"
  | "bankCode";

/** Where a field's value ends up once the row is written. */
export type BankFieldStorage =
  | { kind: "column"; column: "swiftBic" | "routingNumber" }
  | { kind: "secret"; secret: "accountNumber" | "iban" }
  | { kind: "identifier" };

export type BankFieldSpec = {
  key: BankFieldKey;
  required: boolean;
  storage: BankFieldStorage;
  /** Structural check applied after normalization. */
  pattern?: RegExp;
  /** Extra check that a pattern cannot express (checksums). */
  checksum?: (value: string) => boolean;
  /** Fixed set of accepted values; renders as a select rather than a text input. */
  options?: readonly string[];
};

export type BankAccountFormat = {
  id: string;
  fields: readonly BankFieldSpec[];
};

// ---------------------------------------------------------------------------
// Checksums
// ---------------------------------------------------------------------------

/**
 * ISO 13616 IBAN check: move the first four characters to the end, map letters to
 * numbers (A=10 … Z=35), and require the result mod 97 to equal 1. Computed digit by
 * digit because the rearranged value overflows Number well before 34 characters.
 */
export function isValidIban(value: string): boolean {
  const iban = normalizeBankFieldValue("iban", value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;

  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const mapped =
      char >= "A" && char <= "Z" ? (char.charCodeAt(0) - 55).toString() : char;
    for (const digit of mapped) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

/**
 * ABA routing transit number check digit: 3·(d1+d4+d7) + 7·(d2+d5+d8) + (d3+d6+d9)
 * must be a non-zero multiple of ten.
 */
export function isValidAbaRoutingNumber(value: string): boolean {
  const digits = normalizeBankFieldValue("routingNumber", value);
  if (!/^\d{9}$/.test(digits)) return false;

  const weights = [3, 7, 1, 3, 7, 1, 3, 7, 1];
  const sum = digits
    .split("")
    .reduce(
      (total, digit, index) => total + Number(digit) * weights[index]!,
      0
    );
  return sum > 0 && sum % 10 === 0;
}

// ---------------------------------------------------------------------------
// Field specs
// ---------------------------------------------------------------------------

const SWIFT_BIC: BankFieldSpec = {
  key: "swiftBic",
  required: false,
  storage: { kind: "column", column: "swiftBic" },
  // 8 or 11 characters: bank(4) country(2) location(2) branch(3, optional).
  pattern: /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/
};

const IBAN_REQUIRED: BankFieldSpec = {
  key: "iban",
  required: true,
  storage: { kind: "secret", secret: "iban" },
  checksum: isValidIban
};

const IBAN_OPTIONAL: BankFieldSpec = { ...IBAN_REQUIRED, required: false };

const ACCOUNT_NUMBER: BankFieldSpec = {
  key: "accountNumber",
  required: true,
  storage: { kind: "secret", secret: "accountNumber" },
  pattern: /^[A-Z0-9]{4,34}$/
};

/** Depository account types the US ACH network distinguishes. */
export const US_ACCOUNT_TYPES = ["Checking", "Savings"] as const;

// ---------------------------------------------------------------------------
// Formats
// ---------------------------------------------------------------------------

export const BANK_ACCOUNT_FORMATS = {
  "us-aba": {
    id: "us-aba",
    fields: [
      {
        key: "routingNumber",
        required: true,
        storage: { kind: "column", column: "routingNumber" },
        pattern: /^\d{9}$/,
        checksum: isValidAbaRoutingNumber
      },
      { ...ACCOUNT_NUMBER, pattern: /^\d{4,17}$/ },
      {
        key: "accountType",
        required: true,
        storage: { kind: "identifier" },
        options: US_ACCOUNT_TYPES
      },
      SWIFT_BIC
    ]
  },

  "gb-sort": {
    id: "gb-sort",
    fields: [
      {
        key: "sortCode",
        required: true,
        storage: { kind: "column", column: "routingNumber" },
        pattern: /^\d{6}$/
      },
      { ...ACCOUNT_NUMBER, pattern: /^\d{8}$/ },
      IBAN_OPTIONAL,
      SWIFT_BIC
    ]
  },

  // Canadian EFT quotes two numbers on a void cheque. The branch transit is the primary
  // clearing code and takes the column; the institution identifies the bank and rides in
  // the identifier bag. A consumer composing a 9-digit EFT routing number reads both.
  "ca-eft": {
    id: "ca-eft",
    fields: [
      {
        key: "transitNumber",
        required: true,
        storage: { kind: "column", column: "routingNumber" },
        pattern: /^\d{5}$/
      },
      {
        key: "institutionNumber",
        required: true,
        storage: { kind: "identifier" },
        pattern: /^\d{3}$/
      },
      { ...ACCOUNT_NUMBER, pattern: /^\d{7,12}$/ },
      SWIFT_BIC
    ]
  },

  "au-bsb": {
    id: "au-bsb",
    fields: [
      {
        key: "bsb",
        required: true,
        storage: { kind: "column", column: "routingNumber" },
        pattern: /^\d{6}$/
      },
      { ...ACCOUNT_NUMBER, pattern: /^\d{5,10}$/ },
      SWIFT_BIC
    ]
  },

  iban: {
    id: "iban",
    fields: [IBAN_REQUIRED, SWIFT_BIC]
  },

  // Anywhere without a dedicated format. Nothing is unusable; the account number and an
  // optional bank code plus SWIFT/BIC carry an international payment.
  generic: {
    id: "generic",
    fields: [
      ACCOUNT_NUMBER,
      {
        key: "bankCode",
        required: false,
        storage: { kind: "column", column: "routingNumber" },
        pattern: /^[A-Z0-9]{1,20}$/
      },
      SWIFT_BIC
    ]
  }
} as const satisfies Record<string, BankAccountFormat>;

export type BankFormatId = keyof typeof BANK_ACCOUNT_FORMATS;

/**
 * Countries whose accounts are addressed by IBAN. Several also have a domestic clearing
 * code; where the domestic form is what people actually quote (GB), an explicit override
 * below wins over this set.
 */
const IBAN_COUNTRIES = new Set([
  "AD",
  "AE",
  "AL",
  "AT",
  "AZ",
  "BA",
  "BE",
  "BG",
  "BH",
  "BR",
  "BY",
  "CH",
  "CR",
  "CY",
  "CZ",
  "DE",
  "DK",
  "DO",
  "EE",
  "EG",
  "ES",
  "FI",
  "FO",
  "FR",
  "GB",
  "GE",
  "GI",
  "GL",
  "GR",
  "GT",
  "HR",
  "HU",
  "IE",
  "IL",
  "IQ",
  "IS",
  "IT",
  "JO",
  "KW",
  "KZ",
  "LB",
  "LC",
  "LI",
  "LT",
  "LU",
  "LV",
  "LY",
  "MC",
  "MD",
  "ME",
  "MK",
  "MR",
  "MT",
  "MU",
  "NL",
  "NO",
  "PK",
  "PL",
  "PS",
  "PT",
  "QA",
  "RO",
  "RS",
  "RU",
  "SA",
  "SC",
  "SD",
  "SE",
  "SI",
  "SK",
  "SM",
  "ST",
  "SV",
  "TL",
  "TN",
  "TR",
  "UA",
  "VA",
  "VG",
  "XK"
]);

/** Countries whose domestic form beats their IBAN form, or that have no IBAN at all. */
const COUNTRY_FORMAT_OVERRIDES: Record<string, BankFormatId> = {
  US: "us-aba",
  GB: "gb-sort",
  CA: "ca-eft",
  AU: "au-bsb"
};

/**
 * Explicit override → IBAN country → generic. Never throws: an unknown or missing country
 * resolves to `generic` so no account is unrecordable.
 */
export function resolveBankFormat(
  countryCode: string | null | undefined
): BankAccountFormat {
  const code = countryCode?.toUpperCase();
  if (!code) return BANK_ACCOUNT_FORMATS.generic;

  const override = COUNTRY_FORMAT_OVERRIDES[code];
  if (override) return BANK_ACCOUNT_FORMATS[override];
  if (IBAN_COUNTRIES.has(code)) return BANK_ACCOUNT_FORMATS.iban;
  return BANK_ACCOUNT_FORMATS.generic;
}

export function getBankFormatById(
  formatId: string | null | undefined
): BankAccountFormat {
  if (!formatId) return BANK_ACCOUNT_FORMATS.generic;
  return (
    BANK_ACCOUNT_FORMATS[formatId as BankFormatId] ??
    BANK_ACCOUNT_FORMATS.generic
  );
}

/** The field keys a country's format uses, in render order. */
export function getBankFieldKeys(
  countryCode: string | null | undefined
): BankFieldKey[] {
  return resolveBankFormat(countryCode).fields.map((field) => field.key);
}

// ---------------------------------------------------------------------------
// Normalization, validation, storage
// ---------------------------------------------------------------------------

export type BankFieldValues = Partial<Record<BankFieldKey, string | undefined>>;

/**
 * Every key this module recognises. Callers hand in whole form objects, which also carry
 * ids, names and booleans — anything not listed here is ignored rather than coerced.
 */
export const BANK_FIELD_KEYS: readonly BankFieldKey[] = [
  "iban",
  "swiftBic",
  "accountNumber",
  "accountType",
  "routingNumber",
  "sortCode",
  "bsb",
  "institutionNumber",
  "transitNumber",
  "bankCode"
];

/**
 * People paste identifiers with the separators their bank prints — "GB29 NWBK 6016",
 * "12-34-56". Strip whitespace and hyphens, and uppercase everything except the free-form
 * account type. Validation and storage both operate on the normalized value.
 */
export function normalizeBankFieldValue(
  key: BankFieldKey,
  value: unknown
): string {
  // Callers pass raw form values, which can be a boolean, a number or a File.
  if (typeof value !== "string" || !value) return "";
  if (key === "accountType") return value.trim();
  return value.replace(/[\s-]/g, "").toUpperCase();
}

/**
 * Pull the bank fields out of an arbitrary object and normalize them. Takes `unknown`
 * values because the caller is usually a whole validated form, whose other keys are ids,
 * names and booleans that must be left alone.
 */
export function normalizeBankFields(
  values: Record<string, unknown>
): BankFieldValues {
  const normalized: BankFieldValues = {};
  for (const key of BANK_FIELD_KEYS) {
    const normalizedValue = normalizeBankFieldValue(key, values[key]);
    if (normalizedValue) normalized[key] = normalizedValue;
  }
  return normalized;
}

export type BankFieldIssue = {
  field: BankFieldKey;
  code: "required" | "invalid";
};

/**
 * Validate the values for a country against its format. Fields the format does not use
 * are ignored rather than rejected — the form clears them on a country switch, and a
 * leftover value from a stale payload is not the user's problem to fix twice.
 */
export function validateBankFields(
  countryCode: string | null | undefined,
  values: Record<string, unknown>
): BankFieldIssue[] {
  const format = resolveBankFormat(countryCode);
  const normalized = normalizeBankFields(values);
  const issues: BankFieldIssue[] = [];

  for (const field of format.fields) {
    const value = normalized[field.key];

    if (!value) {
      if (field.required) issues.push({ field: field.key, code: "required" });
      continue;
    }
    if (field.options && !field.options.includes(value)) {
      issues.push({ field: field.key, code: "invalid" });
      continue;
    }
    if (field.pattern && !field.pattern.test(value)) {
      issues.push({ field: field.key, code: "invalid" });
      continue;
    }
    if (field.checksum && !field.checksum(value)) {
      issues.push({ field: field.key, code: "invalid" });
    }
  }

  return issues;
}

/** Last four characters of an identifier, for display in place of the value. */
export function lastFour(value: string | null | undefined): string | null {
  const normalized = (value ?? "").replace(/[\s-]/g, "");
  if (normalized.length < 4) return null;
  return normalized.slice(-4);
}

export type BankFieldStorageResult = {
  /** Written to real columns on the row. */
  columns: { swiftBic: string | null; routingNumber: string | null };
  /** Written to the `bankIdentifiers` JSONB column. */
  bankIdentifiers: Record<string, string>;
  /** Written to the Vault secret bag; never to a column and never returned to a client. */
  secrets: { accountNumber?: string; iban?: string };
  /** Written to the row for display in place of the secrets. */
  lastFour: { accountNumber: string | null; iban: string | null };
  formatId: string;
};

/**
 * Split a country's field values into the four places they are persisted. Only fields the
 * format declares are carried through, so switching country cannot smuggle a stale
 * identifier onto the row.
 */
export function splitBankFieldsForStorage(
  countryCode: string | null | undefined,
  values: Record<string, unknown>
): BankFieldStorageResult {
  const format = resolveBankFormat(countryCode);
  const normalized = normalizeBankFields(values);

  const result: BankFieldStorageResult = {
    columns: { swiftBic: null, routingNumber: null },
    bankIdentifiers: {},
    secrets: {},
    lastFour: { accountNumber: null, iban: null },
    formatId: format.id
  };

  for (const field of format.fields) {
    const value = normalized[field.key];
    if (!value) continue;

    switch (field.storage.kind) {
      case "column":
        result.columns[field.storage.column] = value;
        break;
      case "secret":
        result.secrets[field.storage.secret] = value;
        result.lastFour[field.storage.secret] = lastFour(value);
        break;
      case "identifier":
        result.bankIdentifiers[field.key] = value;
        break;
    }
  }

  return result;
}

/**
 * The inverse of `splitBankFieldsForStorage`, for populating an edit form from a row.
 *
 * Reads the format the row was written with rather than re-deriving it from the country,
 * so a row keeps rendering the fields it was captured under even if the registry later
 * changes what that country uses. Secrets are absent by construction — they live in the
 * vault, and the form shows their last four instead.
 */
export function bankFieldValuesFromStorage(row: {
  formatId?: string | null;
  countryCode?: string | null;
  swiftBic?: string | null;
  routingNumber?: string | null;
  bankIdentifiers?: Record<string, unknown> | null;
}): BankFieldValues {
  const format = row.formatId
    ? getBankFormatById(row.formatId)
    : resolveBankFormat(row.countryCode);

  const values: BankFieldValues = {};

  for (const field of format.fields) {
    switch (field.storage.kind) {
      case "column": {
        const value = row[field.storage.column];
        if (value) values[field.key] = value;
        break;
      }
      case "identifier": {
        const value = row.bankIdentifiers?.[field.key];
        if (typeof value === "string" && value) values[field.key] = value;
        break;
      }
      case "secret":
        // Never present on the row.
        break;
    }
  }

  return values;
}
