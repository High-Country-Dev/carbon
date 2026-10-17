// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// call_tool result formatting for the MCP surface ONLY — the HTTP API, the
// in-app agent, and the workflow dispatcher consume callOperation's structured
// data untouched. Everything here trades bytes for nothing an agent needs:
// compact JSON (indentation roughly doubles whitespace tokens on row arrays),
// null-stripped rows (an ERP row is ~half null columns), optional field
// projection, and a row and character budget so one wide page cannot flood the context.

/** Injected into list-operation args when the caller passes no `limit`. */
export const MCP_DEFAULT_LIMIT = 25;

/** Most rows one call returns; a larger `limit` is clamped to it. */
export const MCP_MAX_ROWS = 100;

/** Most characters of rows one call returns (~5k tokens). */
export const MCP_MAX_CHARS = 20_000;

/**
 * Drop null/undefined OBJECT ENTRIES recursively. Array elements are kept
 * positionally (a null element may be meaningful; a null field is just an
 * unset column). Documented to agents in the server instructions: an absent
 * field reads as null.
 */
export function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripNulls);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry === null || entry === undefined) continue;
      out[key] = stripNulls(entry);
    }
    return out;
  }
  return value;
}

/**
 * Page a fetchAll list result at the MCP boundary. The `get*List` services
 * ignore limit/offset entirely (`paginates: false` in the manifest), so the
 * caller's paging is applied to the full result here — the slice plus the
 * original total, which `formatMcpResult` reports as "(showing R of C rows)".
 */
export function pageMcpListResult(
  data: unknown,
  { limit, offset }: { limit: number; offset: number }
): { rows: unknown; total?: number } {
  if (!Array.isArray(data)) return { rows: data };
  return { rows: data.slice(offset, offset + limit), total: data.length };
}

/**
 * Keep only the named top-level fields of each row (or of a single object).
 * Wide ERP rows carry 50+ columns; an agent that needs three of them should not
 * pay for the rest.
 */
export function projectFields(data: unknown, fields?: string[]): unknown {
  if (!fields?.length) return data;
  const pick = (row: unknown) => {
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      return row;
    }
    const out: Record<string, unknown> = {};
    for (const field of fields) {
      if (field in row) out[field] = (row as Record<string, unknown>)[field];
    }
    return out;
  };
  return Array.isArray(data) ? data.map(pick) : pick(data);
}

/**
 * Serialize a call_tool result for the MCP text response. A list is cut at
 * `MCP_MAX_ROWS` rows or `MCP_MAX_CHARS` characters, whichever comes first,
 * and any list short of its total ends with the offset of the next page, so an
 * agent pages deliberately instead of assuming it saw everything. `count` is
 * the operation's total when the read was paginated; `offset` is where this
 * page starts.
 */
export function formatMcpResult(
  data: unknown,
  count?: number,
  offset = 0
): string {
  if (!Array.isArray(data)) return JSON.stringify(stripNulls(data)) ?? "";

  const serialized: string[] = [];
  let length = 2;
  for (const row of data) {
    if (serialized.length === MCP_MAX_ROWS) break;
    const text = JSON.stringify(stripNulls(row)) ?? "null";
    // Always emit one row: a single row over budget still answers the call.
    if (serialized.length > 0 && length + text.length + 1 > MCP_MAX_CHARS) {
      break;
    }
    serialized.push(text);
    length += text.length + 1;
  }

  let text = `[${serialized.join(",")}]`;
  const total = typeof count === "number" ? count : offset + data.length;
  const next = offset + serialized.length;
  if (next < total) {
    text += `\n(rows ${serialized.length ? `${offset + 1}-${next}` : "none"} of ${total}; next page: offset ${next}`;
    if (serialized.length < data.length) {
      text += `, output capped at ${MCP_MAX_CHARS} characters, pass \`fields\` to return only the columns you need`;
    }
    text += ")";
  }
  return text;
}
