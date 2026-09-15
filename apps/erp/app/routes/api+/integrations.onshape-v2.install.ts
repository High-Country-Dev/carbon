import { ONSHAPE_CLIENT_ID, ONSHAPE_V2_OAUTH_REDIRECT_URL } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { ONSHAPE_V2_INTEGRATION_ID } from "@carbon/ee/onshape";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { createOnshapeAuthorizeUrl } from "~/modules/settings/onshape-oauth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { userId, companyId } = await requirePermissions(request, {});

  if (!ONSHAPE_CLIENT_ID || !ONSHAPE_V2_OAUTH_REDIRECT_URL) {
    return data({ error: "Onshape OAuth not configured" }, { status: 500 });
  }

  const url = await createOnshapeAuthorizeUrl({
    clientId: ONSHAPE_CLIENT_ID,
    redirectUrl: ONSHAPE_V2_OAUTH_REDIRECT_URL,
    integrationId: ONSHAPE_V2_INTEGRATION_ID,
    userId,
    companyId
  });
  if (!url) {
    return data(
      { error: "Couldn't start the Onshape connection. Try again." },
      { status: 503 }
    );
  }

  return { url };
}
