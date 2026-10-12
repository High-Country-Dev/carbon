// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The storage unit where a tracked entity currently holds stock, derived from
// its item-ledger rows by net on-hand per bin.
//
// A picked entity has ledger rows in BOTH its source and lineside bins;
// consumption/split entries must be booked against the bin that actually holds
// the stock (the lineside bin after a pick), NOT an arbitrary row. Selecting
// `.find(...)?.storageUnitId` off a `createdBy`-ordered list grabs a wrong bin
// and produces a per-bin-negative ledger. Returns the bin with the highest
// positive net; falls back to any bin the entity appears in when nothing nets
// positive.

export type BinLedgerRow = {
  trackedEntityId: string | null;
  storageUnitId: string | null;
  quantity: number | string | null;
};

export function resolveTrackedEntityBin(
  ledgers: BinLedgerRow[],
  trackedEntityId: string
): string | null {
  const netByBin = new Map<string, number>();
  for (const l of ledgers) {
    if (l.trackedEntityId !== trackedEntityId || !l.storageUnitId) continue;
    netByBin.set(
      l.storageUnitId,
      (netByBin.get(l.storageUnitId) ?? 0) + Number(l.quantity ?? 0)
    );
  }
  let bestBin: string | null = null;
  let bestQty = 0;
  for (const [bin, qty] of netByBin) {
    if (qty > bestQty) {
      bestQty = qty;
      bestBin = bin;
    }
  }
  if (bestBin) return bestBin;
  return (
    ledgers.find(
      (l) => l.trackedEntityId === trackedEntityId && l.storageUnitId
    )?.storageUnitId ?? null
  );
}

// The bin each tracked entity holds stock in. Unlike `resolveTrackedEntityBin`,
// the unassigned bin (`null`) counts: a unit moved into "no storage unit" must
// not resolve back to the named bin it left. An entity with no positive bin is
// absent, so the caller decides what "no stock anywhere" means.
export function resolveTrackedEntityBins(
  ledgers: BinLedgerRow[]
): Map<string, string | null> {
  const netByEntityBin = new Map<string, Map<string | null, number>>();
  for (const l of ledgers) {
    if (!l.trackedEntityId) continue;
    const bins = netByEntityBin.get(l.trackedEntityId) ?? new Map();
    bins.set(
      l.storageUnitId,
      (bins.get(l.storageUnitId) ?? 0) + Number(l.quantity ?? 0)
    );
    netByEntityBin.set(l.trackedEntityId, bins);
  }

  const result = new Map<string, string | null>();
  for (const [trackedEntityId, bins] of netByEntityBin) {
    let bestQty = 0;
    for (const [bin, qty] of bins) {
      if (qty > bestQty) {
        bestQty = qty;
        result.set(trackedEntityId, bin);
      }
    }
  }
  return result;
}
