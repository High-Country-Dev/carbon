/**
 * Bank account identifier fields.
 *
 * A bank account is a name, a country, a currency and then some number of identifiers
 * whose names and shapes differ by country, by bank and sometimes by corridor. Carbon does
 * not model that variety in the schema. An account carries an ordered bag of
 * `{ key, label, value }` entries and this module is the seed catalog the form offers when
 * the user adds one — nothing here constrains what may be stored.
 *
 * The catalog exists to make the common case one click, not to close the set:
 *
 *   - `suggestBankFields` orders the catalog for a country. It never filters it. Every
 *     seeded field is always offerable, because a German supplier can hold a US account.
 *   - A key the catalog does not have is created by typing it. `customBankField` turns the
 *     typed label into a stable key.
 *   - `checkBankFieldValue` is advisory. A failing checksum renders a warning next to the
 *     input and never blocks a save — the user is looking at the bank's own paperwork and
 *     we are not.
 *
 * Labels live here rather than in the ERP form because they are data: the moment a user
 * picks a field, its label is written onto the row and they can rename it. They are
 * therefore not translated, in the same way a unit of measure name is not.
 */

export type BankFieldEntry = {
  /** Stable identifier. Seeded keys are the catalog's; custom keys are slugged labels. */
  key: string;
  /** What the user sees. Editable, and written onto the row. */
  label: string;
  value: string;
};

export type SeededBankField = {
  key: string;
  label: string;
  /** Countries that use this field, for ordering only. Omitted means "anywhere". */
  countries?: readonly string[];
  placeholder?: string;
};

// ---------------------------------------------------------------------------
// Checksums
// ---------------------------------------------------------------------------

/** Strip the separators banks print — "GB29 NWBK 6016", "12-34-56" — and uppercase. */
function compact(value: string): string {
  return value.replace(/[\s-]/g, "").toUpperCase();
}

/**
 * ISO 13616 IBAN check: move the first four characters to the end, map letters to
 * numbers (A=10 … Z=35), and require the result mod 97 to equal 1. Computed digit by
 * digit because the rearranged value overflows Number well before 34 characters.
 */
export function isValidIban(value: string): boolean {
  const iban = compact(value);
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
  const digits = compact(value);
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
// Catalog
// ---------------------------------------------------------------------------

/**
 * Countries addressed by IBAN. Used only to float the IBAN field to the top of the
 * suggestions for those countries.
 */
const IBAN_COUNTRIES = [
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
] as const;

/**
 * The identifiers Carbon offers out of the box.
 *
 * Three, and the bar for a fourth is high: a seeded field must apply either everywhere or
 * across at least three countries. Everything narrower — a US routing number, a UK sort
 * code, an Indian IFSC, a Chinese CNAPS code, a South African branch code — is typed by
 * the user, which is what the open bag is for. A suggestion list that is mostly fields
 * you do not need is a second form to read before filling in the first one.
 *
 * So the list is what is true almost everywhere: an account has a number, an IBAN if it
 * is held somewhere that issues them, and a BIC if anyone is paying it from abroad.
 *
 * `countries` is for ordering only, so IBAN floats to the top across the SEPA zone and
 * sinks below the universal pair everywhere else. Declaration order breaks ties.
 */
export const SEEDED_BANK_FIELDS: readonly SeededBankField[] = [
  {
    key: "accountNumber",
    label: "Account Number",
    placeholder: "000123456789"
  },
  {
    key: "iban",
    label: "IBAN",
    countries: IBAN_COUNTRIES,
    placeholder: "DE89 3704 0044 0532 0130 00"
  },
  {
    key: "swiftBic",
    label: "SWIFT / BIC",
    placeholder: "CHASUS33"
  }
];

/**
 * Advisory checks, keyed by canonical field key rather than hung off the catalog — so a
 * field the USER created still gets one when its name slugs to a key we can verify.
 * Typing "Routing Number" yields `routingNumber` (see `slugifyBankFieldKey`), and that
 * account number gets its ABA check digit verified exactly as if Carbon had seeded it.
 *
 * Only add an entry that is a real checksum. A format regex produces false warnings on
 * valid values, and this feature's whole posture is that we do not know better than the
 * bank's own paperwork.
 */
const FIELD_CHECKS: Record<string, (value: string) => boolean> = {
  iban: isValidIban,
  routingNumber: isValidAbaRoutingNumber
};

const SEEDED_BY_KEY = new Map(
  SEEDED_BANK_FIELDS.map((field) => [field.key, field])
);

export function getSeededBankField(
  key: string | null | undefined
): SeededBankField | undefined {
  return key ? SEEDED_BY_KEY.get(key) : undefined;
}

/**
 * The catalog ordered for a country: that country's fields first, then the ones that apply
 * anywhere, then everything else. Nothing is removed — a field belonging to another
 * country is still selectable, it just sits further down.
 */
export function suggestBankFields(
  countryCode: string | null | undefined
): SeededBankField[] {
  const code = countryCode?.toUpperCase();

  const rank = (field: SeededBankField) => {
    if (!field.countries) return 1; // applies anywhere
    if (code && field.countries.includes(code)) return 0;
    return 2;
  };

  // Index is the tie-break, so declaration order survives within a rank.
  return SEEDED_BANK_FIELDS.map((field, index) => ({ field, index }))
    .sort((a, b) => rank(a.field) - rank(b.field) || a.index - b.index)
    .map(({ field }) => field);
}

// ---------------------------------------------------------------------------
// Custom keys
// ---------------------------------------------------------------------------

/**
 * Turn a typed label into a stable key: "Agência / Conta" → "agenciaConta". Falls back to
 * a hash-free positional key when the label has no usable characters at all (e.g. a label
 * written entirely in a script this strips), so a row is never keyless.
 */
export function slugifyBankFieldKey(label: string): string {
  const words = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

  if (words.length === 0) return "";

  return words
    .map((word, index) =>
      index === 0
        ? word.toLowerCase()
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    )
    .join("");
}

/** A catalog-shaped entry for a label the catalog does not have. */
export function customBankField(label: string): SeededBankField {
  const trimmed = label.trim();
  return { key: slugifyBankFieldKey(trimmed) || "field", label: trimmed };
}

// ---------------------------------------------------------------------------
// Parsing, serializing, display
// ---------------------------------------------------------------------------

/**
 * Read a `fields` bag off a row, or a JSON string off a form, into entries. Tolerant by
 * design: the column is free-form JSONB and a malformed bag must degrade to "no fields
 * recorded" rather than break the page it is rendered on.
 */
export function parseBankFields(value: unknown): BankFieldEntry[] {
  let raw = value;

  if (typeof raw === "string") {
    if (!raw.trim()) return [];
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(raw)) return [];

  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const { key, label, value: fieldValue } = item as Record<string, unknown>;
    if (typeof key !== "string" || !key) return [];
    return [
      {
        key,
        label: typeof label === "string" && label ? label : key,
        value: typeof fieldValue === "string" ? fieldValue : ""
      }
    ];
  });
}

/**
 * Clean a bag for storage: trim, drop entries with no value, and make keys unique.
 *
 * Duplicate keys are suffixed rather than dropped. A user who records two branch codes has
 * a reason, and silently discarding the second would lose data they entered by hand.
 */
export function serializeBankFields(
  entries: readonly BankFieldEntry[]
): BankFieldEntry[] {
  const seen = new Set<string>();
  const result: BankFieldEntry[] = [];

  for (const entry of entries) {
    const value = entry.value?.trim() ?? "";
    if (!value) continue;

    const label = entry.label?.trim() || entry.key;
    const baseKey = entry.key?.trim() || slugifyBankFieldKey(label) || "field";

    let key = baseKey;
    let suffix = 2;
    while (seen.has(key)) key = `${baseKey}${suffix++}`;
    seen.add(key);

    result.push({ key, label, value });
  }

  return result;
}

/** `true` when the value fails its field's checksum. Advisory — never blocks a save. */
export function hasBankFieldWarning(key: string, value: string): boolean {
  const check = FIELD_CHECKS[key];
  if (!check || !value.trim()) return false;
  return !check(value);
}

/**
 * Priority when summarizing an account in one line — the entries that identify the
 * ACCOUNT, not the bank routing to it. Keys outside this list fall back to bag order, so a
 * custom-only account still shows something.
 */
const DISPLAY_PRIORITY = ["iban", "accountNumber", "swiftBic"];

/** The entry that best identifies an account, for a list row. */
export function primaryBankField(
  entries: readonly BankFieldEntry[]
): BankFieldEntry | undefined {
  for (const key of DISPLAY_PRIORITY) {
    const match = entries.find((entry) => entry.key === key && entry.value);
    if (match) return match;
  }
  return entries.find((entry) => entry.value);
}

/** Last four characters of an identifier, for a compact list row. */
export function lastFour(value: string | null | undefined): string | null {
  const normalized = compact(value ?? "");
  if (normalized.length < 4) return null;
  return normalized.slice(-4);
}

/**
 * One-line summary of an account's identifiers: the primary field abbreviated to its last
 * four, e.g. "IBAN •••• 1300". Undefined when the account records nothing yet.
 */
export function summarizeBankFields(
  entries: readonly BankFieldEntry[]
): string | undefined {
  const primary = primaryBankField(entries);
  if (!primary) return undefined;

  const tail = lastFour(primary.value);
  return tail
    ? `${primary.label} •••• ${tail}`
    : `${primary.label} ${primary.value}`;
}
