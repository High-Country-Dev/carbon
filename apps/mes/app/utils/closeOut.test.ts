// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { missingRequiredSteps, requiresCloseOut } from "./closeOut";

const empty = {
  value: null,
  numericValue: null,
  booleanValue: null,
  userValue: null
};

describe("requiresCloseOut", () => {
  it("asks on Labor and Machine stops", () => {
    expect(requiresCloseOut({ type: "Labor", isBatched: false })).toBe(true);
    expect(requiresCloseOut({ type: "Machine", isBatched: false })).toBe(true);
  });

  it("never asks on Setup or in a batch", () => {
    expect(requiresCloseOut({ type: "Setup", isBatched: false })).toBe(false);
    expect(requiresCloseOut({ type: "Labor", isBatched: true })).toBe(false);
  });
});

describe("missingRequiredSteps", () => {
  it("lists a required step with no record", () => {
    const steps = [
      { name: "Torque", required: true, jobOperationStepRecord: [] },
      { name: "Photo", required: true, jobOperationStepRecord: null }
    ];
    expect(missingRequiredSteps(steps).map((s) => s.name)).toEqual([
      "Torque",
      "Photo"
    ]);
  });

  // The old finish check compared the record array to null, which an empty
  // array never is, so it treated every step as recorded.
  it("treats an empty record list as missing", () => {
    const steps = [
      { name: "Torque", required: true, jobOperationStepRecord: [] }
    ];
    expect(missingRequiredSteps(steps)).toHaveLength(1);
  });

  it("treats a record with only empty values as missing", () => {
    const steps = [
      { name: "Torque", required: true, jobOperationStepRecord: [empty] }
    ];
    expect(missingRequiredSteps(steps)).toHaveLength(1);
  });

  it("accepts any recorded value, including false and zero", () => {
    const steps = [
      {
        name: "Checked",
        required: true,
        jobOperationStepRecord: [{ ...empty, booleanValue: false }]
      },
      {
        name: "Gap",
        required: true,
        jobOperationStepRecord: [{ ...empty, numericValue: 0 }]
      }
    ];
    expect(missingRequiredSteps(steps)).toEqual([]);
  });

  it("ignores optional steps", () => {
    const steps = [
      { name: "Notes", required: false, jobOperationStepRecord: [] },
      { name: "Legacy", required: null, jobOperationStepRecord: [] }
    ];
    expect(missingRequiredSteps(steps)).toEqual([]);
  });
});
