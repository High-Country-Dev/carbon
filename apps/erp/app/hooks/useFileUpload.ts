import { useCarbon } from "@carbon/auth";
import { DuplicateFileNameError, MediaUploader } from "@carbon/files/media";
import { toast } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useCallback, useMemo, useState } from "react";
import { useUser } from "./useUser";

export type FileUploadOptions = {
  /** Storage path for one prepared file (HEIC already converted to .jpg). */
  getPath?: (file: File) => string;
  /** Runs per successfully stored file — create the record, toast, etc. */
  onSuccess?: (file: File, path: string) => void | Promise<void>;
  /** Runs per failed file, after the error toast. */
  onError?: (file: File) => void;
};

/**
 * The one private-bucket upload mutation for document panels: prepare the
 * files (HEIC → JPEG, duplicate-name refusal), store each one, surface
 * failures. Panels supply only what differs — the path and what a stored file
 * means — either once at the hook (the common case) or per call when a
 * variable like the target bucket only exists at call time. Every upload path
 * goes through here or FileDropzone, so "HEIC is never stored" holds without
 * each panel remembering to convert.
 *
 * Shaped like a TanStack mutation: options at the hook, per-call overrides,
 * and an `isUploading` flag for pending UI.
 */
export function useFileUpload(options: FileUploadOptions = {}) {
  const { carbon } = useCarbon();
  const { company } = useUser();
  const { t } = useLingui();
  const [isUploading, setIsUploading] = useState(false);

  const uploader = useMemo(
    () =>
      carbon
        ? new MediaUploader(carbon, {
            bucket: "private",
            directory: `${company.id}/tmp`
          })
        : null,
    [carbon, company.id]
  );

  const upload = useCallback(
    async (files: File[], overrides: FileUploadOptions = {}) => {
      const { getPath, onSuccess, onError } = { ...options, ...overrides };
      if (!getPath) throw new Error("useFileUpload requires getPath");
      if (!carbon || !uploader) {
        toast.error(t`Carbon client not available`);
        return;
      }

      setIsUploading(true);
      try {
        let prepared: File[];
        try {
          prepared = await uploader.prepareForUpload(files);
        } catch (error) {
          toast.error(
            error instanceof DuplicateFileNameError
              ? t`Duplicate file names after image conversion`
              : t`Failed to convert image`
          );
          return;
        }

        for (const file of prepared) {
          toast.info(t`Uploading ${file.name}`);
          const result = await carbon.storage
            .from("private")
            .upload(getPath(file), file, {
              cacheControl: `${12 * 60 * 60}`,
              upsert: true
            });

          if (result.error || !result.data?.path) {
            toast.error(t`Failed to upload file: ${file.name}`);
            onError?.(file);
            continue;
          }
          await onSuccess?.(file, result.data.path);
        }
      } finally {
        setIsUploading(false);
      }
    },
    // options fields are listed individually so callers may pass an inline object
    [carbon, uploader, t, options.getPath, options.onSuccess, options.onError]
  );

  return { upload, isUploading };
}
