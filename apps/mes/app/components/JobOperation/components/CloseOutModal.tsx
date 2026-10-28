// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Hidden,
  NumberControlled,
  TextArea,
  ValidatedForm
} from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  cn,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ToggleGroup,
  ToggleGroupItem
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useState } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import { closeOutValidator } from "~/services/models";
import type { OperationWithDetails, ProductionEvent } from "~/services/types";
import { OriginInput } from "~/utils/origin";
import { path } from "~/utils/path";
import { QUANTITY_FORMAT_OPTIONS } from "./QuantityModal";
import ScrapReason from "./ScrapReason";

type Scrapped = "yes" | "no";
type Outcome = "finished" | "inProgress";

/**
 * Asked when an operator stops a Labor or Machine timer (see utils/closeOut.ts).
 * Two required answers — was anything scrapped, and is the operation finished —
 * before the time is logged. Cancel keeps the timer running. On phones the
 * Modal is a bottom sheet with a sticky footer, so both answers and the stop
 * button stay within thumb reach.
 */
export function CloseOutModal({
  eventType,
  event,
  operation,
  setupProductionEvent,
  laborProductionEvent,
  machineProductionEvent,
  parentIsSerial,
  parentIsBatch,
  trackedEntityId,
  trackedEntityReadableId,
  missingSteps,
  onReviewSteps,
  onClose
}: {
  eventType: "Labor" | "Machine";
  event: ProductionEvent;
  operation: OperationWithDetails;
  setupProductionEvent: ProductionEvent | undefined;
  laborProductionEvent: ProductionEvent | undefined;
  machineProductionEvent: ProductionEvent | undefined;
  parentIsSerial: boolean;
  parentIsBatch: boolean;
  trackedEntityId: string;
  trackedEntityReadableId?: string;
  /** Names of required steps with nothing recorded; finishing waits on them. */
  missingSteps: string[];
  onReviewSteps: () => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const [scrapped, setScrapped] = useState<Scrapped | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [scrapQuantity, setScrapQuantity] = useState(parentIsSerial ? 1 : 0);

  // A refusal answers `closedOut: false` and its flash says why, so the modal
  // stays open with the answers kept. A stop answers `closedOut: true`; a
  // stop that also finished redirects, with no data.
  const fetcher = useAction<{ closedOut: boolean }>({
    onSettled: (data) => {
      if (!data || ("closedOut" in data && data.closedOut)) onClose();
    }
  });
  const isSubmitting = fetcher.state !== "idle";

  const workType = eventType === "Labor" ? t`labor` : t`machine`;
  const targetQuantity =
    operation.targetQuantity ?? operation.operationQuantity ?? 0;
  const finishing = outcome === "finished";
  const stepsBlockFinish = finishing && missingSteps.length > 0;
  const scrapIncomplete = scrapped === "yes" && !(scrapQuantity > 0);
  const canSubmit =
    scrapped !== null &&
    outcome !== null &&
    !stepsBlockFinish &&
    !scrapIncomplete;

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ValidatedForm
          action={path.to.closeOut}
          method="post"
          validator={closeOutValidator}
          defaultValues={{
            id: event.id,
            jobOperationId: operation.id,
            type: eventType
          }}
          fetcher={fetcher}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Stop {workType} timer</Trans>
            </ModalTitle>
            <ModalDescription>
              <Trans>
                Answer both questions to log your time on{" "}
                {operation.itemReadableId}.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Hidden name="id" value={event.id} />
            <Hidden name="jobOperationId" value={operation.id} />
            <Hidden name="type" value={eventType} />
            <Hidden
              name="trackedEntityId"
              value={
                parentIsSerial || parentIsBatch ? trackedEntityId : undefined
              }
            />
            <Hidden
              name="trackingType"
              value={
                parentIsSerial ? "Serial" : parentIsBatch ? "Batch" : undefined
              }
            />
            <Hidden
              name="setupProductionEventId"
              value={setupProductionEvent?.id}
            />
            <Hidden
              name="laborProductionEventId"
              value={laborProductionEvent?.id}
            />
            <Hidden
              name="machineProductionEventId"
              value={machineProductionEvent?.id}
            />
            <Hidden name="scrapped" value={scrapped ?? undefined} />
            <Hidden name="outcome" value={outcome ?? undefined} />
            <OriginInput />

            <div className="flex w-full flex-col gap-5">
              <Question label={t`Did you scrap anything?`}>
                <AnswerToggle
                  value={scrapped}
                  onChange={(value) => setScrapped(value as Scrapped)}
                  options={[
                    { value: "no", label: t`No scrap` },
                    { value: "yes", label: t`Yes, log scrap` }
                  ]}
                />
                {scrapped === "yes" && (
                  <div className="flex w-full flex-col gap-3">
                    {parentIsSerial && (
                      <Alert>
                        <LuTriangleAlert className="h-4 w-4" />
                        <AlertTitle>
                          {trackedEntityReadableId ? (
                            <Trans>
                              Scrapping serial {trackedEntityReadableId}
                            </Trans>
                          ) : (
                            <Trans>Scrapping the selected serial</Trans>
                          )}
                        </AlertTitle>
                        <AlertDescription>
                          <Trans>
                            A replacement serial number will be created.
                          </Trans>
                        </AlertDescription>
                      </Alert>
                    )}
                    {/* Quantity is short; on wider screens it sits beside the
                        reason to keep the sheet low. */}
                    <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
                      <NumberControlled
                        name="scrapQuantity"
                        label={t`Quantity`}
                        value={scrapQuantity}
                        onChange={setScrapQuantity}
                        isReadOnly={parentIsSerial}
                        minValue={0}
                        formatOptions={QUANTITY_FORMAT_OPTIONS}
                        size="lg"
                      />
                      <ScrapReason
                        name="scrapReasonId"
                        label={t`Scrap Reason`}
                        size="lg"
                      />
                    </div>
                    <TextArea label={t`Notes`} name="notes" />
                  </div>
                )}
              </Question>

              <Question label={t`Is this operation finished?`}>
                <AnswerToggle
                  value={outcome}
                  onChange={(value) => setOutcome(value as Outcome)}
                  options={[
                    { value: "inProgress", label: t`Still in progress` },
                    { value: "finished", label: t`Finished` }
                  ]}
                />
                {stepsBlockFinish && (
                  <Alert variant="destructive">
                    <LuTriangleAlert className="h-4 w-4" />
                    <AlertTitle>
                      <Trans>Required steps are not recorded</Trans>
                    </AlertTitle>
                    <AlertDescription>
                      <p>{missingSteps.join(", ")}</p>
                      <Button
                        variant="secondary"
                        size="md"
                        className="mt-2"
                        onClick={onReviewSteps}
                      >
                        <Trans>Go to steps</Trans>
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}
                {finishing &&
                  !stepsBlockFinish &&
                  operation.quantityComplete < targetQuantity && (
                    <Alert>
                      <LuTriangleAlert className="h-4 w-4" />
                      <AlertTitle>
                        <Trans>
                          {operation.quantityComplete} of {targetQuantity}{" "}
                          completed
                        </Trans>
                      </AlertTitle>
                      <AlertDescription>
                        <Trans>
                          Finishing marks the operation done with fewer than
                          planned. Log completed parts first if you made more.
                        </Trans>
                      </AlertDescription>
                    </Alert>
                  )}
              </Question>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" size="lg" onClick={onClose}>
              <Trans>Keep running</Trans>
            </Button>
            <Button
              size="lg"
              type="submit"
              isLoading={isSubmitting}
              isDisabled={!canSubmit || isSubmitting}
            >
              {finishing ? (
                <Trans>Stop and finish</Trans>
              ) : (
                <Trans>Stop timer</Trans>
              )}
            </Button>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}

function Question({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="flex w-full flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      {children}
    </fieldset>
  );
}

// Two big answers side by side: a full-width, 56px-tall target on a phone.
function AnswerToggle({
  value,
  onChange,
  options
}: {
  value: string | null;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <ToggleGroup
      type="single"
      value={value ?? ""}
      // Radix lets a single toggle clear itself; an answer stays answered.
      onValueChange={(next) => {
        if (next) onChange(next);
      }}
      className="grid w-full grid-cols-2 gap-2"
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          size="lg"
          className={cn(
            "h-14 w-full rounded-lg border text-base font-medium",
            "data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
          )}
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
