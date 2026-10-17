// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  formatMcpResult,
  MCP_MAX_CHARS,
  MCP_MAX_ROWS,
  pageMcpListResult,
  projectFields,
  stripNulls
} from "@carbon/ee/mcp";
import { describe, expect, it } from "vitest";

describe("stripNulls", () => {
  it("drops null and undefined object entries, recursively", () => {
    expect(
      stripNulls({
        id: "a",
        fax: null,
        customFields: undefined,
        nested: { workPhone: null, name: "x" }
      })
    ).toEqual({ id: "a", nested: { name: "x" } });
  });

  it("keeps array elements positionally and empty values", () => {
    expect(stripNulls([1, null, { a: null, b: "" }])).toEqual([
      1,
      null,
      { b: "" }
    ]);
    expect(stripNulls({ tags: [], notes: "" })).toEqual({
      tags: [],
      notes: ""
    });
  });
});

describe("formatMcpResult", () => {
  it("serializes compactly with nulls stripped", () => {
    const text = formatMcpResult([{ id: "a", fax: null }]);
    expect(text).toBe('[{"id":"a"}]');
  });

  it("caps rows at MCP_MAX_ROWS and names the next offset", () => {
    const rows = Array.from({ length: MCP_MAX_ROWS + 40 }, (_, i) => ({
      id: i
    }));
    const text = formatMcpResult(rows);
    expect(text).toContain('{"id":0}');
    expect(text).not.toContain(`{"id":${MCP_MAX_ROWS}}`);
    expect(text).toContain(
      `(rows 1-${MCP_MAX_ROWS} of ${MCP_MAX_ROWS + 40}; next page: offset ${MCP_MAX_ROWS}, output capped`
    );
  });

  it("stops at the character budget but always returns one row", () => {
    const wide = { id: 0, notes: "x".repeat(MCP_MAX_CHARS / 4) };
    const rows = Array.from({ length: 10 }, (_, i) => ({ ...wide, id: i }));
    const text = formatMcpResult(rows, 50, 20);
    const body = text.slice(0, text.indexOf("\n"));
    expect(JSON.parse(body)).toHaveLength(3);
    expect(text).toContain("(rows 21-23 of 50; next page: offset 23");
    expect(text).toContain("pass `fields`");

    const huge = [{ notes: "x".repeat(MCP_MAX_CHARS * 2) }, { id: 1 }];
    expect(formatMcpResult(huge)).toContain("(rows 1-1 of 2;");
  });

  it("names the next offset when the read was paginated short", () => {
    const text = formatMcpResult([{ id: "a" }], 240, 25);
    expect(text).toBe(
      '[{"id":"a"}]\n(rows 26-26 of 240; next page: offset 26)'
    );
  });

  it("omits the footer when everything was returned", () => {
    expect(formatMcpResult([{ id: "a" }], 1)).toBe('[{"id":"a"}]');
    expect(formatMcpResult([{ id: "b" }], 26, 25)).toBe('[{"id":"b"}]');
  });

  it("serializes a single object whole", () => {
    expect(formatMcpResult({ id: "a", fax: null })).toBe('{"id":"a"}');
  });
});

describe("projectFields", () => {
  it("keeps only the named fields of each row", () => {
    expect(
      projectFields(
        [
          { id: "a", name: "A", wide: 1 },
          { id: "b", wide: 2 }
        ],
        ["id", "name"]
      )
    ).toEqual([{ id: "a", name: "A" }, { id: "b" }]);
    expect(projectFields({ id: "a", wide: 1 }, ["id"])).toEqual({ id: "a" });
  });

  it("passes data through when no fields are named", () => {
    const rows = [{ id: "a" }];
    expect(projectFields(rows, undefined)).toBe(rows);
    expect(projectFields(rows, [])).toBe(rows);
    expect(projectFields(["a", 1], ["id"])).toEqual(["a", 1]);
  });
});

describe("pageMcpListResult", () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ id: i }));

  it("slices to the requested page and reports the full total", () => {
    expect(pageMcpListResult(rows, { limit: 3, offset: 0 })).toEqual({
      rows: [{ id: 0 }, { id: 1 }, { id: 2 }],
      total: 10
    });
    expect(pageMcpListResult(rows, { limit: 3, offset: 9 })).toEqual({
      rows: [{ id: 9 }],
      total: 10
    });
  });

  it("passes non-array data through untouched", () => {
    expect(pageMcpListResult({ id: "a" }, { limit: 3, offset: 0 })).toEqual({
      rows: { id: "a" }
    });
  });

  it("composes with formatMcpResult's showing line", () => {
    const { rows: page, total } = pageMcpListResult(rows, {
      limit: 1,
      offset: 0
    });
    expect(formatMcpResult(page, total)).toBe(
      '[{"id":0}]\n(rows 1-1 of 10; next page: offset 1)'
    );
  });
});
