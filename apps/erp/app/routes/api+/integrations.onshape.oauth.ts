import { ONSHAPE_OAUTH_REDIRECT_URL } from "@carbon/auth";
import { ONSHAPE_INTEGRATION_ID } from "@carbon/ee/onshape";
import type { LoaderFunctionArgs } from "react-router";
import { handleOnshapeOAuthCallback } from "~/modules/settings/onshape-oauth.server";

export const config = {
  runtime: "nodejs"
};

export async function loader({ request }: LoaderFunctionArgs) {
  return handleOnshapeOAuthCallback({
    request,
    integrationId: ONSHAPE_INTEGRATION_ID,
    redirectUrl: ONSHAPE_OAUTH_REDIRECT_URL
  });
}
