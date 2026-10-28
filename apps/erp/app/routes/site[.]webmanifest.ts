// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { siteWebManifestResponse } from "@carbon/utils/favicon";

// The PWA manifest, built from BRAND_NAME (see siteWebManifestResponse).
export function loader() {
  return siteWebManifestResponse("ERP");
}
