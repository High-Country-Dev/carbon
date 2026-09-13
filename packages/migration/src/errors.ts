/**
 * One error model for every migration source.
 *
 * `retryable` is decided here, once, rather than at each call site: the
 * transport's backoff loop and the job's error reporting must never disagree
 * about whether a failure was transient. A source maps its own error shapes onto
 * these kinds — that mapping is the only place a source's error vocabulary
 * exists.
 */
export type MigrationErrorKind =
  /** Bad credentials, a missing role permission, a feature that is switched off. */
  | "auth"
  /** The source's governance limit — concurrency or rate. */
  | "rate-limit"
  /** A record type or record that does not exist, often because a feature is off. */
  | "not-found"
  /** Our query or payload is wrong. */
  | "invalid-request"
  /** The source's own fault. */
  | "server"
  /** The request never got there: DNS, TLS, timeout. */
  | "network"
  | "unknown";

export class MigrationError extends Error {
  readonly kind: MigrationErrorKind;
  readonly status: number | undefined;
  readonly detail: string | undefined;
  /** The source's own error code, e.g. NetSuite's `SSS_REQUEST_LIMIT_EXCEEDED`. */
  readonly code: string | undefined;
  /**
   * The source's request id. Worth carrying everywhere: it is usually the only
   * thing the source's own support can trace a failure by.
   */
  readonly correlationId: string | undefined;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: {
      kind: MigrationErrorKind;
      status?: number;
      detail?: string;
      code?: string;
      correlationId?: string;
      cause?: unknown;
    }
  ) {
    super(message, { cause: options.cause });
    this.name = "MigrationError";
    this.kind = options.kind;
    this.status = options.status;
    this.detail = options.detail;
    this.code = options.code;
    this.correlationId = options.correlationId;
    this.retryable =
      options.kind === "rate-limit" ||
      options.kind === "server" ||
      options.kind === "network";
  }
}

/** The usual HTTP status → kind mapping. A source overrides it only where it differs. */
export function kindForStatus(status: number): MigrationErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate-limit";
  if (status === 404) return "not-found";
  if (status >= 500) return "server";
  if (status >= 400) return "invalid-request";
  return "unknown";
}

/**
 * The source is not connected, or its stored credentials are incomplete.
 *
 * Separate from `MigrationError` because it is not a failure of the source — it
 * is a failure of our setup, and the message goes straight to the user with an
 * action in it.
 */
export class SourceNotConnectedError extends Error {
  readonly sourceId: string;

  constructor(sourceId: string, message: string) {
    super(message);
    this.name = "SourceNotConnectedError";
    this.sourceId = sourceId;
  }
}

/**
 * The source account holds several scopes and the migration must not choose.
 *
 * A Carbon company holds ONE scope — one NetSuite subsidiary, one accounting
 * tenant. Merging several would double-count whatever flows between them, so
 * the job stops and the page renders the choice.
 */
export class ScopeChoiceRequired extends Error {
  readonly sourceId: string;
  readonly scopes: { id: string; name: string; currencyCode: string | null }[];

  constructor(
    sourceId: string,
    scopes: { id: string; name: string; currencyCode: string | null }[],
    message: string
  ) {
    super(message);
    this.name = "ScopeChoiceRequired";
    this.sourceId = sourceId;
    this.scopes = scopes;
  }
}
