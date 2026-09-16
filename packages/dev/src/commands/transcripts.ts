/**
 * `crbn transcripts` — attach the Claude Code session transcripts behind a
 * branch to its pull request, as the prompts the author actually wrote.
 *
 * This is a local command by necessity, not by preference: transcripts live in
 * `~/.claude` on the machine the work happened on, so CI has nothing to read.
 *
 * Posting is opt-in (`--post`). The default prints a preview, because publishing
 * your side of a conversation to a pull request is a one-way door — on a public
 * repo it is public, and an edit later does not un-send it.
 */

import { writeFileSync } from "node:fs";
import { confirm, intro, isCancel, log, outro } from "@clack/prompts";
import { execa } from "execa";
import pc from "picocolors";
import { currentBranch, listWorktrees } from "../git.js";
import {
  collectSessions,
  countMessages,
  renderForComment,
  TRANSCRIPT_MARKER
} from "../transcripts.js";

export type TranscriptsOptions = {
  branch?: string;
  pr?: number;
  post: boolean;
  out?: string;
  yes: boolean;
};

export async function transcripts(opts: TranscriptsOptions) {
  intro("Carbon · session transcripts");

  const branch = opts.branch ?? (await currentBranch());
  if (!branch) {
    log.error("Detached HEAD — pass --branch <name>.");
    process.exit(1);
  }

  // Every worktree, so a branch developed outside the main checkout is found.
  const roots = (await listWorktrees())
    .filter((w) => !w.bare)
    .map((w) => w.path);

  const sessions = collectSessions({ branch, roots });
  if (sessions.length === 0) {
    log.warn(
      `No Claude Code sessions recorded on ${pc.cyan(branch)}.\n` +
        "Transcripts are matched by the branch they were recorded on — check out\n" +
        "the branch you worked on, or pass --branch."
    );
    outro("");
    return;
  }

  const total = countMessages(sessions);
  const body = renderForComment(sessions, branch);

  log.message(
    `${pc.bold(String(total))} prompt${total === 1 ? "" : "s"} across ` +
      `${pc.bold(String(sessions.length))} session${sessions.length === 1 ? "" : "s"} ` +
      `on ${pc.cyan(branch)} ${pc.dim(`(${body.length} chars)`)}`,
    { symbol: pc.bold(pc.yellow("found")) }
  );
  for (const session of sessions) {
    log.message(
      `${session.title ?? session.sessionId.slice(0, 8)} ${pc.dim(
        `· ${session.messages.length} message${session.messages.length === 1 ? "" : "s"}`
      )}`
    );
  }

  if (opts.out) {
    writeFileSync(opts.out, body, "utf-8");
    log.success(`Wrote ${pc.cyan(opts.out)}`);
  }

  if (!opts.post) {
    if (!opts.out) {
      console.log(`\n${body}`);
    }
    outro(pc.dim("Preview only — re-run with --post to attach it to the PR."));
    return;
  }

  await postToPullRequest(body, branch, opts);
  outro("");
}

async function postToPullRequest(
  body: string,
  branch: string,
  opts: TranscriptsOptions
) {
  if (!(await hasGh())) {
    log.error(
      "GitHub CLI (`gh`) not found — install it, or use --out <file> and paste the body."
    );
    process.exit(1);
  }

  const pr = opts.pr ?? (await resolvePullRequest(branch));
  if (pr === null) {
    log.error(
      `No open pull request found for ${pc.cyan(branch)} — open one first, or pass --pr <number>.`
    );
    process.exit(1);
  }

  if (!opts.yes) {
    const ok = await confirm({
      message:
        `Post these prompts to PR #${pr}? ` +
        "Anyone who can see the pull request can read them.",
      initialValue: false
    });
    if (isCancel(ok) || !ok) {
      log.warn("Not posted.");
      process.exit(0);
    }
  }

  const existing = await findExistingComment(pr);
  const path = existing
    ? `repos/{owner}/{repo}/issues/comments/${existing}`
    : `repos/{owner}/{repo}/issues/${pr}/comments`;

  const result = await execa(
    "gh",
    ["api", path, "--method", existing ? "PATCH" : "POST", "--input", "-"],
    // Sent on stdin: a transcript is far past the shell's argument limit.
    { input: JSON.stringify({ body }), reject: false }
  );
  if (result.exitCode !== 0) {
    log.error(`gh api failed:\n${result.stderr || result.stdout}`);
    process.exit(1);
  }

  const url = parseCommentUrl(result.stdout);
  log.success(
    `${existing ? "Updated" : "Posted"} transcripts on PR #${pr}${url ? `\n${url}` : ""}`
  );
}

async function hasGh(): Promise<boolean> {
  const r = await execa("gh", ["--version"], { reject: false });
  return r.exitCode === 0;
}

async function resolvePullRequest(branch: string): Promise<number | null> {
  const r = await execa("gh", ["pr", "view", branch, "--json", "number"], {
    reject: false
  });
  if (r.exitCode !== 0) return null;
  try {
    const parsed = JSON.parse(r.stdout) as { number?: number };
    return typeof parsed.number === "number" ? parsed.number : null;
  } catch {
    return null;
  }
}

/**
 * The id of this tool's own comment, if it already posted one. Re-running is a
 * normal part of the workflow (you add commits, you add prompts), so it edits
 * in place rather than leaving a trail of stale transcripts on the PR.
 */
async function findExistingComment(pr: number): Promise<number | null> {
  const r = await execa(
    "gh",
    [
      "api",
      `repos/{owner}/{repo}/issues/${pr}/comments`,
      "--paginate",
      "--jq",
      `.[] | select(.body | startswith("${TRANSCRIPT_MARKER}")) | .id`
    ],
    { reject: false }
  );
  if (r.exitCode !== 0) return null;
  // Several only if an older version double-posted; the newest wins.
  const ids = r.stdout
    .split("\n")
    .map((line) => Number(line.trim()))
    .filter((id) => Number.isInteger(id) && id > 0);
  return ids.length > 0 ? (ids[ids.length - 1] as number) : null;
}

function parseCommentUrl(stdout: string): string | null {
  try {
    const parsed = JSON.parse(stdout) as { html_url?: string };
    return parsed.html_url ?? null;
  } catch {
    return null;
  }
}
