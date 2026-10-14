// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

// resources.models' module graph transitively builds Lingui `msg` descriptors at
// module load. The macro isn't transformed under plain vitest, so raw `msg`
// throws. Stub it to a plain string builder; the validator under test is
// untouched.
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray | string, ...values: unknown[]) =>
    Array.isArray(strings)
      ? strings.reduce(
          (acc, s, i) => acc + s + (i < values.length ? String(values[i]) : ""),
          ""
        )
      : String(strings)
}));

const { abilityValidator } = await import("./resources.models");

// An ability is a process's qualification: it is created ONLY by picking a
// process, and it does not carry its own name (the name derives from the linked
// process). So the validator must require `processId` and must not accept a
// free-form `name`.
describe("abilityValidator", () => {
  it("accepts a processId (recertifyEveryDays optional)", () => {
    const parsed = abilityValidator.safeParse({ processId: "proc_1" });
    expect(parsed.success).toBe(true);
  });

  it("requires a processId", () => {
    const parsed = abilityValidator.safeParse({ recertifyEveryDays: 30 });
    expect(parsed.success).toBe(false);
  });

  it("does not carry a free-form name", () => {
    const parsed = abilityValidator.safeParse({
      processId: "proc_1",
      name: "Welding"
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect("name" in parsed.data).toBe(false);
    }
  });
});

describe("isValidTrainingGuideKey", async () => {
  const { isValidTrainingGuideKey, trainingGuideKeyPrefix } = await import(
    "./resources.models"
  );
  const prefix = trainingGuideKeyPrefix("c1", "t1");

  it("accepts one upload folder and one file", () => {
    expect(
      isValidTrainingGuideKey("c1/training/t1/abc/Welder Guide.pdf", prefix)
    ).toBe(true);
  });

  it("refuses another company's or training's key", () => {
    expect(
      isValidTrainingGuideKey("c2/training/t1/abc/guide.pdf", prefix)
    ).toBe(false);
    expect(
      isValidTrainingGuideKey("c1/training/t2/abc/guide.pdf", prefix)
    ).toBe(false);
  });

  it("refuses a file with no upload folder, or a deeper path", () => {
    expect(isValidTrainingGuideKey("c1/training/t1/guide.pdf", prefix)).toBe(
      false
    );
    expect(
      isValidTrainingGuideKey("c1/training/t1/abc/d/guide.pdf", prefix)
    ).toBe(false);
  });

  it("refuses dot segments and empty segments", () => {
    expect(isValidTrainingGuideKey("c1/training/t1/../x.pdf", prefix)).toBe(
      false
    );
    expect(isValidTrainingGuideKey("c1/training/t1/abc/", prefix)).toBe(false);
  });
});

describe("validateTrainingCertificate", async () => {
  const { TRAINING_CERTIFICATE_MAX_BYTES, validateTrainingCertificate } =
    await import("./resources.models");
  const file = (name: string, size = 10) =>
    new File([new Uint8Array(size)], name);

  it("accepts a PDF, PNG or JPG and returns its extension", () => {
    expect(validateTrainingCertificate(file("cert.PDF")).extension).toBe("pdf");
    expect(validateTrainingCertificate(file("photo.jpeg")).extension).toBe(
      "jpeg"
    );
    expect(validateTrainingCertificate(file("scan.png")).error).toBeNull();
  });

  it("refuses a missing or empty file", () => {
    expect(validateTrainingCertificate(null).error).toBe(
      "Upload a certificate file"
    );
    expect(validateTrainingCertificate(file("cert.pdf", 0)).error).toBe(
      "Upload a certificate file"
    );
  });

  it("refuses another type", () => {
    expect(validateTrainingCertificate(file("notes.txt")).error).toBe(
      "The certificate must be a PDF, PNG or JPG"
    );
    expect(validateTrainingCertificate(file("photo.heic")).error).toBe(
      "The certificate must be a PDF, PNG or JPG"
    );
  });

  it("refuses a file over the size limit", () => {
    expect(
      validateTrainingCertificate(
        file("cert.pdf", TRAINING_CERTIFICATE_MAX_BYTES + 1)
      ).error
    ).toBe("The certificate must be 10 MB or smaller");
  });
});

// An external assignment has a name and no training; an internal one has a
// training. Each must refuse the other's missing field.
describe("trainingAssignmentValidator", async () => {
  const { trainingAssignmentValidator } = await import("./resources.models");

  it("accepts an internal assignment with a training", () => {
    const parsed = trainingAssignmentValidator.safeParse({
      isExternal: false,
      trainingId: "trn_1",
      groupIds: ["grp_1"]
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses an internal assignment without a training", () => {
    const parsed = trainingAssignmentValidator.safeParse({
      isExternal: false,
      groupIds: ["grp_1"]
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts an external assignment with a name", () => {
    const parsed = trainingAssignmentValidator.safeParse({
      isExternal: true,
      name: "Forklift Safety",
      groupIds: ["grp_1"]
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses an external assignment without a name", () => {
    const parsed = trainingAssignmentValidator.safeParse({
      isExternal: true,
      name: "  ",
      groupIds: ["grp_1"]
    });
    expect(parsed.success).toBe(false);
  });
});
