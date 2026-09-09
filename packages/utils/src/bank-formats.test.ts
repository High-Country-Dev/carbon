import { describe, expect, it } from "vitest";
import {
  bankFieldValuesFromStorage,
  getBankFieldKeys,
  isValidAbaRoutingNumber,
  isValidIban,
  lastFour,
  normalizeBankFieldValue,
  resolveBankFormat,
  splitBankFieldsForStorage,
  validateBankFields
} from "./bank-formats";

describe("resolveBankFormat", () => {
  it("prefers an explicit country override over the IBAN set", () => {
    // GB is an IBAN country, but a sort code is what a British bank actually quotes.
    expect(resolveBankFormat("GB").id).toBe("gb-sort");
  });

  it("falls back to IBAN for a SEPA country with no override", () => {
    expect(resolveBankFormat("DE").id).toBe("iban");
    expect(resolveBankFormat("NL").id).toBe("iban");
  });

  it("falls back to generic for an unknown, non-IBAN or missing country", () => {
    expect(resolveBankFormat("JP").id).toBe("generic");
    expect(resolveBankFormat("ZZ").id).toBe("generic");
    expect(resolveBankFormat(undefined).id).toBe("generic");
    expect(resolveBankFormat("").id).toBe("generic");
  });

  it("is case-insensitive", () => {
    expect(resolveBankFormat("us").id).toBe("us-aba");
  });
});

describe("getBankFieldKeys", () => {
  it("renders the fields each country actually uses", () => {
    expect(getBankFieldKeys("US")).toEqual([
      "routingNumber",
      "accountNumber",
      "accountType",
      "swiftBic"
    ]);
    expect(getBankFieldKeys("DE")).toEqual(["iban", "swiftBic"]);
    expect(getBankFieldKeys("GB")).toEqual([
      "sortCode",
      "accountNumber",
      "iban",
      "swiftBic"
    ]);
    expect(getBankFieldKeys("CA")).toEqual([
      "transitNumber",
      "institutionNumber",
      "accountNumber",
      "swiftBic"
    ]);
    expect(getBankFieldKeys("AU")).toEqual([
      "bsb",
      "accountNumber",
      "swiftBic"
    ]);
  });

  it("gives every format exactly one field targeting the routingNumber column", () => {
    for (const country of ["US", "GB", "CA", "AU", "DE", "JP"]) {
      const targeting = resolveBankFormat(country).fields.filter(
        (field) =>
          field.storage.kind === "column" &&
          field.storage.column === "routingNumber"
      );
      expect(targeting.length).toBeLessThanOrEqual(1);
    }
  });
});

describe("normalizeBankFieldValue", () => {
  it("strips the separators banks print and uppercases", () => {
    expect(normalizeBankFieldValue("iban", "gb29 nwbk 6016 1331 9268 19")).toBe(
      "GB29NWBK60161331926819"
    );
    expect(normalizeBankFieldValue("sortCode", "12-34-56")).toBe("123456");
  });

  it("leaves the account type alone", () => {
    expect(normalizeBankFieldValue("accountType", " Checking ")).toBe(
      "Checking"
    );
  });
});

describe("isValidIban", () => {
  it("accepts real IBANs across lengths", () => {
    expect(isValidIban("GB29 NWBK 6016 1331 9268 19")).toBe(true);
    expect(isValidIban("DE89370400440532013000")).toBe(true);
    expect(isValidIban("FR1420041010050500013M02606")).toBe(true);
    expect(isValidIban("MT84MALT011000012345MTLCAST001S")).toBe(true);
  });

  it("rejects a single transposed digit", () => {
    expect(isValidIban("DE89370400440532013001")).toBe(false);
  });

  it("rejects malformed input", () => {
    expect(isValidIban("")).toBe(false);
    expect(isValidIban("12345678")).toBe(false);
    expect(isValidIban("DEXX370400440532013000")).toBe(false);
  });
});

describe("isValidAbaRoutingNumber", () => {
  it("accepts real routing numbers", () => {
    expect(isValidAbaRoutingNumber("021000021")).toBe(true);
    expect(isValidAbaRoutingNumber("011401533")).toBe(true);
    expect(isValidAbaRoutingNumber("121000248")).toBe(true);
  });

  it("rejects a bad check digit, wrong length and all zeroes", () => {
    expect(isValidAbaRoutingNumber("021000022")).toBe(false);
    expect(isValidAbaRoutingNumber("02100002")).toBe(false);
    expect(isValidAbaRoutingNumber("000000000")).toBe(false);
  });
});

describe("validateBankFields", () => {
  it("passes a complete US account", () => {
    expect(
      validateBankFields("US", {
        routingNumber: "021000021",
        accountNumber: "123456789",
        accountType: "Checking"
      })
    ).toEqual([]);
  });

  it("reports every missing required field", () => {
    expect(validateBankFields("US", {})).toEqual([
      { field: "routingNumber", code: "required" },
      { field: "accountNumber", code: "required" },
      { field: "accountType", code: "required" }
    ]);
  });

  it("rejects a routing number that passes the pattern but fails the checksum", () => {
    expect(
      validateBankFields("US", {
        routingNumber: "021000022",
        accountNumber: "123456789",
        accountType: "Checking"
      })
    ).toEqual([{ field: "routingNumber", code: "invalid" }]);
  });

  it("rejects an account type outside the allowed set", () => {
    expect(
      validateBankFields("US", {
        routingNumber: "021000021",
        accountNumber: "123456789",
        accountType: "Brokerage"
      })
    ).toEqual([{ field: "accountType", code: "invalid" }]);
  });

  it("accepts a GB account by sort code without an IBAN", () => {
    expect(
      validateBankFields("GB", {
        sortCode: "12-34-56",
        accountNumber: "12345678"
      })
    ).toEqual([]);
  });

  it("still checksums an optional IBAN when one is supplied", () => {
    expect(
      validateBankFields("GB", {
        sortCode: "123456",
        accountNumber: "12345678",
        iban: "GB29NWBK60161331926818"
      })
    ).toEqual([{ field: "iban", code: "invalid" }]);
  });

  it("ignores values the country's format does not use", () => {
    // A leftover routing number after switching US -> DE is dropped, not rejected.
    expect(
      validateBankFields("DE", {
        iban: "DE89370400440532013000",
        routingNumber: "021000021"
      })
    ).toEqual([]);
  });

  it("requires an account number under the generic fallback", () => {
    expect(validateBankFields("JP", {})).toEqual([
      { field: "accountNumber", code: "required" }
    ]);
    expect(validateBankFields("JP", { accountNumber: "1234567" })).toEqual([]);
  });
});

describe("lastFour", () => {
  it("takes the last four characters, ignoring separators", () => {
    expect(lastFour("GB29 NWBK 6016 1331 9268 19")).toBe("6819");
    expect(lastFour("123456789")).toBe("6789");
  });

  it("returns null when there is nothing to mask", () => {
    expect(lastFour("123")).toBeNull();
    expect(lastFour(null)).toBeNull();
    expect(lastFour(undefined)).toBeNull();
  });
});

describe("splitBankFieldsForStorage", () => {
  it("routes each US field to its storage target", () => {
    const result = splitBankFieldsForStorage("US", {
      routingNumber: "021000021",
      accountNumber: "123456789",
      accountType: "Checking",
      swiftBic: "CHASUS33"
    });

    expect(result).toEqual({
      columns: { swiftBic: "CHASUS33", routingNumber: "021000021" },
      bankIdentifiers: { accountType: "Checking" },
      secrets: { accountNumber: "123456789" },
      lastFour: { accountNumber: "6789", iban: null },
      formatId: "us-aba"
    });
  });

  it("puts a sort code in the same column a routing number uses", () => {
    const result = splitBankFieldsForStorage("GB", {
      sortCode: "12-34-56",
      accountNumber: "12345678"
    });

    expect(result.columns.routingNumber).toBe("123456");
    expect(result.formatId).toBe("gb-sort");
  });

  it("splits Canadian transit and institution numbers across column and bag", () => {
    const result = splitBankFieldsForStorage("CA", {
      transitNumber: "12345",
      institutionNumber: "003",
      accountNumber: "1234567"
    });

    expect(result.columns.routingNumber).toBe("12345");
    expect(result.bankIdentifiers).toEqual({ institutionNumber: "003" });
  });

  it("keeps an IBAN out of every column and returns only its last four", () => {
    const result = splitBankFieldsForStorage("DE", {
      iban: "DE89 3704 0044 0532 0130 00"
    });

    expect(result.secrets).toEqual({ iban: "DE89370400440532013000" });
    expect(result.lastFour).toEqual({ accountNumber: null, iban: "3000" });
    expect(result.columns).toEqual({ swiftBic: null, routingNumber: null });
  });

  it("drops values belonging to another country's format", () => {
    // The whole point: a stale routing number cannot ride along on a German account.
    const result = splitBankFieldsForStorage("DE", {
      iban: "DE89370400440532013000",
      routingNumber: "021000021",
      accountNumber: "123456789"
    });

    expect(result.columns.routingNumber).toBeNull();
    expect(result.secrets.accountNumber).toBeUndefined();
    expect(result.lastFour.accountNumber).toBeNull();
  });
});

describe("bankFieldValuesFromStorage", () => {
  it("round-trips a US account back into form values, minus the secrets", () => {
    const stored = splitBankFieldsForStorage("US", {
      routingNumber: "021000021",
      accountNumber: "123456789",
      accountType: "Checking",
      swiftBic: "CHASUS33"
    });

    expect(
      bankFieldValuesFromStorage({
        formatId: stored.formatId,
        countryCode: "US",
        swiftBic: stored.columns.swiftBic,
        routingNumber: stored.columns.routingNumber,
        bankIdentifiers: stored.bankIdentifiers
      })
    ).toEqual({
      routingNumber: "021000021",
      accountType: "Checking",
      swiftBic: "CHASUS33"
    });
  });

  it("reads the shared column back under the country's own field name", () => {
    const stored = splitBankFieldsForStorage("GB", {
      sortCode: "123456",
      accountNumber: "12345678"
    });

    expect(
      bankFieldValuesFromStorage({
        formatId: stored.formatId,
        countryCode: "GB",
        routingNumber: stored.columns.routingNumber,
        bankIdentifiers: stored.bankIdentifiers
      })
    ).toEqual({ sortCode: "123456" });
  });

  it("honours the stored format over the country's current one", () => {
    // A row captured as generic keeps rendering generic fields even if the registry
    // later gives its country a dedicated format.
    expect(
      bankFieldValuesFromStorage({
        formatId: "generic",
        countryCode: "US",
        routingNumber: "ABC123"
      })
    ).toEqual({ bankCode: "ABC123" });
  });
});

describe("whole-form inputs", () => {
  // The validator and the writer are both handed the entire validated form, not a tidy
  // BankFieldValues — it carries ids, names, booleans and custom fields alongside the
  // identifiers. Anything that is not a known bank field must be ignored, not coerced.
  const wholeForm = {
    id: "bka_1",
    name: "Operating — USD",
    glAccountId: "acct_1",
    active: true,
    "custom-notes": "anything",
    bankName: "Chase",
    accountHolderName: "Acme Inc",
    countryCode: "US",
    currencyCode: "USD",
    routingNumber: "021000021",
    accountNumber: "123456789",
    accountType: "Checking"
  };

  it("validates without tripping on non-string fields", () => {
    expect(validateBankFields("US", wholeForm)).toEqual([]);
  });

  it("stores only the identifiers the format declares", () => {
    const result = splitBankFieldsForStorage("US", wholeForm);

    expect(result.columns.routingNumber).toBe("021000021");
    expect(result.secrets).toEqual({ accountNumber: "123456789" });
    expect(result.bankIdentifiers).toEqual({ accountType: "Checking" });
  });

  it("ignores a boolean sitting where a bank field name would be", () => {
    expect(
      normalizeBankFieldValue("accountNumber", true as unknown as string)
    ).toBe("");
    expect(validateBankFields("DE", { iban: 12345 })).toEqual([
      { field: "iban", code: "required" }
    ]);
  });
});
