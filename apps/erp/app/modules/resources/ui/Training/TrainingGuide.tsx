// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import { safeStorageFileName, storage } from "@carbon/files";
import { useAction } from "@carbon/query";
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  File as FileButton,
  HStack,
  Skeleton,
  toast
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { nanoid } from "nanoid";
import type { ChangeEvent } from "react";
import { lazy, Suspense, useState } from "react";
import { LuFileText, LuTrash, LuUpload } from "react-icons/lu";
import { FileDropzone } from "~/components";
import { Confirm } from "~/components/Modals";
import { useUser } from "~/hooks";
import type { action } from "~/routes/x+/training+/update";
import { getPrivateUrl, path } from "~/utils/path";
import { trainingGuideKeyPrefix } from "../../resources.models";

const PdfViewer = lazy(
  () => import("~/modules/documents/ui/Documents/PdfViewer")
);

type TrainingGuideProps = {
  trainingId: string;
  guidePath: string | null;
  canEdit: boolean;
};

export function TrainingGuideViewer({ guidePath }: { guidePath: string }) {
  return (
    <div className="w-full overflow-x-auto rounded-lg border border-border bg-background">
      <Suspense fallback={<Skeleton className="h-120 w-full" />}>
        <PdfViewer file={getPrivateUrl(guidePath)} />
      </Suspense>
    </div>
  );
}

const TrainingGuide = ({
  trainingId,
  guidePath,
  canEdit
}: TrainingGuideProps) => {
  const { t } = useLingui();
  const { carbon } = useCarbon();
  const { company } = useUser();
  const [isUploading, setIsUploading] = useState(false);
  const [isRemoveOpen, setIsRemoveOpen] = useState(false);

  const fetcher = useAction<typeof action>({
    onError: (data) => {
      if (data?.error) toast.error(data.error.message);
    }
  });
  const isBusy = isUploading || fetcher.state !== "idle";

  const upload = async (file: File | undefined) => {
    if (!file || !carbon) return;

    const name = safeStorageFileName(file.name) ?? "guide.pdf";
    const fileName = name.toLowerCase().endsWith(".pdf") ? name : `${name}.pdf`;

    setIsUploading(true);
    const key = `${trainingGuideKeyPrefix(company.id, trainingId)}${nanoid()}/${fileName}`;
    const result = await storage(carbon).company(company.id).upload(key, file);
    setIsUploading(false);

    if (result.error) {
      toast.error(t`Failed to upload PDF`);
      return;
    }

    const formData = new FormData();
    formData.append("ids", trainingId);
    formData.append("field", "guidePath");
    formData.append("value", result.data.path);
    fetcher.submit(formData, {
      method: "post",
      action: path.to.bulkUpdateTraining
    });
  };

  const fileName = guidePath?.split("/").pop();

  return (
    <Card>
      <HStack className="w-full justify-between items-start">
        <CardHeader>
          <CardTitle>
            <Trans>PDF Guide</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>Employees read it before the questions</Trans>
          </CardDescription>
        </CardHeader>
        {guidePath && (
          <CardAction>
            <HStack spacing={2}>
              <FileButton
                accept="application/pdf"
                variant="secondary"
                leftIcon={<LuUpload />}
                isDisabled={!canEdit || isBusy}
                onChange={async (e: ChangeEvent<HTMLInputElement>) => {
                  await upload(e.target.files?.[0]);
                }}
              >
                <Trans>Replace</Trans>
              </FileButton>
              <Button
                variant="secondary"
                leftIcon={<LuTrash />}
                isDisabled={!canEdit || isBusy}
                onClick={() => setIsRemoveOpen(true)}
              >
                <Trans>Remove</Trans>
              </Button>
            </HStack>
          </CardAction>
        )}
      </HStack>
      <CardContent>
        {guidePath ? (
          <div className="flex flex-col gap-3 w-full">
            <HStack spacing={2} className="text-sm min-w-0">
              <LuFileText className="shrink-0 text-muted-foreground" />
              <span className="truncate">{fileName}</span>
            </HStack>
            <TrainingGuideViewer guidePath={guidePath} />
          </div>
        ) : canEdit ? (
          <FileDropzone
            onDrop={(files) => upload(files[0])}
            accept={{ "application/pdf": [".pdf"] }}
            multiple={false}
            disabled={isBusy}
            className="mt-0"
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            <Trans>No PDF guide</Trans>
          </p>
        )}
      </CardContent>
      {isRemoveOpen && (
        <Confirm
          action={path.to.bulkUpdateTraining}
          title={t`Remove PDF Guide`}
          text={t`Employees will no longer see this PDF. You can upload a new one while the training is Draft.`}
          confirmText={t`Remove`}
          confirmVariant="destructive"
          onCancel={() => setIsRemoveOpen(false)}
          onSubmit={() => setIsRemoveOpen(false)}
        >
          <input type="hidden" name="ids" value={trainingId} />
          <input type="hidden" name="field" value="guidePath" />
          <input type="hidden" name="value" value="" />
        </Confirm>
      )}
    </Card>
  );
};

export default TrainingGuide;
