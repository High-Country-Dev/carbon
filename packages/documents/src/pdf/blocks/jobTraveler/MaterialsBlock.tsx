// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Text, View } from "@react-pdf/renderer";
import { tw } from "./tw";
import type { JobTravelerData } from "./types";

// Shared column widths so the header and body rows can never drift out of
// alignment. They sum to 12/12; spacing between columns comes from in-cell
// right padding (pr-4) rather than a flex gap, which previously pushed the
// total width past 100% and made long item ids overlap the description.
// LAND-295 (ABS pull list): Bin and Pulled columns, so the shop can pull from it.
const COL_ITEM = "w-4/12 text-left pr-4";
const COL_DESCRIPTION = "w-3/12 text-left pr-4";
const COL_BIN = "w-2/12 text-left pr-4";
const COL_QUANTITY = "w-2/12 text-right pr-4";
const COL_PULLED = "w-1/12 text-center";

/**
 * Opt-in Bill of Materials table (item, description, bin, quantity, a Pulled box) — the pull list.
 * Rendered only when the company setting `includeMaterialsOnTraveler` is on and
 * the make method has materials — see JobTravelerPageContent.
 *
 * Page breaks: each row is unbreakable (`wrap={false}`), and the table header is
 * bound to the first row so it can never be orphaned at the bottom of a page.
 * Remaining rows flow naturally, so a long BOM still expands across pages.
 */
export function MaterialsBlock({ data }: { data: JobTravelerData }) {
  const materials = data.materials ?? [];
  if (materials.length === 0) return null;

  const header = (
    <View
      style={tw(
        "flex flex-row justify-between items-center py-3 px-[6px] border-t border-b border-gray-300 font-bold uppercase"
      )}
    >
      <Text style={tw(COL_ITEM)}>Item</Text>
      <Text style={tw(COL_DESCRIPTION)}>Description</Text>
      <Text style={tw(COL_BIN)}>Bin</Text>
      <Text style={tw(COL_QUANTITY)}>Quantity</Text>
      <Text style={tw(COL_PULLED)}>Pulled</Text>
    </View>
  );

  return (
    <View style={tw("mb-6 text-xs")}>
      {materials.map((material, index) => {
        const cells = (
          <>
            <Text style={tw(`${COL_ITEM} font-bold`)}>
              {material.itemReadableId ?? ""}
            </Text>
            <Text style={tw(COL_DESCRIPTION)}>{material.description}</Text>
            <Text style={tw(COL_BIN)}>{material.storageUnitName ?? ""}</Text>
            <Text style={tw(COL_QUANTITY)}>
              {material.quantity}
              {material.unitOfMeasureCode
                ? ` ${material.unitOfMeasureCode}`
                : ""}
            </Text>
            <View style={tw(`${COL_PULLED} items-center`)}>
              <View style={tw("w-3 h-3 border border-gray-500")} />
            </View>
          </>
        );

        const row = (
          <View
            style={tw(
              "flex flex-row justify-between items-start border-b border-gray-300 py-3 px-[6px]"
            )}
            wrap={false}
          >
            {cells}
          </View>
        );

        // Keep the header attached to the first row so it never lands alone at
        // the bottom of a page. `minPresenceAhead` pushes the pair to the next
        // page when there isn't room for it plus a little of the table.
        if (index === 0) {
          return (
            <View key={material.id} wrap={false} minPresenceAhead={80}>
              {header}
              {row}
            </View>
          );
        }

        return <View key={material.id}>{row}</View>;
      })}
    </View>
  );
}
