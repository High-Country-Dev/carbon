// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { path } from "~/utils/path";

// Inventory Quantities filtered to one bin (its child bins included: the
// quantities loader expands the filter to descendants).
export function getStorageUnitContentsPath(
  storageUnitId: string,
  locationId?: string | null
) {
  const params = new URLSearchParams({
    filter: `storageUnitIds:contains:${storageUnitId}`
  });
  if (locationId) params.set("location", locationId);
  return `${path.to.inventory}?${params.toString()}`;
}
