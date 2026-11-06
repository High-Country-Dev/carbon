// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Status } from "@carbon/react";
import { PURCHASE_ORDER_STATUS_COLOR_MAP } from "@carbon/utils";
import type { purchaseOrderStatusType } from "~/modules/purchasing/purchasing.models";

type PurchasingStatusProps = {
  status?: (typeof purchaseOrderStatusType)[number] | null;
  /** The status as its icon alone, with the name in a tooltip. */
  iconOnly?: boolean;
};

// What ABS calls each step. "Invoice" here is the vendor's bill, but ABS read
// "To Receive and Invoice" as invoicing the customer (Pam, 11/6), so the
// badge says "Bill". Only the words change: the stored status, filters and
// the Invoice button stay as they are.
const STATUS_LABELS: Partial<
  Record<(typeof purchaseOrderStatusType)[number], string>
> = {
  "To Invoice": "To Bill",
  "To Receive and Invoice": "To Receive and Bill"
};

const PurchasingStatus = ({ status, iconOnly }: PurchasingStatusProps) => {
  if (!status) return null;
  // Every status renders the same way; only its colour differs. An unknown
  // status (none today) has no colour and renders nothing, as before.
  const color = PURCHASE_ORDER_STATUS_COLOR_MAP[status];
  if (!color) return null;
  return (
    <Status color={color} iconOnly={iconOnly}>
      {STATUS_LABELS[status] ?? status}
    </Status>
  );
};

export default PurchasingStatus;
