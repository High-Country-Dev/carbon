import type { MigrationSource } from "../../source.ts";
import { isSandboxAccount } from "./client/account.ts";
import { NetSuiteClient } from "./client/client.ts";
import {
  buildNetSuiteAuth,
  type NetSuiteMetadata,
  readAccountId
} from "./credentials.ts";
import { migratableSubsidiaries, probeAccount } from "./extract/probe.ts";
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

    return {
      accountId,
      sandbox: isSandboxAccount(accountId),
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

export { migratableSubsidiaries, probeAccount };
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
