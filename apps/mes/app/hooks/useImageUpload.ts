import { useCarbon } from "@carbon/auth";
import { convertHeicToJpeg, isHeic } from "@carbon/files/media";
import { toast } from "@carbon/react";
import { nanoid } from "nanoid";
import { useCallback } from "react";
import { getPrivateUrl } from "~/utils/path";
import { useUser } from "./useUser";

/**
 * Shared editor/notes image-upload handler (mirror of the ERP hook). HEIC is
 * converted to JPEG before anything is stored; the file lands in the private
 * bucket under `{companyId}/{directory}/{nanoid}.{ext}` and the preview URL
 * is returned for the editor to embed.
 */
export function useImageUpload(directory: string) {
  const { carbon } = useCarbon();
  const { company } = useUser();

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
          toast.error("Failed to convert image");
          throw error;
        }
      }

      const fileType = upload.name.split(".").pop();
      const fileName = `${company.id}/${directory}/${nanoid()}.${fileType}`;

      const result = await carbon.storage
        .from("private")
        .upload(fileName, upload);

      if (result.error) {
        toast.error("Failed to upload image");
        throw new Error(result.error.message);
      }

      if (!result.data) {
        throw new Error("Failed to upload image");
      }

      return getPrivateUrl(result.data.path);
    },
    [carbon, company.id, directory]
  );
}
