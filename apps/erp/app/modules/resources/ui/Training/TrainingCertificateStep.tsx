// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Alert, AlertDescription, AlertTitle, cn, VStack } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { useDropzone } from "react-dropzone";
import { LuCircleX, LuCloudUpload, LuFileCheck } from "react-icons/lu";
import {
  TRAINING_CERTIFICATE_MAX_BYTES,
  trainingCertificateAccept
} from "../../resources.models";

// The employee's certificate upload for an External training. It runs on the
// share page, outside the app shell, so it cannot use FileDropzone (that needs
// the signed-in storage client); the file is posted to the route action.
export default function TrainingCertificateStep({
  file,
  onFileChange,
  error,
  isDisabled
}: {
  file: File | null;
  onFileChange: (file: File | null) => void;
  error?: string;
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const [rejection, setRejection] = useState<string | null>(null);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: trainingCertificateAccept,
    multiple: false,
    maxSize: TRAINING_CERTIFICATE_MAX_BYTES,
    disabled: isDisabled,
    onDrop: (accepted, rejected) => {
      if (rejected.length > 0) {
        setRejection(t`Upload one PDF, PNG or JPG file of 10 MB or less.`);
        return;
      }
      setRejection(null);
      onFileChange(accepted[0] ?? null);
    }
  });

  const message = rejection ?? error;

  return (
    <VStack spacing={4} className="w-full">
      <p className="text-muted-foreground">
        <Trans>
          Upload the certificate you received for this training. Uploading it
          marks the training as complete.
        </Trans>
      </p>
      <div
        {...getRootProps()}
        className={cn(
          "w-full border-2 border-dashed rounded-md p-8 text-center transition-colors",
          isDisabled
            ? "cursor-not-allowed opacity-60"
            : "cursor-pointer hover:border-primary hover:bg-primary/10",
          isDragActive ? "border-primary bg-primary/10" : "border-border"
        )}
      >
        <input {...getInputProps()} />
        {file ? (
          <div className="flex flex-col items-center gap-2">
            <LuFileCheck className="size-10 text-emerald-500" />
            <span className="font-medium break-all">{file.name}</span>
            <span className="text-xs text-muted-foreground">
              <Trans>Click or drop to choose a different file</Trans>
            </span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <LuCloudUpload className="size-10 text-muted-foreground" />
            <span>
              <Trans>
                Drop your certificate here, or click to choose a file
              </Trans>
            </span>
            <span className="text-xs text-muted-foreground">
              <Trans>PDF, PNG or JPG, up to 10 MB</Trans>
            </span>
          </div>
        )}
      </div>
      {message && (
        <Alert variant="destructive">
          <LuCircleX className="h-4 w-4" />
          <AlertTitle>
            <Trans>Certificate not accepted</Trans>
          </AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}
    </VStack>
  );
}
