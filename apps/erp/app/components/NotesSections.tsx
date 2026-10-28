// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { JSONContent } from "@carbon/react";
import { RichTextView, VStack } from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";

type NotesSection = {
  content: JSONContent;
  onChange: (value: JSONContent) => void;
};

/**
 * External and internal notes shown together, one under the other, instead
 * of behind an Internal/External toggle. Leave a section out to hide it
 * (internal notes from people outside the company, external notes on records
 * that don't send any).
 */
export default function NotesSections({
  external,
  internal,
  isEditable,
  onUploadImage
}: {
  external?: NotesSection;
  internal?: NotesSection;
  isEditable: boolean;
  onUploadImage: (file: File) => Promise<string>;
}) {
  return (
    <VStack spacing={4} className="w-full">
      {external && (
        <Section
          title={<Trans>External notes</Trans>}
          empty={<Trans>No external notes</Trans>}
          section={external}
          isEditable={isEditable}
          onUploadImage={onUploadImage}
        />
      )}
      {internal && (
        <Section
          title={<Trans>Internal notes</Trans>}
          empty={<Trans>No internal notes</Trans>}
          section={internal}
          isEditable={isEditable}
          onUploadImage={onUploadImage}
        />
      )}
    </VStack>
  );
}

function Section({
  title,
  empty,
  section,
  isEditable,
  onUploadImage
}: {
  title: ReactNode;
  empty: ReactNode;
  section: NotesSection;
  isEditable: boolean;
  onUploadImage: (file: File) => Promise<string>;
}) {
  return (
    <section className="w-full">
      <h3 className="text-sm font-medium text-muted-foreground mb-2">
        {title}
      </h3>
      {isEditable ? (
        <Editor
          initialValue={(section.content ?? {}) as JSONContent}
          onUpload={onUploadImage}
          onChange={section.onChange}
        />
      ) : (
        <RichTextView content={section.content} empty={empty} />
      )}
    </section>
  );
}
