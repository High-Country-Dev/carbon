import {
  Button,
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { useFetcher } from "react-router";
import { useNavigate } from "react-router";
import { path } from "~/utils/path";

// Offered right after a batch completion whose members produced 2+ lots of the
// SAME item: one click merges them into a single lot that still traces back to
// every member job.
//
// Rendered by JobOperation, not by BatchCompleteModal — completing the batch is
// exactly what makes the loader stop passing `batch`, which unmounts that modal.
// The fetcher is owned upstream for the same reason.
export function BatchMergePrompt({
  batchId,
  lotCount,
  fetcher
}: {
  batchId: string;
  lotCount: number;
  // Display only — the route re-derives which lots to merge from the batch's
  // own membership, so no id ever travels through the form.
  fetcher: ReturnType<typeof useFetcher>;
}) {
  const navigate = useNavigate();
  const isMerging = fetcher.state !== "idle";

  return (
    <Modal open>
      <ModalContent size="small" withCloseButton={false}>
        <ModalHeader>
          <ModalTitle>
            <Trans>Batch completed</Trans>
          </ModalTitle>
          <ModalDescription>
            <Trans>
              {lotCount} lots of the same item were produced. Merge them into
              one lot? The merged lot traces back to every job.
            </Trans>
          </ModalDescription>
        </ModalHeader>
        <ModalFooter>
          <Button
            variant="secondary"
            size="lg"
            isDisabled={isMerging}
            onClick={() => navigate(path.to.operations)}
          >
            <Trans>Keep separate</Trans>
          </Button>
          <Button
            size="lg"
            isLoading={isMerging}
            isDisabled={isMerging}
            onClick={() => {
              fetcher.submit(
                { intent: "merge" },
                { method: "post", action: path.to.batchComplete(batchId) }
              );
            }}
          >
            <Trans>Merge into one lot</Trans>
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
