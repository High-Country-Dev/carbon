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
  it("floats the country's own fields to the top without removing any", () => {
    const us = suggestBankFields("US");
    expect(us[0]!.key).toBe("routingNumber");
    expect(us).toHaveLength(SEEDED_BANK_FIELDS.length);
    // An IBAN is not a US field, but a US-held account can still record one.
    expect(us.some((field) => field.key === "iban")).toBe(true);
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

  it("keeps country-specific fields ahead of universal ones", () => {
    const gb = suggestBankFields("GB");
    const sortCode = gb.findIndex((field) => field.key === "sortCode");
    const swift = gb.findIndex((field) => field.key === "swiftBic");
    expect(sortCode).toBeLessThan(swift);
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
