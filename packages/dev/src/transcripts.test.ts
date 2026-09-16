import { describe, expect, it } from "vitest";
import {
  buildEntryFilter,
  cleanUserText,
  collectSessions,
  extractUserText,
  GITHUB_COMMENT_LIMIT,
  IMAGE_PLACEHOLDER,
  parseTranscript,
  renderForComment,
  renderMarkdown,
  type SessionTranscript,
  TRANSCRIPT_MARKER
} from "./transcripts.js";

const human = (content: unknown, extra: Record<string, unknown> = {}) => ({
  type: "user",
  isSidechain: false,
  origin: { kind: "human" },
  uuid: "u1",
  timestamp: "2026-09-16T00:54:38.104Z",
  cwd: "/home/user/carbon",
  gitBranch: "feat/thing",
  message: { role: "user", content },
  ...extra
});

describe("extractUserText", () => {
  it("keeps a typed prompt", () => {
    expect(extractUserText(human("Build the thing"))).toBe("Build the thing");
  });

  it("keeps text blocks", () => {
    expect(
      extractUserText(human([{ type: "text", text: "Build the thing" }]))
    ).toBe("Build the thing");
  });

  it("rejects a tool result", () => {
    const entry = human(
      [{ type: "tool_result", tool_use_id: "t1", content: "total 88" }],
      { origin: undefined, toolUseResult: { stdout: "total 88" } }
    );
    expect(extractUserText(entry)).toBeNull();
  });

  it("rejects a tool result even without the toolUseResult field", () => {
    // Older transcripts carry the blocks but not the sibling field.
    const entry = human([
      { type: "tool_result", tool_use_id: "t1", content: "out" }
    ]);
    expect(extractUserText(entry)).toBeNull();
  });

  it("rejects subagent turns", () => {
    expect(extractUserText(human("go", { isSidechain: true }))).toBeNull();
  });

  it("rejects harness meta turns", () => {
    expect(extractUserText(human("Caveat: …", { isMeta: true }))).toBeNull();
  });

  it("rejects a non-human origin", () => {
    expect(
      extractUserText(human("go", { origin: { kind: "hook" } }))
    ).toBeNull();
  });

  it("accepts when origin is absent (older transcripts)", () => {
    expect(extractUserText(human("go", { origin: undefined }))).toBe("go");
  });

  it("rejects assistant entries", () => {
    expect(extractUserText({ ...human("hi"), type: "assistant" })).toBeNull();
  });

  it("notes a pasted image", () => {
    expect(
      extractUserText(
        human([
          { type: "image", source: {} },
          { type: "text", text: "like this" }
        ])
      )
    ).toBe(`${IMAGE_PLACEHOLDER}\n\nlike this`);
  });

  it("drops a turn that is only injected context", () => {
    expect(
      extractUserText(human("<system-reminder>be good</system-reminder>"))
    ).toBeNull();
  });
});

describe("cleanUserText", () => {
  it("strips system reminders but keeps the prompt", () => {
    expect(
      cleanUserText(
        "Fix the bug\n<system-reminder>Long injected rules…</system-reminder>"
      )
    ).toBe("Fix the bug");
  });

  it("strips reminders with attributes", () => {
    expect(
      cleanUserText("<ide_selection file='a.ts'>code</ide_selection>Do it")
    ).toBe("Do it");
  });

  it("strips command stdout and hook output", () => {
    expect(
      cleanUserText(
        "<local-command-stdout>noise</local-command-stdout>ship it" +
          "<user-prompt-submit-hook>reminder</user-prompt-submit-hook>"
      )
    ).toBe("ship it");
  });

  it("renders a slash command as what the user typed", () => {
    expect(
      cleanUserText(
        "<command-message>fix is running…</command-message>" +
          "<command-name>/fix</command-name>" +
          "<command-args>the login bug</command-args>"
      )
    ).toBe("/fix the login bug");
  });

  it("adds the leading slash when the name omits it", () => {
    expect(
      cleanUserText(
        "<command-name>test</command-name><command-args></command-args>"
      )
    ).toBe("/test");
  });

  it("drops interrupt markers but keeps the follow-up", () => {
    expect(
      cleanUserText("[Request interrupted by user]\nactually do it differently")
    ).toBe("actually do it differently");
  });

  it("collapses the blank lines a removal leaves behind", () => {
    expect(
      cleanUserText("one\n<system-reminder>x</system-reminder>\n\n\ntwo")
    ).toBe("one\n\ntwo");
  });
});

describe("buildEntryFilter", () => {
  it("matches on branch", () => {
    const accept = buildEntryFilter({ branch: "feat/thing" });
    expect(accept({ gitBranch: "feat/thing" })).toBe(true);
    expect(accept({ gitBranch: "main" })).toBe(false);
  });

  it("scopes to the repo's worktrees", () => {
    const accept = buildEntryFilter({ roots: ["/home/user/carbon"] });
    expect(accept({ cwd: "/home/user/carbon" })).toBe(true);
    expect(accept({ cwd: "/home/user/carbon/apps/erp" })).toBe(true);
    expect(accept({ cwd: "/home/user/carbon-other" })).toBe(false);
    expect(accept({ cwd: "/elsewhere" })).toBe(false);
  });

  it("accepts a linked worktree path", () => {
    const accept = buildEntryFilter({
      roots: ["/home/user/carbon", "/home/user/trees/feat"]
    });
    expect(accept({ cwd: "/home/user/trees/feat" })).toBe(true);
  });
});

describe("parseTranscript", () => {
  const lines = (...entries: unknown[]) =>
    entries.map((e) => JSON.stringify(e)).join("\n");

  const accept = buildEntryFilter({ branch: "feat/thing" });

  it("picks the prompts out of a mixed transcript", () => {
    const content = lines(
      { type: "ai-title", aiTitle: "PR transcript tool", sessionId: "s1" },
      { ...human("first"), sessionId: "s1", uuid: "a" },
      { type: "assistant", sessionId: "s1", message: { content: "…" } },
      {
        ...human([{ type: "tool_result", tool_use_id: "t", content: "x" }]),
        sessionId: "s1",
        uuid: "b"
      },
      { ...human("second"), sessionId: "s1", uuid: "c" }
    );
    const session = parseTranscript("s1.jsonl", content, accept);
    expect(session?.sessionId).toBe("s1");
    expect(session?.title).toBe("PR transcript tool");
    expect(session?.messages.map((m) => m.text)).toEqual(["first", "second"]);
  });

  it("returns null when nothing human is on the branch", () => {
    const content = lines({
      ...human("on another branch"),
      gitBranch: "main",
      uuid: "a"
    });
    expect(parseTranscript("s.jsonl", content, accept)).toBeNull();
  });

  it("survives a torn final line", () => {
    const content = `${lines({ ...human("kept"), uuid: "a" })}\n{"type":"user"`;
    expect(parseTranscript("s.jsonl", content, accept)?.messages).toHaveLength(
      1
    );
  });

  it("does not double-count a resumed session's replayed entries", () => {
    const seen = new Set<string>();
    const original = lines({ ...human("shared"), sessionId: "s1", uuid: "a" });
    const resumed = lines(
      { ...human("shared"), sessionId: "s2", uuid: "a" },
      { ...human("new"), sessionId: "s2", uuid: "b" }
    );
    parseTranscript("s1.jsonl", original, accept, seen);
    const second = parseTranscript("s2.jsonl", resumed, accept, seen);
    expect(second?.messages.map((m) => m.text)).toEqual(["new"]);
  });
});

describe("renderMarkdown", () => {
  const session: SessionTranscript = {
    sessionId: "9c1bba76-8e48",
    title: "PR transcript tool",
    file: "s.jsonl",
    messages: [
      {
        uuid: "a",
        timestamp: "2026-09-16T00:54:38.104Z",
        text: "Build a tool"
      }
    ]
  };

  it("leads with the marker so re-runs can find the comment", () => {
    expect(
      renderMarkdown([session], { branch: "feat/thing" }).startsWith(
        TRANSCRIPT_MARKER
      )
    ).toBe(true);
  });

  it("blockquotes the prompt and names the branch", () => {
    const body = renderMarkdown([session], { branch: "feat/thing" });
    expect(body).toContain("> Build a tool");
    expect(body).toContain("`feat/thing`");
    expect(body).toContain("PR transcript tool");
  });

  it("escapes html in a session title", () => {
    const body = renderMarkdown([{ ...session, title: "<img src=x>" }], {
      branch: "b"
    });
    expect(body).toContain("&lt;img src=x&gt;");
    expect(body).not.toContain("<img src=x>");
  });

  it("falls back to the session id when untitled", () => {
    const body = renderMarkdown([{ ...session, title: null }], { branch: "b" });
    expect(body).toContain("Session 9c1bba76");
  });

  it("states that sessions were dropped", () => {
    const body = renderMarkdown([session], {
      branch: "b",
      omittedSessions: 2
    });
    expect(body).toContain("2 earlier sessions omitted");
  });
});

describe("renderForComment", () => {
  const bigSession = (id: string, chars: number): SessionTranscript => ({
    sessionId: id,
    title: `Session ${id}`,
    file: `${id}.jsonl`,
    messages: [
      {
        uuid: id,
        timestamp: "2026-09-16T00:54:38.104Z",
        text: "x".repeat(chars)
      }
    ]
  });

  it("leaves a small transcript untruncated", () => {
    const body = renderForComment([bigSession("a", 50)], "b");
    expect(body).toContain("x".repeat(50));
    expect(body).not.toContain("truncated");
  });

  it("truncates rather than exceed GitHub's limit", () => {
    const body = renderForComment([bigSession("a", 200_000)], "b");
    expect(body.length).toBeLessThanOrEqual(GITHUB_COMMENT_LIMIT);
    expect(body).toContain("truncated");
  });

  it("sheds oldest prompts when a single session overflows, and stays well-formed", () => {
    // ~200 prompts in one session overflows even at the tightest truncation,
    // which is the only case that used to fall through to slicing the markdown.
    const session: SessionTranscript = {
      sessionId: "long",
      title: "Long session",
      file: "long.jsonl",
      messages: Array.from({ length: 200 }, (_, i) => ({
        uuid: `m${i}`,
        timestamp: "2026-09-16T00:54:38.104Z",
        text: `prompt ${i} ${"y".repeat(2000)}`
      }))
    };
    const body = renderForComment([session], "b");
    expect(body.length).toBeLessThanOrEqual(GITHUB_COMMENT_LIMIT);
    expect(body).toMatch(/omitted to fit/);
    expect(body).toMatch(/prompts omitted/);
    // Every opened block is closed — a raw slice would leave a dangling tag.
    const opened = body.match(/<details>/g)?.length ?? 0;
    const closed = body.match(/<\/details>/g)?.length ?? 0;
    expect(opened).toBe(closed);
    expect(opened).toBeGreaterThan(0);
    // The newest prompt survives.
    expect(body).toContain("prompt 199");
  });

  it("drops oldest sessions only after truncating, and says so", () => {
    // Enough sessions that even the tightest per-message truncation overflows,
    // which is the only thing that forces a session to be dropped.
    const sessions = Array.from({ length: 200 }, (_, i) =>
      bigSession(`s${i}`, 3000)
    );
    const body = renderForComment(sessions, "b");
    expect(body.length).toBeLessThanOrEqual(GITHUB_COMMENT_LIMIT);
    expect(body).toMatch(/omitted to fit/);
    // The newest session survives the drop.
    expect(body).toContain("Session s199");
  });
});

describe("collectSessions", () => {
  it("returns nothing when the transcripts root is absent", () => {
    expect(
      collectSessions({ branch: "b", root: "/nonexistent/claude/projects" })
    ).toEqual([]);
  });
});
