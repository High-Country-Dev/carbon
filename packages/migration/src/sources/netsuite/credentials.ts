import { SourceNotConnectedError } from "../../errors.ts";
import type { NetSuiteAuth } from "./client/client.ts";
import { createM2mAuth } from "./client/oauth2.ts";

/**
 * Turn the NetSuite integration's stored settings into something the client can
 * authenticate with.
 *
 * Pure of Carbon: it takes metadata that the caller has already resolved out of
 * `companyIntegration` and Supabase Vault. That keeps the vault (and the
 * service-role client it needs) out of this package entirely, and it is why this
 * function can be unit-tested with a plain object.
 */

export const NETSUITE_SOURCE_ID = "netsuite";

export type NetSuiteMetadata = {
  accountId?: string;
  authMethod?: string;
  clientId?: string;
  certificateId?: string;
  privateKey?: string;
  consumerKey?: string;
  consumerSecret?: string;
  tokenId?: string;
  tokenSecret?: string;
};

export const NETSUITE_TBA_AUTH_METHOD = "Token-Based Authentication";

export function readAccountId(metadata: NetSuiteMetadata): string {
  const accountId = metadata.accountId?.trim();
  if (!accountId) {
    throw new SourceNotConnectedError(
      NETSUITE_SOURCE_ID,
      "The NetSuite connection has no account id."
    );
  }
  return accountId;
}

/**
 * Build the auth for one connection.
 *
 * The OAuth 2.0 path mints its first access token HERE, so a bad key fails with
 * NetSuite's own message at connect time rather than as an opaque 401 partway
 * through a read.
 */
export async function buildNetSuiteAuth(
  accountId: string,
  metadata: NetSuiteMetadata
): Promise<NetSuiteAuth> {
  if (metadata.authMethod === NETSUITE_TBA_AUTH_METHOD) {
    const { consumerKey, consumerSecret, tokenId, tokenSecret } = metadata;
    if (!consumerKey || !consumerSecret || !tokenId || !tokenSecret) {
      throw new SourceNotConnectedError(
        NETSUITE_SOURCE_ID,
        "The NetSuite connection is set to Token-Based Authentication but is missing one of its four credentials."
      );
    }
    return {
      type: "tba",
      accountId,
      consumerKey,
      consumerSecret,
      tokenId,
      tokenSecret
    };
  }

  const { clientId, certificateId, privateKey } = metadata;
  if (!clientId || !certificateId || !privateKey) {
    throw new SourceNotConnectedError(
      NETSUITE_SOURCE_ID,
      "The NetSuite connection is missing its client id, certificate id or private key."
    );
  }

  return createM2mAuth({ accountId, clientId, certificateId, privateKey });
}
