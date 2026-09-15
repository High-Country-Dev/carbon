import {
  ONSHAPE_CLIENT_ID,
  ONSHAPE_CLIENT_SECRET,
  VERCEL_URL
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { OnshapeIntegrationId } from "@carbon/ee/onshape";
import { redis } from "@carbon/kv";
import { getLogger } from "@carbon/logger";
import type { IntegrationErrorCode } from "~/modules/settings/integration-errors";
import { integrationErrorSearch } from "~/modules/settings/integration-errors";
import { oauthPopupResponse } from "~/modules/settings/oauth-popup.server";
import { upsertCompanyIntegration } from "~/modules/settings/settings.server";
import { oAuthCallbackSchema } from "~/modules/shared";
import { path } from "~/utils/path";

const logger = getLogger("erp", "onshape", "oauth");

/** Absolute integrations-page URL on this request's origin. */
function integrationsUrl(request: Request) {
  const requestUrl = new URL(request.url);

  if (!VERCEL_URL || VERCEL_URL.includes("localhost")) {
    requestUrl.protocol = "http";
  }

  return `${requestUrl.origin}${path.to.integrations}`;
}

/**
 * Onshape reaches this loader by redirecting the user's browser — inside the
 * popup that `Onshape.onClientInstall` opened — so a failure has to render as
 * something the user can act on. Returning `data({ error })` produced a bare
 * `{"error":"…"}` JSON document; redirecting the popup to the integrations page
 * put the whole settings UI inside a 600×800 window. `oauthPopupResponse` posts
 * the outcome to the page that opened the popup and closes it; that page turns
 * the code into a toast. With no opener (popups blocked) it falls back to the
 * integrations page, which shows the same toast. Only a code crosses the
 * boundary; `integrationErrors` owns the copy.
 */
function connectionFailed(
  request: Request,
  integrationId: OnshapeIntegrationId,
  reason: IntegrationErrorCode<"onshape">
) {
  return oauthPopupResponse(
    { integration: integrationId, ok: false, error: reason },
    `${integrationsUrl(request)}${integrationErrorSearch("onshape", reason)}`
  );
}

/** Success: tell the opener to revalidate, close the popup. */
function connectionSucceeded(
  request: Request,
  integrationId: OnshapeIntegrationId
) {
  return oauthPopupResponse(
    { integration: integrationId, ok: true },
    integrationsUrl(request)
  );
}

/**
 * Both Onshape integrations authorize identically — same OAuth app, same
 * scopes, same token exchange — and differ only in which redirect URI they
 * registered and which `companyIntegration` row the credentials land on. So
 * the callback is written once and both routes call it.
 */
export async function handleOnshapeOAuthCallback({
  request,
  integrationId,
  redirectUrl
}: {
  request: Request;
  integrationId: OnshapeIntegrationId;
  redirectUrl: string | undefined;
}) {
  const { userId, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const url = new URL(request.url);
  const searchParams = Object.fromEntries(url.searchParams.entries());

  // Onshape reports a refused authorization by redirecting here with `error` (and
  // usually `error_description`) in place of `code` — e.g. `invalid_scope` when the
  // OAuth application in the Onshape dev portal isn't granted a scope install.ts
  // asked for. Parsing for `code` first collapsed every one of those into an opaque
  // "Invalid Onshape auth response", so surface it instead.
  if (searchParams.error) {
    logger.error("Onshape authorization refused", {
      error: searchParams.error,
      errorDescription: searchParams.error_description
    });

    // `invalid_scope` means the OAuth application isn't granted a scope we asked
    // for. In practice that's `OAuth2Write` — labelled "Application can write to
    // your documents" in the Onshape dev portal — so the UI can name the exact fix
    // instead of echoing Onshape's wording, which never says which scope is missing.
    return connectionFailed(
      request,
      integrationId,
      searchParams.error === "invalid_scope" ? "write-permission" : "denied"
    );
  }

  const authResponse = oAuthCallbackSchema.safeParse(searchParams);

  if (!authResponse.success) {
    // Log the parameter names (never the values — `code` is a live credential)
    // so a malformed callback is diagnosable from the logs.
    logger.error("Invalid Onshape auth response", {
      params: Object.keys(searchParams)
    });
    return connectionFailed(request, integrationId, "invalid-response");
  }

  const { data: params } = authResponse;

  if (!params.state) {
    return connectionFailed(request, integrationId, "invalid-response");
  }

  // The state must be one this user minted for this company and integration,
  // and it is spent here whether or not the rest succeeds. Without the check a
  // callback URL carrying someone else's authorization code, opened by a
  // signed-in admin, would connect the admin's company to that Onshape account.
  if (
    !(await consumeOnshapeOAuthState(params.state, {
      integrationId,
      userId,
      companyId
    }))
  ) {
    logger.error("Onshape OAuth state did not match a pending install", {
      integrationId
    });
    return connectionFailed(request, integrationId, "invalid-response");
  }

  if (!ONSHAPE_CLIENT_ID || !ONSHAPE_CLIENT_SECRET || !redirectUrl) {
    return connectionFailed(request, integrationId, "not-configured");
  }

  try {
    const tokenResponse = await fetch("https://oauth.onshape.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: params.code,
        client_id: ONSHAPE_CLIENT_ID,
        client_secret: ONSHAPE_CLIENT_SECRET,
        redirect_uri: redirectUrl
      })
    });

    if (!tokenResponse.ok) {
      logger.error("Onshape token exchange failed", {
        status: tokenResponse.status,
        body: await tokenResponse.text()
      });
      return connectionFailed(request, integrationId, "token-exchange");
    }

    const tokenData = await tokenResponse.json();

    if (!tokenData.access_token) {
      logger.error("Onshape token response had no access token");
      return connectionFailed(request, integrationId, "token-exchange");
    }

    const serviceRole = getCarbonServiceRole();

    // `upsertCompanyIntegration` writes the whole metadata column, so a
    // reconnect built from fresh credentials alone would drop everything else
    // the integration keeps there — the Onshape property map, the asset-sync
    // toggle, `onshapeCompanyId`. Read the row first and put the new keys on
    // top of it: reconnecting is a credential refresh, not a reset.
    const existing = await serviceRole
      .from("companyIntegration")
      .select("metadata")
      .eq("id", integrationId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (existing.error) {
      logger.error("Failed to read the Onshape integration before saving", {
        error: existing.error
      });
      return connectionFailed(request, integrationId, "save-failed");
    }
    const existingMetadata = existing.data?.metadata;

    const createdIntegration = await upsertCompanyIntegration(serviceRole, {
      id: integrationId,
      active: true,
      metadata: {
        ...(typeof existingMetadata === "object" &&
        existingMetadata !== null &&
        !Array.isArray(existingMetadata)
          ? existingMetadata
          : {}),
        credentials: {
          type: "oauth2",
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          expiresAt: new Date(Date.now() + 3600 * 1000).toISOString()
        },
        // The scope actually granted by this authorization. Onshape returns it on
        // the token response; fall back to what we requested (install.ts always
        // asks for read+write). Used to tell an already-connected user they must
        // reconnect before enabling asset sync — a token minted before write was
        // requested is read-only, and a refresh can't widen it. Legacy installs
        // predate this field (no `scope`), which reads as read-only → prompt.
        scope: tokenData.scope ?? "OAuth2Read OAuth2Write",
        baseUrl: "https://cad.onshape.com"
      },
      updatedBy: userId,
      companyId: companyId
    });

    if (createdIntegration?.data?.metadata) {
      // The release webhook is registered when the user enables asset sync (see
      // the integration settings save + ensureOnshapeReleaseWebhook), not on
      // connect — asset sync is off by default, so there's nothing to subscribe
      // to yet at this point.
      return connectionSucceeded(request, integrationId);
    } else {
      logger.error("Failed to save Onshape integration", {
        createdIntegration
      });
      return connectionFailed(request, integrationId, "save-failed");
    }
  } catch (err) {
    logger.error("Onshape OAuth Error", { error: err });
    return connectionFailed(request, integrationId, "unexpected");
  }
}

/**
 * How long a started connection stays completable. Generous for a user who
 * signs in to Onshape inside the popup; short enough that a leaked callback
 * URL is soon worthless.
 */
const OAUTH_STATE_TTL_SECONDS = 15 * 60;

type OnshapeOAuthStateBinding = {
  integrationId: OnshapeIntegrationId;
  userId: string;
  companyId: string;
};

function oauthStateKey(state: string) {
  return `onshape-oauth-state:${state}`;
}

/**
 * Spend a callback's state: true only when it was minted by
 * `createOnshapeAuthorizeUrl` for exactly this integration, user and company,
 * and has not expired or been used. GETDEL makes it single-use — a replayed
 * callback finds nothing.
 */
async function consumeOnshapeOAuthState(
  state: string,
  expected: OnshapeOAuthStateBinding
): Promise<boolean> {
  // crypto.randomUUID() is 36 characters; anything else was never minted.
  if (state.length !== 36) return false;
  const raw = await redis.getdel(oauthStateKey(state));
  if (!raw) return false;
  try {
    const bound = JSON.parse(raw) as Partial<OnshapeOAuthStateBinding>;
    return (
      bound.integrationId === expected.integrationId &&
      bound.userId === expected.userId &&
      bound.companyId === expected.companyId
    );
  } catch {
    return false;
  }
}

/**
 * Start a connection: mint a state bound to the installing user, their
 * company and the integration, and return the authorize URL carrying it.
 * Null when the state could not be stored — a connection that cannot be
 * verified at the callback is not started.
 */
export async function createOnshapeAuthorizeUrl({
  clientId,
  redirectUrl,
  ...binding
}: OnshapeOAuthStateBinding & {
  clientId: string;
  redirectUrl: string;
}): Promise<string | null> {
  const state = crypto.randomUUID();
  const stored = await redis.set(
    oauthStateKey(state),
    JSON.stringify(binding),
    "EX",
    OAUTH_STATE_TTL_SECONDS
  );
  if (stored !== "OK") return null;
  return buildOnshapeAuthorizeUrl(clientId, redirectUrl, state);
}

/**
 * The Onshape authorize URL for an integration's redirect URI.
 *
 * Read for models/revisions/documents; Write to create translation (GLTF/PDF
 * export) jobs and manage the release webhook subscription. Both scopes must be
 * granted to the OAuth application in the Onshape dev portal, or Onshape
 * refuses the authorization and redirects back with `error` instead of `code`.
 *
 * The scope is appended outside URLSearchParams so the delimiter is `%20`: RFC
 * 6749 scope is space-delimited, and URLSearchParams serializes a space as `+`,
 * which only means "space" under form-encoding rules a query string doesn't
 * guarantee.
 */
function buildOnshapeAuthorizeUrl(
  clientId: string,
  redirectUrl: string,
  state: string
) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUrl,
    response_type: "code",
    state
  });
  const scope = ["OAuth2Read", "OAuth2Write"].join("%20");
  return `https://oauth.onshape.com/oauth/authorize?${params}&scope=${scope}`;
}
