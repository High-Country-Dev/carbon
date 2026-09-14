import type { DetectedGap, MigrationGapDefinition } from "./gaps/index.ts";
import type { MigrationPlan } from "./plan.ts";

/**
 * The contract every migration source implements.
 *
 * The harness owns everything that is the same whatever you migrate FROM: the
 * plan, the loader that writes it, the gap register, progress reporting, the
 * snapshot/keep/revert lifecycle. A source owns everything that is specific to
 * one system: how to authenticate, how to read it without tripping its
 * governance limits, and what its records MEAN in Carbon's vocabulary.
 *
 * The line between them is `MigrationPlan`. It is Carbon-shaped, not
 * source-shaped, and it is deliberately NOT extensible per source: the target
 * schema is the same however the data arrived, and a source that holds something
 * the plan has no room for records a gap rather than widening the contract for
 * everyone.
 */

/** Sources Carbon can migrate from. Add a member when you add a source. */
export type MigrationSourceId = "netsuite";

/**
 * The unit inside a source account that maps 1:1 to a Carbon company — a
 * NetSuite subsidiary, an accounting tenant, a realm.
 *
 * A source with no such concept reports none, and the migration treats the whole
 * account as one company.
 *
 * Carbon models exactly this shape already: a `companyGroup` holding a tree of
 * companies linked by `parentCompanyId`, with `isEliminationEntity` for the ones
 * that exist only to cancel intercompany balances. So a scope carries the
 * hierarchy rather than flattening it — the migration rebuilds the source's own
 * org chart instead of inventing one.
 */
export type MigrationScope = {
  id: string;
  name: string;
  /** The registered legal name, when the source keeps one separately. */
  legalName: string | null;
  /** The scope's own base currency, when the source exposes one. */
  currencyCode: string | null;
  /** ISO-3166 alpha-2, when the source exposes one. */
  countryCode: string | null;
  /** The scope this one sits under. Null for the root — there is exactly one. */
  parentScopeId: string | null;
  /**
   * True for a consolidation-only entity. It becomes a Carbon company flagged
   * `isEliminationEntity`, but carries no business data worth migrating.
   */
  isElimination: boolean;
  inactive: boolean;
};

export type ExtractProgress = { phase: string; done: number; total: number };

export type ExtractOptions = {
  /** Which scope to migrate. Null when the source has only one, or none. */
  scopeId?: string | null;
  /**
   * Guard rail per collection. A migration should be bounded, not a runaway —
   * and a source that hits the cap must say so rather than look complete.
   */
  maxRowsPerCollection?: number;
  onProgress?: (progress: ExtractProgress) => Promise<void>;
  log?: (message: string) => void;
};

export type SourceReadResult = {
  plan: MigrationPlan;
  /** The gaps that apply to THIS account, with what each one costs it. */
  gaps: DetectedGap[];
  /** Things the user should know about how the read went, in their language. */
  notes: string[];
};

/**
 * A live, authenticated connection to one source account.
 *
 * `read` covers extract AND map in one call on purpose: a source's intermediate
 * snapshot is its own business, and exposing it would make the harness generic
 * over a type it can do nothing with. Sources still keep those two steps
 * separate internally — that is where their own tests live.
 */
export type SourceConnection = {
  /** How the account identifies itself; shown in the run report. */
  accountId: string;
  /** True for a sandbox or test account, so nobody migrates test data by accident. */
  sandbox: boolean;
  /**
   * What the account calls itself as a whole — a NetSuite account's root
   * subsidiary, an accounting org's name. It names the Carbon company group.
   */
  accountName: string;
  /**
   * The scopes this account holds, as a tree.
   *
   * Empty for a source (or an account) with no such concept: one account, one
   * company. Otherwise one Carbon company per scope, all in one group.
   */
  listScopes(): Promise<MigrationScope[]>;
  /** Read and map ONE scope. `scopeId` is required when `listScopes` returns any. */
  read(options: ExtractOptions): Promise<SourceReadResult>;
};

export type MigrationSource = {
  id: MigrationSourceId;
  /** What the user calls it. */
  name: string;
  /** One line for the card on the migrations page. */
  description: string;
  /**
   * The `companyIntegration` row that holds this source's credentials. Usually
   * the same string as `id`, but named separately because the integration
   * registry is its own namespace.
   */
  integrationId: string;
  /** Everything this source cannot bring across. Source-specific by nature. */
  gaps: MigrationGapDefinition[];
  /**
   * Build a connection from the integration's RESOLVED metadata — secrets
   * already merged in from the vault by the caller.
   *
   * Throws `SourceNotConnectedError` when the stored credentials are missing or
   * incomplete, with a message that tells the user what to fix.
   */
  connect(metadata: Record<string, unknown>): Promise<SourceConnection>;
};
