import { describe, expect, it } from "vitest";
import {
  getBankFieldConfig,
  isValidAbaRouting,
  isValidBsb,
  isValidCanadianRouting,
  isValidIban,
  isValidIfsc,
  isValidSortCode,
  isValidSwiftBic,
  maskAccountNumber
} from "./bank";

describe("isValidIban", () => {
  it("accepts published valid IBANs", () => {
    // Examples from the ISO 13616 registry / national bank publications.
    expect(isValidIban("GB82WEST12345698765432")).toBe(true);
    expect(isValidIban("DE89370400440532013000")).toBe(true);
    expect(isValidIban("FR1420041010050500013M02606")).toBe(true);
    expect(isValidIban("NL91ABNA0417164300")).toBe(true);
  });

  it("ignores whitespace and case", () => {
    expect(isValidIban("gb82 west 1234 5698 7654 32")).toBe(true);
  });

  it("rejects a value whose check digits are wrong", () => {
    // Same as the valid GB example with one digit changed.
    expect(isValidIban("GB82WEST12345698765433")).toBe(false);
  });

  it("rejects structurally invalid values", () => {
    expect(isValidIban("")).toBe(false);
    expect(isValidIban("GB82")).toBe(false);
    expect(isValidIban("1234567890")).toBe(false);
    expect(isValidIban("GBXXWEST12345698765432")).toBe(false);
  });
});

describe("isValidAbaRouting", () => {
  it("accepts real routing numbers", () => {
    expect(isValidAbaRouting("011000015")).toBe(true); // FRB Boston
    expect(isValidAbaRouting("121000248")).toBe(true); // Wells Fargo
  });

  it("rejects a wrong checksum", () => {
    expect(isValidAbaRouting("011000016")).toBe(false);
  });

  it("rejects wrong lengths and non-digits", () => {
    expect(isValidAbaRouting("")).toBe(false);
    expect(isValidAbaRouting("01100001")).toBe(false);
    expect(isValidAbaRouting("0110000155")).toBe(false);
    expect(isValidAbaRouting("01100001X")).toBe(false);
  });
});

describe("isValidSwiftBic", () => {
  it("accepts 8 and 11 character codes", () => {
    expect(isValidSwiftBic("DEUTDEFF")).toBe(true);
    expect(isValidSwiftBic("DEUTDEFF500")).toBe(true);
    expect(isValidSwiftBic("deutdeff")).toBe(true);
  });

  it("rejects other lengths and bad prefixes", () => {
    expect(isValidSwiftBic("")).toBe(false);
    expect(isValidSwiftBic("DEUTDEF")).toBe(false);
    expect(isValidSwiftBic("DEUTDEFF5000")).toBe(false);
    expect(isValidSwiftBic("1EUTDEFF")).toBe(false);
  });
});

describe("maskAccountNumber", () => {
  it("shows only the last four characters", () => {
    expect(maskAccountNumber("123456789")).toBe("••••6789");
    expect(maskAccountNumber("GB82WEST12345698765432")).toBe("••••5432");
  });

  it("fully masks values too short to partially reveal", () => {
    expect(maskAccountNumber("1234")).toBe("••••");
    expect(maskAccountNumber("12")).toBe("••••");
  });

  it("returns an empty string for missing values", () => {
    expect(maskAccountNumber(null)).toBe("");
    expect(maskAccountNumber(undefined)).toBe("");
    expect(maskAccountNumber("")).toBe("");
  });
});

describe("country-specific bank code validators", () => {
  it("validates UK sort codes, ignoring the conventional hyphens", () => {
    expect(isValidSortCode("12-34-56")).toBe(true);
    expect(isValidSortCode("123456")).toBe(true);
    expect(isValidSortCode("12345")).toBe(false);
    expect(isValidSortCode("12-34-5A")).toBe(false);
  });

  it("validates Australian BSBs", () => {
    expect(isValidBsb("082-039")).toBe(true);
    expect(isValidBsb("082039")).toBe(true);
    expect(isValidBsb("08203")).toBe(false);
  });

  it("validates Indian IFSC codes", () => {
    expect(isValidIfsc("HDFC0001234")).toBe(true);
    expect(isValidIfsc("hdfc0001234")).toBe(true);
    // Fifth character must be a literal zero.
    expect(isValidIfsc("HDFC1001234")).toBe(false);
    expect(isValidIfsc("HDF0001234")).toBe(false);
  });

  it("validates Canadian transit + institution numbers", () => {
    expect(isValidCanadianRouting("00012345")).toBe(true);
    expect(isValidCanadianRouting("0001-2345")).toBe(true);
    expect(isValidCanadianRouting("0001234")).toBe(false);
  });
});

describe("getBankFieldConfig", () => {
  it("gives the US an ABA-validated bank code", () => {
    const config = getBankFieldConfig("US");
    expect(config.accountLabel).toBe("accountNumber");
    expect(config.bankCodeLabel).toBe("aba");
    expect(config.validateBankCode?.("011000015")).toBe(true);
    expect(config.validateBankCode?.("011000016")).toBe(false);
  });

  it("gives SEPA countries an IBAN account and no bank code", () => {
    const config = getBankFieldConfig("DE");
    expect(config.accountLabel).toBe("iban");
    // The IBAN already carries the bank identifier.
    expect(config.bankCodeLabel).toBeNull();
    expect(config.validateAccount?.("DE89370400440532013000")).toBe(true);
  });

  it("labels the UK bank code a sort code", () => {
    expect(getBankFieldConfig("GB").bankCodeLabel).toBe("sortCode");
  });

  it("is case-insensitive on the country code", () => {
    expect(getBankFieldConfig("gb").bankCodeLabel).toBe("sortCode");
  });

  it("falls back to a permissive default for unlisted or missing countries", () => {
    // An unlisted country must still be enterable — format checks only.
    for (const code of ["ZZ", "", null, undefined]) {
      const config = getBankFieldConfig(code);
      expect(config.accountLabel).toBe("accountNumber");
      expect(config.bankCodeLabel).toBe("bankCode");
      expect(config.validateAccount).toBeUndefined();
      expect(config.validateBankCode).toBeUndefined();
    }
  });
});

describe("requiresSwift", () => {
  it("is set for SEPA and the permissive default, not for domestic-code countries", () => {
    // A cross-border payment will not route without a BIC.
    expect(getBankFieldConfig("FR").requiresSwift).toBe(true);
    expect(getBankFieldConfig("ZZ").requiresSwift).toBe(true);
    // The US routes domestically on the ABA, so a BIC is optional.
    expect(getBankFieldConfig("US").requiresSwift).toBeUndefined();
  });
});

describe("real-world French bank account", () => {
  // The exact values from a supplier onboarding form: Crédit Agricole, EUR.
  const iban = "FR76 1820 6000 8465 1157 7476 437";
  const bic = "AGRIFRPP882";

  it("accepts the IBAN as written, spaces included", () => {
    expect(isValidIban(iban)).toBe(true);
  });

  it("accepts the 11-character BIC", () => {
    expect(isValidSwiftBic(bic)).toBe(true);
  });

  it("labels the account an IBAN and asks for no bank code", () => {
    const config = getBankFieldConfig("FR");
    expect(config.accountLabel).toBe("iban");
    expect(config.bankCodeLabel).toBeNull();
    expect(config.validateAccount?.(iban)).toBe(true);
    expect(config.requiresSwift).toBe(true);
  });

  it("masks the IBAN down to its last four digits", () => {
    expect(maskAccountNumber(iban)).toBe("••••6437");
  });
});
