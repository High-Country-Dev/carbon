import { describe, expect, it } from "vitest";
import { toE164 } from "./phone";

describe("toE164", () => {
  it("passes an E.164 value through untouched", () => {
    expect(toE164("+18008823399")).toBe("+18008823399");
  });

  it("passes empty values through", () => {
    expect(toE164(undefined)).toBeUndefined();
    expect(toE164("")).toBe("");
  });

  it("strips the spaces from a stored international number", () => {
    expect(toE164("+1 800 882 3399")).toBe("+18008823399");
  });

  it("strips punctuation from a stored international number", () => {
    expect(toE164("+44 (0)20-7946-0958")).toBe("+442079460958");
    expect(toE164("+1 (555) 123-4567")).toBe("+15551234567");
  });

  it("leaves a value with no country code alone", () => {
    // Nothing to normalise to without a country; the input shows it raw.
    expect(toE164("800 882 3399")).toBe("800 882 3399");
  });
});
