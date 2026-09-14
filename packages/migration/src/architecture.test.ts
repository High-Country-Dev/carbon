import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const srcRoot = dirname(fileURLToPath(import.meta.url));

function filesUnder(dir: string): string[] {
  return readdirSync(join(srcRoot, dir), {
    withFileTypes: true,
    recursive: true
  })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => join(entry.parentPath, entry.name));
}

function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(/from\s+"([^"]+)"/g)].map(
    (match) => match[1] ?? ""
  );
}

/**
 * The seam between the harness and its sources is the whole design, and it is
 * the kind of thing that erodes one convenient import at a time. These assert it
 * mechanically, because a reviewer will not notice the first violation.
 */
describe("the harness/source seam", () => {
  it("never lets the loader reach into a source", () => {
    for (const file of filesUnder("load")) {
      for (const specifier of importsOf(file)) {
        expect(
          specifier.includes("sources/"),
          `${file} imports ${specifier} — the loader writes a MigrationPlan and must not know where it came from`
        ).toBe(false);
      }
    }
  });

  it("never lets a source reach into the loader", () => {
    for (const file of filesUnder("sources")) {
      for (const specifier of importsOf(file)) {
        expect(
          specifier.includes("/load"),
          `${file} imports ${specifier} — a source produces a MigrationPlan and must not know how it is written`
        ).toBe(false);
      }
    }
  });

  it("keeps the harness free of Carbon's app and integration storage", () => {
    // The loader takes a transaction and the sources take resolved metadata, so
    // nothing here should need Supabase, the vault, or the job runtime.
    const banned = ["@carbon/auth", "@carbon/ee", "@carbon/jobs", "@supabase/"];
    for (const dir of ["load", "sources", "gaps", "http"]) {
      for (const file of filesUnder(dir)) {
        for (const specifier of importsOf(file)) {
          for (const ban of banned) {
            expect(
              specifier.startsWith(ban),
              `${file} imports ${specifier} — the harness must stay independent of how Carbon stores credentials and runs jobs`
            ).toBe(false);
          }
        }
      }
    }
  });
});
