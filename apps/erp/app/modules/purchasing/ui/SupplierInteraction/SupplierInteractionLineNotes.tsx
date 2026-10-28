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
import { useState } from "react";
import NotesSections from "~/components/NotesSections";
import { useImageUpload, usePermissions, useUser } from "~/hooks";

const SupplierInteractionLineNotes = ({
  id,
  table,
  title,
  subTitle,
  isReadOnly,
  internalNotes: initialInternalNotes,
  externalNotes: initialExternalNotes
}: {
  id: string | null;
  table:
    | "purchasingRfqLine"
    | "supplierQuoteLine"
    | "purchaseOrderLine"
    | "purchaseInvoiceLine";
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
  const [internalNotes, setInternalNotes] = useState(
    initialInternalNotes ?? {}
  );
  const [externalNotes, setExternalNotes] = useState(
    initialExternalNotes ?? {}
  );

  const onUploadImage = useImageUpload(`supplier-interaction/${id}`);

  const onUpdateExternalNotes = useDebounce(
    async (content: JSONContent) => {
      await carbon
        ?.from(table as "purchaseOrderLine")
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
        ?.from(table as "purchaseOrderLine")
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

  const showExternal = [
    "purchasingRfqLine",
    "supplierQuoteLine",
    "purchaseOrderLine"
  ].includes(table);

  if (!id) return null;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {subTitle && <CardDescription>{subTitle}</CardDescription>}
        </CardHeader>
        <CardContent>
          <NotesSections
            isEditable={!isReadOnly && permissions.can("update", "purchasing")}
            onUploadImage={onUploadImage}
            external={
              showExternal
                ? {
                    content: externalNotes as JSONContent,
                    onChange: (value) => {
                      setExternalNotes(value);
                      onUpdateExternalNotes(value);
                    }
                  }
                : undefined
            }
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

export default SupplierInteractionLineNotes;
