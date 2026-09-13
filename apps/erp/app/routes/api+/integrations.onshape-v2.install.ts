import { ONSHAPE_CLIENT_ID, ONSHAPE_V2_OAUTH_REDIRECT_URL } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { buildOnshapeAuthorizeUrl } from "~/modules/settings/onshape-oauth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {});

  if (!ONSHAPE_CLIENT_ID || !ONSHAPE_V2_OAUTH_REDIRECT_URL) {
    return data({ error: "Onshape OAuth not configured" }, { status: 500 });
  }

  return {
    url: buildOnshapeAuthorizeUrl(
      ONSHAPE_CLIENT_ID,
      ONSHAPE_V2_OAUTH_REDIRECT_URL
    )
  };
}
