// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import type { JSONContent } from "@carbon/react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  useDebounce
} from "@carbon/react";
import { getLocalTimeZone, today } from "@internationalized/date";
import { Trans } from "@lingui/react/macro";
import { useState } from "react";
import NotesSections from "~/components/NotesSections";
import { useImageUpload, usePermissions, useUser } from "~/hooks";

const ShipmentNotes = ({
  id,
  internalNotes: initialInternalNotes,
  externalNotes: initialExternalNotes
}: {
  id: string | null;
  internalNotes?: JSONContent;
  externalNotes?: JSONContent;
}) => {
  const { id: userId } = useUser();
  const { carbon } = useCarbon();
  const permissions = usePermissions();
  const [internalNotes, setInternalNotes] = useState(
    initialInternalNotes ?? {}
  );
  const [externalNotes, setExternalNotes] = useState(
    initialExternalNotes ?? {}
  );

  const onUploadImage = useImageUpload(`inventory/${id}`);

  const onUpdateExternalNotes = useDebounce(
    async (content: JSONContent) => {
      await carbon
        ?.from("shipment")
        .update({
          externalNotes: content,
          updatedAt: today(getLocalTimeZone()).toString(),
          updatedBy: userId
        })
        .eq("id", id!);
    },
    2500,
    true
  );

  const onUpdateInternalNotes = useDebounce(
    async (content: JSONContent) => {
      await carbon
        ?.from("shipment")
        .update({
          internalNotes: content,
          updatedAt: today(getLocalTimeZone()).toString(),
          updatedBy: userId
        })
        .eq("id", id!);
    },
    2500,
    true
  );

  if (!id) return null;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Shipping Notes</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <NotesSections
            isEditable={permissions.can("update", "inventory")}
            onUploadImage={onUploadImage}
            external={{
              content: externalNotes as JSONContent,
              onChange: (value) => {
                setExternalNotes(value);
                onUpdateExternalNotes(value);
              }
            }}
            internal={{
              content: internalNotes as JSONContent,
              onChange: (value) => {
                setInternalNotes(value);
                onUpdateInternalNotes(value);
              }
            }}
          />
        </CardContent>
      </Card>
    </>
  );
};

export default ShipmentNotes;
