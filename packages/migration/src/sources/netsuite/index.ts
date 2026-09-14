import type { MigrationSource } from "../../source.ts";
import { isSandboxAccount } from "./client/account.ts";
import { NetSuiteClient } from "./client/client.ts";
import {
  buildNetSuiteAuth,
  type NetSuiteMetadata,
  readAccountId
} from "./credentials.ts";
import {
  migratableSubsidiaries,
  probeAccount,
  rootSubsidiary
} from "./extract/probe.ts";
import { extractNetSuite } from "./extract/run.ts";
import { NETSUITE_GAPS } from "./gaps.ts";
import { mapSnapshotToPlan } from "./map/index.ts";

/**
 * NetSuite, as a migration source.
 *
 * Everything below the line — the SuiteTalk client, the SuiteQL extractors, the
 * mappers, the gap catalog — is NetSuite's business. Everything above it is the
 * harness's. This file is the whole seam between them, which is why it is short:
 * if adding a second source means changing anything outside its own directory
 * and this registry, the seam is in the wrong place.
 */
export const netsuiteSource: MigrationSource = {
  id: "netsuite",
  name: "NetSuite",
  description:
    "Your chart of accounts, customers, suppliers, items, bills of material, on-hand stock and open orders. Carbon only reads from NetSuite — nothing there changes.",
  integrationId: "netsuite",
  gaps: NETSUITE_GAPS,

  async connect(metadata) {
    const netsuiteMetadata = metadata as NetSuiteMetadata;
    const accountId = readAccountId(netsuiteMetadata);
    const auth = await buildNetSuiteAuth(accountId, netsuiteMetadata);
    const client = new NetSuiteClient({ auth });
    let accountLabel: string | null = null;

    // Probed once per connection: `listScopes` and `read` both need it, and it
    // costs a handful of round trips against an account whose whole concurrency
    // allotment is five.
    let probe: Awaited<ReturnType<typeof probeAccount>> | null = null;
    const getProbe = async () => {
      probe ??= await probeAccount(client);
      return probe;
    };

    return {
      accountId,
      sandbox: isSandboxAccount(accountId),

      get accountName() {
        // Filled in by listScopes; until then the account id is the only name
        // we have, and it is the one the customer typed.
        return accountLabel ?? accountId;
      },

      async listScopes() {
        const account = await getProbe();
        // A non-OneWorld account has no subsidiary table at all: one account,
        // one company, and the migration never asks which.
        if (!account.oneWorld) return [];

        accountLabel = rootSubsidiary(account)?.name ?? accountId;

        return account.subsidiaries
          .filter((subsidiary) => !subsidiary.isInactive)
          .map((subsidiary) => ({
            id: subsidiary.id,
            name: subsidiary.name,
            legalName: subsidiary.legalName,
            currencyCode: subsidiary.currencyCode,
            countryCode: subsidiary.countryCode,
            parentScopeId: subsidiary.parentId,
            isElimination: subsidiary.isElimination,
            inactive: subsidiary.isInactive
          }));
      },

      async read(options) {
        const snapshot = await extractNetSuite(client, accountId, {
          subsidiaryId: options.scopeId ?? null,
          maxRowsPerTable: options.maxRowsPerCollection,
          onProgress: options.onProgress,
          log: options.log
        });
        return mapSnapshotToPlan(snapshot);
      }
    };
  }
};

export { migratableSubsidiaries, probeAccount, rootSubsidiary };
export {
  accountHostLabel,
  accountRealm,
  authorizeUrl,
  isSandboxAccount,
  restBaseUrl,
  tokenUrl
} from "./client/account.ts";
export { type NetSuiteAuth, NetSuiteClient } from "./client/client.ts";
export { NetSuiteError } from "./client/errors.ts";
export {
  createM2mAuth,
  type M2mCredentials,
  requestM2mToken,
  signClientAssertion
} from "./client/oauth2.ts";
export { signTbaRequest, type TbaCredentials } from "./client/tba.ts";
export {
  buildNetSuiteAuth,
  NETSUITE_TBA_AUTH_METHOD,
  type NetSuiteMetadata,
  readAccountId
} from "./credentials.ts";
export { extractNetSuite, type NetSuiteSnapshot } from "./extract/run.ts";
export { NETSUITE_GAPS } from "./gaps.ts";
export { type MapResult, mapSnapshotToPlan } from "./map/index.ts";
