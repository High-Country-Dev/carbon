// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, useCarbon } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import type { JSONContent } from "@carbon/react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  isRichTextEmpty,
  RecordOutlet,
  RichTextView,
  useDebounce,
  VStack
} from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import { redirect } from "@carbon/utils";
import { getLocalTimeZone, today } from "@internationalized/date";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { PanelProvider, ResizablePanels } from "~/components/Layout/Panels";
import { useImageUpload, usePermissions, useUser } from "~/hooks";
import {
  getTraining,
  TrainingExplorer,
  TrainingGuide,
  TrainingHeader,
  TrainingProperties
} from "~/modules/resources";
import { getTagsList } from "~/modules/shared";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "training-detail");

export const handle: Handle = {
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Training`, to: path.to.trainings },
    (data) => data?.training?.name
  ),
  module: "resources"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "resources",
    bypassRls: true
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [training, tags] = await Promise.all([
    getTraining(client, id),
    getTagsList(client, companyId, "training")
  ]);

  if (training.error) {
    throw redirect(
      path.to.trainings,
      await flash(request, error(training.error, "Failed to load training"))
    );
  }

  // bypassRls makes `client` the service role, so the URL id is only proven to
  // exist — not to be this company's.
  if (training.data.companyId !== companyId) {
    logger.error("Training is not in the caller's company", {
      companyId,
      trainingId: id
    });
    throw redirect(path.to.trainings);
  }

  return {
    training: training.data,
    tags: tags.data ?? []
  };
}

export default function TrainingRoute() {
  const { t } = useLingui();
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const { training } = useLoaderData<typeof loader>();
  const permissions = usePermissions();
  const canEditGuide =
    permissions.can("update", "people") && training.status === "Draft";

  return (
    <PanelProvider key={id}>
      <div className="flex flex-col h-[calc(100dvh-var(--topbar-height)-var(--content-inset))] overflow-hidden w-full">
        <TrainingHeader />
        <div className="flex h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] overflow-hidden w-full">
          <div className="flex flex-grow overflow-hidden">
            <ResizablePanels
              explorerLabel={t`Questions`}
              explorer={<TrainingExplorer key={`explorer-${id}`} />}
              content={
                <div className="bg-card h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
                  <VStack spacing={4} className="p-4">
                    <TrainingGuide
                      key={`guide-${id}`}
                      trainingId={id}
                      guidePath={training.guidePath}
                      canEdit={canEditGuide}
                    />
                    <TrainingContent key={`content-${id}`} />
                    <RecordOutlet />
                  </VStack>
                </div>
              }
              properties={<TrainingProperties key={`properties-${id}`} />}
            />
          </div>
        </div>
      </div>
    </PanelProvider>
  );
}

function TrainingContent() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const permissions = usePermissions();
  const loaderData = useLoaderData<typeof loader>();

  const [content, setContent] = useState<JSONContent>(
    (loaderData?.training?.content ?? {}) as JSONContent
  );

  const { carbon } = useCarbon();
  const { id: userId } = useUser();

  const updateTraining = useDebounce(
    async (content: JSONContent) => {
      await carbon
        ?.from("training")
        .update({
          content: content ?? {},
          updatedAt: today(getLocalTimeZone()).toString(),
          updatedBy: userId
        })
        .eq("id", id!);
    },
    500,
    true
  );

  const onUploadImage = useImageUpload("training");

  const canEdit =
    permissions.can("update", "people") &&
    loaderData?.training?.status === "Draft";

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Content</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>Shown to employees below the PDF guide</Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className={canEdit ? "p-0 overflow-hidden" : undefined}>
        {canEdit ? (
          // Flush toolbar: pad the text, not the panel.
          <Editor
            toolbar
            toolbarClassName="static bg-transparent px-4"
            className="w-full [&_.ProseMirror]:min-h-[240px] [&_.ProseMirror]:px-6 [&_.ProseMirror]:py-4 max-md:[&_.ProseMirror]:px-4"
            initialValue={content}
            onUpload={onUploadImage}
            onChange={(value) => {
              setContent(value);
              updateTraining(value);
            }}
          />
        ) : // RichTextView shows its empty text on phones only, so say it here.
        isRichTextEmpty(content) ? (
          <p className="text-sm text-muted-foreground">
            <Trans>No content</Trans>
          </p>
        ) : (
          <RichTextView
            content={content}
            empty={<Trans>No content</Trans>}
            className="prose dark:prose-invert max-w-none"
          />
        )}
      </CardContent>
    </Card>
  );
}
