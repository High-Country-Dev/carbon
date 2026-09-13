import { ONSHAPE_V2_OAUTH_REDIRECT_URL } from "@carbon/auth";
import { ONSHAPE_V2_INTEGRATION_ID } from "@carbon/ee/onshape";
import type { LoaderFunctionArgs } from "react-router";
import { handleOnshapeOAuthCallback } from "~/modules/settings/onshape-oauth.server";

export const config = {
  runtime: "nodejs"
};

/**
 * The panel integration's own OAuth callback. Register this URL alongside the
 * v1 one on the same Onshape application — the two integrations hold separate
 * grants so either can be uninstalled without disturbing the other.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  return handleOnshapeOAuthCallback({
    request,
    integrationId: ONSHAPE_V2_INTEGRATION_ID,
    redirectUrl: ONSHAPE_V2_OAUTH_REDIRECT_URL
  });
}
