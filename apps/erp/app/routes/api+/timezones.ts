// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { cachedClientLoader, RefreshRate } from "@carbon/query/cache";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getCachedTimezoneNames } from "~/modules/shared/shared.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {});
  const result = await getCachedTimezoneNames(client);
  if (!result.data?.length) return data(result);
  // The same list for every company, and it only changes with the database's
  // tzdata: the browser keeps it across page loads as long as the server does.
  return data(result, {
    headers: { "Cache-Control": "private, max-age=86400" }
  });
}

export const clientLoader = cachedClientLoader<typeof loader>({
  staleTime: RefreshRate.Never
});
