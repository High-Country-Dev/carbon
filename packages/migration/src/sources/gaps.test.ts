import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  detectGaps,
  gapsMarkdownPath,
  renderGapsMarkdown,
  summarizeGaps
} from "../gaps/index.ts";
import {
  getMigrationSource,
  isMigrationSourceId,
  MIGRATION_SOURCES
} from "./index.ts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("the source registry", () => {
  it("gives every source a unique id and an integration to hold its credentials", () => {
    const ids = MIGRATION_SOURCES.map((source) => source.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const source of MIGRATION_SOURCES) {
      expect(source.name.length).toBeGreaterThan(0);
      expect(source.integrationId.length).toBeGreaterThan(0);
      expect(source.gaps.length).toBeGreaterThan(0);
    }
  });

  it("resolves a known id and refuses an unknown one", () => {
    expect(getMigrationSource("netsuite")?.name).toBe("NetSuite");
    expect(getMigrationSource("nope")).toBeUndefined();
    expect(isMigrationSourceId("netsuite")).toBe(true);
    expect(isMigrationSourceId("nope")).toBe(false);
  });
});

describe.each(MIGRATION_SOURCES)("$name's gap catalog", (source) => {
  it("has a unique, stable id per gap", () => {
    const ids = source.gaps.map((gap) => gap.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[A-Z]{2,4}-[A-Z]{3}-\d{3}$/);
  });

  it("gives every gap a workaround — a gap with no answer is a bug report", () => {
    for (const gap of source.gaps) {
      expect(
        gap.workaround.length,
        `${gap.id} has no workaround`
      ).toBeGreaterThan(20);
      expect(gap.detail.length, `${gap.id} has no detail`).toBeGreaterThan(40);
    }
  });

  it("has a generated register on disk that has not drifted", () => {
    const onDisk = readFileSync(
      join(packageRoot, gapsMarkdownPath(source)),
      "utf8"
    );
    expect(
      onDisk,
      `${gapsMarkdownPath(source)} is stale — run \`pnpm --filter @carbon/migration generate:gaps\``
    ).toBe(renderGapsMarkdown(source));
  });
});

describe("detectGaps", () => {
  const catalog = getMigrationSource("netsuite")?.gaps ?? [];

  it("drops a gap the read proved does not apply", () => {
    const gaps = detectGaps(catalog, { counts: { "NS-MFG-003": 0 } });
    expect(gaps.some((gap) => gap.id === "NS-MFG-003")).toBe(false);
  });

  it("keeps a gap the read could not probe, with a null count", () => {
    const gaps = detectGaps(catalog, {});
    expect(gaps.find((gap) => gap.id === "NS-MFG-003")?.count).toBeNull();
  });

  it("leads with the severe, countable gaps", () => {
    const gaps = detectGaps(catalog, {
      counts: { "NS-MFG-003": 4, "NS-INV-002": 900, "NS-CUS-002": 3 }
    });
    expect(gaps[0]?.id).toBe("NS-INV-002");
    // A low-severity gap never outranks a high-severity one, however big its count.
    const lowIndex = gaps.findIndex((gap) => gap.severity === "low");
    const highIndex = gaps.findIndex((gap) => gap.severity === "high");
    expect(highIndex).toBeLessThan(lowIndex);
  });

  it("is empty for a catalog with nothing in it", () => {
    expect(detectGaps([], { counts: { "NS-MFG-003": 4 } })).toEqual([]);
  });

  it("summarizes for the completion notice", () => {
    expect(summarizeGaps([])).toContain("No known gaps");
    expect(summarizeGaps(detectGaps(catalog, {}))).toContain("significant");
  });
});
