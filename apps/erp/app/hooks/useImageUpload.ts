import { useCarbon } from "@carbon/auth";
import {
  convertHeicFiles,
  convertHeicToJpeg,
  isHeic
} from "@carbon/files/media";
import { toast } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { nanoid } from "nanoid";
import { useCallback } from "react";
import { getPrivateUrl } from "~/utils/path";
import { useUser } from "./useUser";

/**
 * HEIC guard for upload handlers fed by a raw `<input type="file">` (the
 * FileDropzone converts on its own). Returns the list with any HEIC files
 * converted to JPEG, or null after showing a toast when conversion fails —
 * callers must bail on null so a .heic is never stored.
 */
export function useHeicConversion() {
  const { carbon } = useCarbon();
  const { company } = useUser();
  const { t } = useLingui();

  return useCallback(
    async (files: File[]): Promise<File[] | null> => {
      if (!carbon || !files.some((file) => isHeic(file.name, file.type))) {
        return files;
      }
      try {
        return await convertHeicFiles(
          carbon,
          { bucket: "private", directory: `${company.id}/tmp` },
          files
        );
      } catch {
        toast.error(t`Failed to convert image`);
        return null;
      }
    },
    [carbon, company.id, t]
  );
}

/**
 * Shared editor/notes image-upload handler. HEIC is converted to JPEG before
 * anything is stored (HEIC is never persisted); the file lands in the private
 * bucket under `{companyId}/{directory}/{nanoid}.{ext}` and the preview URL
 * is returned for the editor to embed.
 */
export function useImageUpload(directory: string) {
  const { carbon } = useCarbon();
  const { company } = useUser();
  const { t } = useLingui();

  return useCallback(
    async (file: File) => {
      if (!carbon) throw new Error("Carbon client not found");

      let upload = file;
      if (isHeic(file.name, file.type)) {
        try {
          upload = await convertHeicToJpeg(carbon, {
            bucket: "private",
            directory: `${company.id}/tmp`,
            file
          });
        } catch (error) {
          toast.error(t`Failed to convert image`);
          throw error;
        }
      }

      const fileType = upload.name.split(".").pop();
      const fileName = `${company.id}/${directory}/${nanoid()}.${fileType}`;

      const result = await carbon.storage
        .from("private")
        .upload(fileName, upload);

      if (result.error) {
        toast.error(t`Failed to upload image`);
        throw new Error(result.error.message);
      }

      if (!result.data) {
        throw new Error("Failed to upload image");
      }

      return getPrivateUrl(result.data.path);
    },
    [carbon, company.id, directory, t]
  );
}
