// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// The MCP server's connect-time instructions, in their own module so they are
// testable without server.ts's import chain (callOperation → auth → env). The
// tool catalog is passed in (the generated `tool-metadata.json` lives in the app,
// derived from its `~/modules/*`), never imported here.
import type { ManifestEntry } from "@carbon/api";
import { MCP_DEFAULT_LIMIT, MCP_MAX_ROWS } from "./format-result";

export type ToolCatalogSummary = {
  tools: Pick<ManifestEntry, "module">[];
  totalTools: number;
  modules: number;
};

export function getServerInstructions(
  today: string,
  toolMetadata: ToolCatalogSummary
): string {
  const moduleNames = [
    ...new Set(toolMetadata.tools.map((tool) => tool.module))
  ].sort();
  return `Carbon ERP (manufacturing). Today is ${today}.

${toolMetadata.totalTools} operations across ${toolMetadata.modules} modules (${moduleNames.join(", ")}) are reached through three tools:
1. search_tools({ query: "purchase orders" }): ranked search. Takes an exact operation name, or abbreviations like PO, RMA, BOM, NCR; filter with module or classification (READ, WRITE, DESTRUCTIVE).
2. describe_tool({ names: ["sales_getCustomers", "sales_upsertCustomer"] }): input and response types, up to 10 per call. Simple reads need no describe: search lists their required parameters.
3. call_tool({ name: "sales_getCustomers", arguments: { limit: 10 }, fields: ["id", "name"] }): run one. "arguments" is a JSON object of the parameters describe_tool lists, flat.

- companyId and userId come from your credential; never pass them.
- Results are compact JSON with null fields omitted: an absent field means null.
- List reads default to ${MCP_DEFAULT_LIMIT} rows and return at most ${MCP_MAX_ROWS}. A list short of its total ends with "(rows A-B of TOTAL; next page: offset N)".
- Pass "fields" to return only the columns you need. To count rows, call with arguments.limit 1 and fields ["id"], then read TOTAL.
- Dates: ISO 8601 (YYYY-MM-DD).`;
}
