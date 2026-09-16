/**
 * Claude Code session transcripts → "what the author actually asked for".
 *
 * Claude Code appends one JSONL file per session under
 * `~/.claude/projects/<mangled-cwd>/<sessionId>.jsonl`. Every entry carries the
 * `gitBranch` and `cwd` it was recorded on, which is the only join we have
 * between a session and a pull request: a PR is a branch, so the sessions that
 * produced it are the sessions whose entries were recorded on that branch.
 *
 * The hard part is deciding what the HUMAN said. `type: "user"` is not that —
 * it is the transport for three unrelated things:
 *
 *   1. prompts the person typed              ← the only thing we want
 *   2. tool results being fed back to Claude (`tool_result` blocks)
 *   3. context the harness injects on the person's behalf (system reminders,
 *      command stdout, hook output, IDE state)
 *
 * and subagent conversations (`isSidechain`) are prompts *Claude* wrote, not the
 * person. Including any of those turns a transcript into noise, so the filter
 * below is deliberately several independent checks rather than one: newer
 * transcripts carry `origin.kind`, older ones do not, and the structural checks
 * have to stand on their own when it is absent.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "pathe";

/** Identifies the comment this tool owns, so re-runs update instead of pile up. */
export const TRANSCRIPT_MARKER = "<!-- crbn:transcripts -->";

/** GitHub rejects an issue-comment body longer than this. */
export const GITHUB_COMMENT_LIMIT = 65536;

/** Shown in place of a pasted image — the person did share it, we just can't inline it. */
export const IMAGE_PLACEHOLDER = "_[image]_";

export type UserMessage = {
  uuid: string;
  timestamp: string;
  text: string;
};

export type SessionTranscript = {
  sessionId: string;
  /** Claude Code's own generated title for the session, when it recorded one. */
  title: string | null;
  file: string;
  messages: UserMessage[];
};

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Wrappers the harness injects into the user turn. The person never typed any
 * of these, and a system reminder in particular can be far longer than the
 * prompt it is attached to.
 */
const NOISE_TAGS = [
  "system-reminder",
  "command-message",
  "local-command-stdout",
  "user-prompt-submit-hook",
  "ide_opened_file",
  "ide_selection",
  "untrusted_external_data"
];

/** `[Request interrupted…]` is a thing the person DID, not a thing they said. */
const INTERRUPT_MARKERS =
  /^\s*\[Request interrupted by user(?: for tool use)?\]\s*$/gm;

const SLASH_COMMAND = /<command-name>([\s\S]*?)<\/command-name>/;
const SLASH_ARGS = /<command-args>([\s\S]*?)<\/command-args>/;

/**
 * Strip injected context out of a user turn, keeping what the person wrote.
 *
 * A slash command is rendered back as the `/name args` the person typed: the
 * surrounding `<command-message>`/`<command-name>` markup is machinery, but the
 * invocation itself is genuinely their input and reads as intent in review.
 */
export function cleanUserText(raw: string): string {
  let text = raw;

  const name = SLASH_COMMAND.exec(text)?.[1]?.trim();
  if (name) {
    const args = SLASH_ARGS.exec(text)?.[1]?.trim();
    // A slash command turn is entirely markup — replace it wholesale rather
    // than stripping tags out of it, so nothing machine-authored survives.
    return [name.startsWith("/") ? name : `/${name}`, args]
      .filter(Boolean)
      .join(" ")
      .trim();
  }

  for (const tag of NOISE_TAGS) {
    text = text.replace(
      new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tag}>`, "g"),
      ""
    );
  }
  text = text.replace(INTERRUPT_MARKERS, "");

  // Collapse the blank-line runs the removals leave behind.
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * The person's words from one transcript entry, or null when the entry is
 * anything else. Each check is independent on purpose — see the file header.
 */
export function extractUserText(entry: unknown): string | null {
  if (!isRecord(entry) || entry.type !== "user") return null;

  // Subagent turns: written by Claude to drive a subagent.
  if (entry.isSidechain === true) return null;
  // Harness-authored preambles ("Caveat: the messages below…").
  if (entry.isMeta === true) return null;
  // Present only on tool results.
  if (entry.toolUseResult !== undefined) return null;

  // Newer transcripts label the author outright. Absent on older ones, so this
  // can reject but never confirm.
  if (isRecord(entry.origin)) {
    const kind = entry.origin.kind;
    if (typeof kind === "string" && kind !== "human") return null;
  }

  const message = entry.message;
  if (!isRecord(message)) return null;
  const content = message.content;

  let raw = "";
  if (typeof content === "string") {
    raw = content;
  } else if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (!isRecord(block)) continue;
      // One tool_result block makes the whole turn machine output.
      if (block.type === "tool_result") return null;
      if (block.type === "text") parts.push(str(block.text));
      if (block.type === "image") parts.push(IMAGE_PLACEHOLDER);
    }
    raw = parts.join("\n\n");
  } else {
    return null;
  }

  const cleaned = cleanUserText(raw);
  return cleaned.length > 0 ? cleaned : null;
}

export type EntryFilter = (entry: Json) => boolean;

/**
 * Restrict entries to a branch and to checkouts of this repo.
 *
 * `roots` is every worktree path, not just the current one: a branch is
 * routinely developed in a linked worktree, whose `cwd` differs from the main
 * checkout, and scoping to the main root alone would silently find nothing.
 */
export function buildEntryFilter(opts: {
  branch?: string;
  roots?: string[];
}): EntryFilter {
  const roots = opts.roots?.map((r) => resolve(r));
  return (entry) => {
    if (opts.branch && str(entry.gitBranch) !== opts.branch) return false;
    if (roots && roots.length > 0) {
      const cwd = str(entry.cwd);
      if (!cwd) return false;
      const path = resolve(cwd);
      if (!roots.some((r) => path === r || path.startsWith(`${r}/`))) {
        return false;
      }
    }
    return true;
  };
}

/**
 * Parse one transcript. `seen` carries uuids across files so a resumed session,
 * which replays its parent's entries into a new file under the same uuids, does
 * not report the same prompt twice.
 */
export function parseTranscript(
  file: string,
  content: string,
  accept: EntryFilter,
  seen: Set<string> = new Set()
): SessionTranscript | null {
  let sessionId = "";
  let title: string | null = null;
  const messages: UserMessage[] = [];

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      // A session still being written can end mid-line; keep what parsed.
      continue;
    }
    if (!isRecord(entry)) continue;

    if (!sessionId) sessionId = str(entry.sessionId);
    // Several may be written as the session is re-titled; the last one wins.
    if (entry.type === "ai-title" && str(entry.aiTitle)) {
      title = str(entry.aiTitle);
    }

    if (!accept(entry)) continue;
    const text = extractUserText(entry);
    if (text === null) continue;

    const uuid = str(entry.uuid);
    if (uuid && seen.has(uuid)) continue;
    if (uuid) seen.add(uuid);

    messages.push({ uuid, timestamp: str(entry.timestamp), text });
  }

  if (messages.length === 0) return null;
  return {
    sessionId: sessionId || file,
    title,
    file,
    messages
  };
}

/** Where Claude Code keeps per-project session transcripts. */
export function transcriptsRoot(): string {
  return join(homedir(), ".claude", "projects");
}

/**
 * Every transcript file, oldest first. Ordering matters for dedupe: the session
 * that first recorded a prompt should be the one credited with it.
 */
export function listTranscriptFiles(root: string): string[] {
  let projectDirs: string[];
  try {
    projectDirs = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(root, d.name));
  } catch {
    return [];
  }

  const files: { path: string; mtime: number }[] = [];
  for (const dir of projectDirs) {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith(".jsonl")) continue;
      const path = join(dir, name);
      try {
        files.push({ path, mtime: statSync(path).mtimeMs });
      } catch {
        // Raced with a delete; nothing to read.
      }
    }
  }
  return files.sort((a, b) => a.mtime - b.mtime).map((f) => f.path);
}

/** Sessions that contributed to `branch`, oldest first. */
export function collectSessions(opts: {
  branch?: string;
  roots?: string[];
  root?: string;
}): SessionTranscript[] {
  const accept = buildEntryFilter(opts);
  const seen = new Set<string>();
  const sessions: SessionTranscript[] = [];

  for (const file of listTranscriptFiles(opts.root ?? transcriptsRoot())) {
    let content: string;
    try {
      content = readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    // Cheap reject before parsing every line of a multi-megabyte transcript.
    if (opts.branch && !content.includes(opts.branch)) continue;

    const session = parseTranscript(file, content, accept, seen);
    if (session) sessions.push(session);
  }

  return sessions.sort((a, b) =>
    firstTimestamp(a).localeCompare(firstTimestamp(b))
  );
}

function firstTimestamp(session: SessionTranscript): string {
  return session.messages[0]?.timestamp ?? "";
}

export function countMessages(sessions: SessionTranscript[]): number {
  return sessions.reduce((sum, s) => sum + s.messages.length, 0);
}

/** Per-message character budgets tried in order when a body is too long. */
const TRUNCATION_TIERS = [Number.POSITIVE_INFINITY, 4000, 1500, 500];

/** The last tier — what every further shedding stage renders at. */
const TIGHTEST_TIER = 500;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  // Prefer a line break so we don't cut mid-word.
  const slice = text.slice(0, max);
  const cut = slice.lastIndexOf("\n");
  const kept = (cut > max * 0.6 ? slice.slice(0, cut) : slice).trimEnd();
  return `${kept}\n\n_…truncated (${text.length - kept.length} more characters)_`;
}

function blockquote(text: string): string {
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? `> ${line}` : ">"))
    .join("\n");
}

function day(timestamp: string): string {
  // Timestamps are ISO-8601 UTC; the date half is all we show.
  return timestamp.slice(0, 10);
}

function clock(timestamp: string): string {
  return timestamp.slice(11, 16);
}

function sessionHeading(session: SessionTranscript): string {
  const name = session.title ?? `Session ${session.sessionId.slice(0, 8)}`;
  const count = session.messages.length;
  const when = day(session.messages[0]?.timestamp ?? "");
  const plural = count === 1 ? "message" : "messages";
  return `<b>${escapeHtml(name)}</b> — ${count} ${plural}${when ? ` · ${when}` : ""}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export type RenderOptions = {
  branch: string;
  /** Per-message cap; omit for none. */
  maxMessageChars?: number;
  /** Sessions dropped to fit, reported so the omission is never silent. */
  omittedSessions?: number;
  /** Prompts dropped to fit, reported the same way. */
  omittedMessages?: number;
};

/** The PR comment body. */
export function renderMarkdown(
  sessions: SessionTranscript[],
  opts: RenderOptions
): string {
  const max = opts.maxMessageChars ?? Number.POSITIVE_INFINITY;
  const total = countMessages(sessions);
  const sessionCount = sessions.length;

  const lines: string[] = [
    TRANSCRIPT_MARKER,
    "## 💬 Session transcripts",
    "",
    `${total} ${total === 1 ? "prompt" : "prompts"} across ` +
      `${sessionCount} ${sessionCount === 1 ? "session" : "sessions"} on \`${opts.branch}\`.`,
    "",
    "_Only what the author typed — assistant replies, tool calls and tool output are excluded._",
    ""
  ];

  for (const session of sessions) {
    lines.push(
      `<details>`,
      `<summary>${sessionHeading(session)}</summary>`,
      ""
    );
    session.messages.forEach((message, index) => {
      const time = clock(message.timestamp);
      lines.push(`**${index + 1}.**${time ? ` \`${time}\`` : ""}`, "");
      lines.push(blockquote(truncate(message.text, max)), "");
    });
    lines.push("</details>", "");
  }

  const dropped: string[] = [];
  if (opts.omittedSessions && opts.omittedSessions > 0) {
    const n = opts.omittedSessions;
    dropped.push(`${n} earlier ${n === 1 ? "session" : "sessions"}`);
  }
  if (opts.omittedMessages && opts.omittedMessages > 0) {
    const n = opts.omittedMessages;
    dropped.push(`${n} earlier ${n === 1 ? "prompt" : "prompts"}`);
  }
  if (dropped.length > 0) {
    lines.push(
      `_${dropped.join(" and ")} omitted to fit GitHub's comment size limit._`,
      ""
    );
  }

  return lines.join("\n").trimEnd() + "\n";
}

/**
 * Render within GitHub's comment limit.
 *
 * Sheds detail in increasing order of how much context it costs: tighten
 * per-message truncation, then drop whole sessions oldest-first, then drop the
 * oldest prompts of the session that is left. Every stage is stated in the body,
 * and none of them can emit half a `<details>` block the way slicing the
 * rendered markdown would.
 */
export function renderForComment(
  sessions: SessionTranscript[],
  branch: string,
  limit: number = GITHUB_COMMENT_LIMIT
): string {
  for (const tier of TRUNCATION_TIERS) {
    const body = renderMarkdown(sessions, { branch, maxMessageChars: tier });
    if (body.length <= limit) return body;
  }

  const render = (
    kept: SessionTranscript[],
    omittedSessions: number,
    omittedMessages: number
  ) =>
    renderMarkdown(kept, {
      branch,
      maxMessageChars: TIGHTEST_TIER,
      omittedSessions,
      omittedMessages
    });

  let kept = sessions;
  while (kept.length > 1) {
    kept = kept.slice(1);
    const body = render(kept, sessions.length - kept.length, 0);
    if (body.length <= limit) return body;
  }

  // One session and still over: shed its oldest prompts.
  const omittedSessions = sessions.length - kept.length;
  const only = kept[0];
  if (!only) return render([], omittedSessions, 0);

  let messages = only.messages;
  while (messages.length > 1) {
    messages = messages.slice(1);
    const body = render(
      [{ ...only, messages }],
      omittedSessions,
      only.messages.length - messages.length
    );
    if (body.length <= limit) return body;
  }

  // A single prompt capped at TIGHTEST_TIER cannot overflow, so this is the
  // terminating case rather than another fallback.
  return render(
    [{ ...only, messages }],
    omittedSessions,
    only.messages.length - messages.length
  );
}
