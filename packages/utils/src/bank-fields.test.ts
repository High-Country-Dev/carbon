import { describe, expect, it } from "vitest";
import {
  customBankField,
  getSeededBankField,
  hasBankFieldWarning,
  isValidAbaRoutingNumber,
  isValidIban,
  lastFour,
  parseBankFields,
  primaryBankField,
  SEEDED_BANK_FIELDS,
  serializeBankFields,
  slugifyBankFieldKey,
  suggestBankFields,
  summarizeBankFields
} from "./bank-fields";

describe("isValidIban", () => {
  it("accepts real IBANs regardless of spacing or case", () => {
    expect(isValidIban("DE89370400440532013000")).toBe(true);
    expect(isValidIban("de89 3704 0044 0532 0130 00")).toBe(true);
    expect(isValidIban("GB29 NWBK 6016 1331 9268 19")).toBe(true);
    // 34 characters — long enough to overflow Number if computed in one go.
    expect(isValidIban("MT84MALT011000012345MTLCAST001S")).toBe(true);
  });

  it("rejects a transposed digit, a bad country code and a short value", () => {
    expect(isValidIban("DE89370400440532013001")).toBe(false);
    expect(isValidIban("1289370400440532013000")).toBe(false);
    expect(isValidIban("DE89")).toBe(false);
    expect(isValidIban("")).toBe(false);
  });
});

describe("isValidAbaRoutingNumber", () => {
  it("accepts valid routing numbers", () => {
    expect(isValidAbaRoutingNumber("021000021")).toBe(true);
    expect(isValidAbaRoutingNumber("011401533")).toBe(true);
    expect(isValidAbaRoutingNumber("021-000-021")).toBe(true);
  });

  it("rejects a bad check digit and a wrong length", () => {
    expect(isValidAbaRoutingNumber("021000022")).toBe(false);
    expect(isValidAbaRoutingNumber("02100002")).toBe(false);
    expect(isValidAbaRoutingNumber("000000000")).toBe(false); // sum 0, not a routing number
  });
});

describe("suggestBankFields", () => {
  it("floats a country's own field to the top without removing any", () => {
    const de = suggestBankFields("DE");
    expect(de[0]!.key).toBe("iban");
    expect(de).toHaveLength(SEEDED_BANK_FIELDS.length);
    // An IBAN is not a US field, but a US-held account can still record one.
    expect(suggestBankFields("US").some((f) => f.key === "iban")).toBe(true);
  });

  it("puts IBAN first for an IBAN country", () => {
    expect(suggestBankFields("DE")[0]!.key).toBe("iban");
    expect(suggestBankFields("de")[0]!.key).toBe("iban");
  });

  it("leads with the universal fields for an unknown or missing country", () => {
    for (const code of [undefined, null, "", "ZZ"]) {
      const suggested = suggestBankFields(code);
      expect(suggested[0]!.key).toBe("accountNumber");
      expect(suggested).toHaveLength(SEEDED_BANK_FIELDS.length);
    }
  });

  it("keeps a country-specific field ahead of universal ones", () => {
    const gb = suggestBankFields("GB");
    expect(gb.findIndex((f) => f.key === "iban")).toBeLessThan(
      gb.findIndex((f) => f.key === "swiftBic")
    );
  });
});

/**
 * The catalog is three fields. What it must still do is float IBAN for the countries that
 * use one, keep everything offerable everywhere, and stay honest that the country-specific
 * identifiers are the user's to name.
 */
describe("coverage", () => {
  it.each([
    ["DE", ["iban", "accountNumber", "swiftBic"]],
    ["FR", ["iban", "accountNumber", "swiftBic"]],
    ["PT", ["iban", "accountNumber", "swiftBic"]],
    ["GB", ["iban", "accountNumber", "swiftBic"]]
  ])("floats IBAN to the top for %s", (country, expected) => {
    expect(suggestBankFields(country).map((f) => f.key)).toEqual(expected);
  });

  it.each([
    ["US"],
    ["ZA"],
    ["IN"],
    ["CN"]
  ])("leads with the universal pair for %s, IBAN last", (country) => {
    expect(suggestBankFields(country).map((f) => f.key)).toEqual([
      "accountNumber",
      "swiftBic",
      "iban"
    ]);
  });

  it("offers every seeded field for every country", () => {
    // A supplier abroad can bank anywhere, so nothing is ever filtered out.
    for (const country of ["US", "GB", "DE", "ZA", "IN", "CN", "ZZ"]) {
      expect(suggestBankFields(country)).toHaveLength(
        SEEDED_BANK_FIELDS.length
      );
    }
  });

  it("seeds only fields that are universal or span at least three countries", () => {
    // The bar for a fourth seeded field. A one- or two-country identifier is typed.
    for (const field of SEEDED_BANK_FIELDS) {
      if (!field.countries) continue;
      expect(field.countries.length).toBeGreaterThanOrEqual(3);
    }
  });
});

/**
 * The country-specific identifiers are no longer seeded, so the typed path IS the
 * supported path for the US, the UK, South Africa, India and China. It has to produce a
 * stable key and keep whatever verification we can honestly offer.
 */
describe("user-created fields for the unseeded rails", () => {
  it.each([
    ["Routing Number", "routingNumber"],
    ["Account Type", "accountType"],
    ["Sort Code", "sortCode"],
    ["Branch Code", "branchCode"],
    ["IFSC Code", "ifscCode"],
    ["CNAPS Code", "cnapsCode"]
  ])("turns %s into a stable key", (label, key) => {
    const field = customBankField(label);
    expect(field.key).toBe(key);
    expect(field.label).toBe(label);
  });

  it("still verifies a typed routing number's check digit", () => {
    // The ABA checksum is keyed on the canonical key, not on catalog membership, so a
    // field the user named themselves is checked exactly as a seeded one would be.
    const field = customBankField("Routing Number");
    expect(hasBankFieldWarning(field.key, "021000022")).toBe(true);
    expect(hasBankFieldWarning(field.key, "021000021")).toBe(false);
  });

  it("leaves a typed field with no checksum alone", () => {
    const field = customBankField("Branch Code");
    expect(hasBankFieldWarning(field.key, "632005")).toBe(false);
    expect(hasBankFieldWarning(field.key, "anything at all")).toBe(false);
  });
});

describe("slugifyBankFieldKey / customBankField", () => {
  it("camel-cases an arbitrary label", () => {
    expect(slugifyBankFieldKey("Agência / Conta")).toBe("agenciaConta");
    expect(slugifyBankFieldKey("Bank branch  code")).toBe("bankBranchCode");
    expect(slugifyBankFieldKey("IFSC")).toBe("ifsc");
  });

  it("never produces a keyless field", () => {
    expect(customBankField("  ").key).toBe("field");
    expect(customBankField("日本").key).toBe("field");
    expect(customBankField("Correspondent Bank").key).toBe("correspondentBank");
  });

  it("keeps the label the user typed", () => {
    expect(customBankField("  Agência / Conta ").label).toBe("Agência / Conta");
  });
});

describe("parseBankFields", () => {
  it("reads an array, a JSON string, and nothing", () => {
    const entries = [{ key: "iban", label: "IBAN", value: "DE89" }];
    expect(parseBankFields(entries)).toEqual(entries);
    expect(parseBankFields(JSON.stringify(entries))).toEqual(entries);
    expect(parseBankFields(null)).toEqual([]);
    expect(parseBankFields(undefined)).toEqual([]);
    expect(parseBankFields("")).toEqual([]);
    expect(parseBankFields("[]")).toEqual([]);
  });

  it("degrades to empty rather than throwing on a malformed bag", () => {
    // The column is free-form JSONB, so every one of these is reachable.
    expect(parseBankFields("not json")).toEqual([]);
    expect(parseBankFields({ iban: "DE89" })).toEqual([]);
    expect(parseBankFields(42)).toEqual([]);
    expect(parseBankFields([null, 7, "x"])).toEqual([]);
  });

  it("drops entries with no key and defaults a missing label", () => {
    expect(
      parseBankFields([
        { key: "", label: "IBAN", value: "DE89" },
        { key: "swiftBic", value: "CHASUS33" },
        { key: "bankCode", label: "Bank Code" }
      ])
    ).toEqual([
      { key: "swiftBic", label: "swiftBic", value: "CHASUS33" },
      { key: "bankCode", label: "Bank Code", value: "" }
    ]);
  });
});

describe("serializeBankFields", () => {
  it("trims, and drops entries the user left blank", () => {
    expect(
      serializeBankFields([
        { key: "iban", label: " IBAN ", value: "  DE89  " },
        { key: "swiftBic", label: "SWIFT / BIC", value: "   " },
        { key: "bankCode", label: "Bank Code", value: "" }
      ])
    ).toEqual([{ key: "iban", label: "IBAN", value: "DE89" }]);
  });

  it("suffixes a duplicate key rather than discarding the row", () => {
    expect(
      serializeBankFields([
        { key: "branchCode", label: "Branch Code", value: "001" },
        { key: "branchCode", label: "Branch Code", value: "002" },
        { key: "branchCode", label: "Branch Code", value: "003" }
      ])
    ).toEqual([
      { key: "branchCode", label: "Branch Code", value: "001" },
      { key: "branchCode2", label: "Branch Code", value: "002" },
      { key: "branchCode3", label: "Branch Code", value: "003" }
    ]);
  });

  it("derives a key from the label when the row has none", () => {
    expect(
      serializeBankFields([
        { key: "", label: "Correspondent Bank", value: "DEUTDEFF" }
      ])
    ).toEqual([
      {
        key: "correspondentBank",
        label: "Correspondent Bank",
        value: "DEUTDEFF"
      }
    ]);
  });

  it("round-trips through parse", () => {
    const stored = serializeBankFields([
      { key: "iban", label: "IBAN", value: "DE89370400440532013000" },
      { key: "swiftBic", label: "SWIFT / BIC", value: "COBADEFF" }
    ]);
    expect(parseBankFields(JSON.stringify(stored))).toEqual(stored);
  });
});

describe("hasBankFieldWarning", () => {
  it("warns only on a seeded field whose checksum fails", () => {
    expect(hasBankFieldWarning("iban", "DE89370400440532013001")).toBe(true);
    expect(hasBankFieldWarning("iban", "DE89370400440532013000")).toBe(false);
    expect(hasBankFieldWarning("routingNumber", "021000022")).toBe(true);
    expect(hasBankFieldWarning("routingNumber", "021000021")).toBe(false);
  });

  it("never warns on an empty value, an unchecked field or a custom key", () => {
    expect(hasBankFieldWarning("iban", "")).toBe(false);
    expect(hasBankFieldWarning("iban", "   ")).toBe(false);
    expect(hasBankFieldWarning("swiftBic", "nonsense")).toBe(false);
    expect(hasBankFieldWarning("agenciaConta", "nonsense")).toBe(false);
  });
});

describe("display helpers", () => {
  it("takes the last four of an identifier, ignoring separators", () => {
    expect(lastFour("DE89 3704 0044 0532 0130 00")).toBe("3000");
    expect(lastFour("12-34-56")).toBe("3456");
    expect(lastFour("123")).toBeNull();
    expect(lastFour(null)).toBeNull();
  });

  it("prefers the IBAN, then the account number, then whatever is present", () => {
    const iban = { key: "iban", label: "IBAN", value: "DE89" };
    const account = {
      key: "accountNumber",
      label: "Account",
      value: "12345678"
    };
    const custom = { key: "agenciaConta", label: "Agência", value: "0001-9" };

    expect(primaryBankField([account, iban])).toBe(iban);
    expect(primaryBankField([custom, account])).toBe(account);
    expect(primaryBankField([custom])).toBe(custom);
    expect(primaryBankField([])).toBeUndefined();
  });

  it("summarizes an account in one line", () => {
    expect(
      summarizeBankFields([
        { key: "swiftBic", label: "SWIFT / BIC", value: "COBADEFF" },
        { key: "iban", label: "IBAN", value: "DE89 3704 0044 0532 0130 00" }
      ])
    ).toBe("IBAN •••• 3000");

    // Too short to abbreviate — showing it whole beats showing nothing.
    expect(
      summarizeBankFields([
        { key: "bankCode", label: "Bank Code", value: "42" }
      ])
    ).toBe("Bank Code 42");

    expect(summarizeBankFields([])).toBeUndefined();
  });
});

describe("catalog integrity", () => {
  it("has unique keys, and every key resolves", () => {
    const keys = SEEDED_BANK_FIELDS.map((field) => field.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(getSeededBankField(key)?.key).toBe(key);
    }
    expect(getSeededBankField("nope")).toBeUndefined();
    expect(getSeededBankField(undefined)).toBeUndefined();
  });

  it("labels every field and uses uppercase ISO country codes", () => {
    for (const field of SEEDED_BANK_FIELDS) {
      expect(field.label.trim()).not.toBe("");
      for (const country of field.countries ?? []) {
        expect(country).toMatch(/^[A-Z]{2}$/);
      }
    }
  });
});
