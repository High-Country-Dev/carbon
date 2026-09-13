import {
  kindForStatus,
  MigrationError,
  type MigrationErrorKind
} from "../../../errors.ts";

/**
 * NetSuite's failures, in the harness's vocabulary.
 *
 * The only thing NetSuite adds to the shared model is how to FIND the cause:
 * its error bodies are RFC 7807 problem+json whose top-level `title` is a
 * generic "Invalid Request", with the real reason buried in `o:errorDetails[]`.
 */
export class NetSuiteError extends MigrationError {
  constructor(
    message: string,
    options: {
      kind: MigrationErrorKind;
      status?: number;
      detail?: string;
      code?: string;
      /** NetSuite's `X-N-OperationId` — the only handle its support can trace a failure by. */
      operationId?: string;
      cause?: unknown;
    }
  ) {
    super(message, { ...options, correlationId: options.operationId });
    this.name = "NetSuiteError";
  }

  /** Alias for `correlationId`, in NetSuite's own vocabulary. */
  get operationId(): string | undefined {
    return this.correlationId;
  }
}

export { kindForStatus };

/**
 * Pull the actual cause out of a NetSuite error body. The top-level `title` is
 * usually generic, so `o:errorDetails[0]` is what a user can act on.
 */
export function parseErrorBody(body: unknown): {
  detail?: string;
  code?: string;
} {
  if (!body || typeof body !== "object") return {};
  const record = body as Record<string, unknown>;

  const details = record["o:errorDetails"];
  if (Array.isArray(details) && details.length > 0) {
    const first = details[0] as Record<string, unknown> | undefined;
    return {
      detail:
        typeof first?.detail === "string"
          ? first.detail
          : typeof record.detail === "string"
            ? record.detail
            : undefined,
      code:
        typeof first?.["o:errorCode"] === "string"
          ? first["o:errorCode"]
          : undefined
    };
  }

  return {
    detail: typeof record.detail === "string" ? record.detail : undefined,
    code:
      typeof record["o:errorCode"] === "string"
        ? record["o:errorCode"]
        : undefined
  };
}
