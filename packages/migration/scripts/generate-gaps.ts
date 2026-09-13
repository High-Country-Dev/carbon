import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { gapsMarkdownPath, renderGapsMarkdown } from "../src/gaps/index.ts";
import { MIGRATION_SOURCES } from "../src/sources/index.ts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

for (const source of MIGRATION_SOURCES) {
  const target = join(packageRoot, gapsMarkdownPath(source));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, renderGapsMarkdown(source), "utf8");
  console.log(`Wrote ${target} (${source.gaps.length} gaps)`);
}
