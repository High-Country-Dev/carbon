// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import type { JSONContent } from "@carbon/react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  useDebounce
} from "@carbon/react";
import { getLocalTimeZone, today } from "@internationalized/date";
import { Trans } from "@lingui/react/macro";
import { useState } from "react";
import NotesSections from "~/components/NotesSections";
import { useImageUpload, usePermissions, useUser } from "~/hooks";

const OpportunityLineNotes = ({
  id,
  table,
  title,
  subTitle,
  isReadOnly: isReadOnlyProp,
  internalNotes: initialInternalNotes,
  externalNotes: initialExternalNotes
}: {
  id: string | null;
  table: "salesRfqLine" | "quoteLine" | "salesOrderLine" | "salesInvoiceLine";
  title: string;
  subTitle: string;
  isReadOnly?: boolean;
  internalNotes?: JSONContent;
  externalNotes?: JSONContent;
}) => {
  const { id: userId } = useUser();
  const { carbon } = useCarbon();
  const permissions = usePermissions();
  const isEmployee = permissions.is("employee");
  const canEdit = !isReadOnlyProp && permissions.can("update", "sales");
  const [internalNotes, setInternalNotes] = useState(
    initialInternalNotes ?? {}
  );
  const [externalNotes, setExternalNotes] = useState(
    initialExternalNotes ?? {}
  );

  const onUploadImage = useImageUpload(`opportunity-line/${id}`);

  const onUpdateExternalNotes = useDebounce(
    async (content: JSONContent) => {
      await carbon
        ?.from(table)
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
        ?.from(table)
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
            <Trans>Notes</Trans>
          </CardTitle>
          <CardDescription>{subTitle}</CardDescription>
        </CardHeader>
        <CardContent>
          <NotesSections
            isEditable={canEdit}
            onUploadImage={onUploadImage}
            external={{
              content: externalNotes as JSONContent,
              onChange: (value) => {
                setExternalNotes(value);
                onUpdateExternalNotes(value);
              }
            }}
            internal={
              isEmployee
                ? {
                    content: internalNotes as JSONContent,
                    onChange: (value) => {
                      setInternalNotes(value);
                      onUpdateInternalNotes(value);
                    }
                  }
                : undefined
            }
          />
        </CardContent>
      </Card>
    </>
  );
};

export default OpportunityLineNotes;
