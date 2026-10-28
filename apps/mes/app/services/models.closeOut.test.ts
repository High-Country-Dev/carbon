// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { closeOutValidator } from "./models";

// The close-out form posts strings; the answers are what make the stop valid.
const answered = {
  id: "pe_1",
  jobOperationId: "op_1",
  type: "Labor",
  scrapped: "no",
  outcome: "inProgress"
};

function issuePaths(input: Record<string, unknown>) {
  const result = closeOutValidator.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => i.path.join("."));
}

describe("closeOutValidator", () => {
  it("accepts a stop with both questions answered", () => {
    expect(issuePaths(answered)).toEqual([]);
  });

  it("refuses a stop with either question unanswered", () => {
    const { scrapped: _s, outcome: _o, ...unanswered } = answered;
    expect(issuePaths(unanswered).sort()).toEqual(["outcome", "scrapped"]);
  });

  it("requires a quantity and a reason when something was scrapped", () => {
    expect(issuePaths({ ...answered, scrapped: "yes" }).sort()).toEqual([
      "scrapQuantity",
      "scrapReasonId"
    ]);
    expect(
      issuePaths({ ...answered, scrapped: "yes", scrapQuantity: "0" })
    ).toContain("scrapQuantity");
    expect(
      issuePaths({
        ...answered,
        scrapped: "yes",
        scrapQuantity: "2",
        scrapReasonId: "sr_1"
      })
    ).toEqual([]);
  });

  it("does not close out a Setup timer", () => {
    expect(issuePaths({ ...answered, type: "Setup" })).toContain("type");
  });
});
