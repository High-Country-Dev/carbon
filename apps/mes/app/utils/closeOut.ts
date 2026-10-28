// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Close-out rules for the Operation view: what an operator must answer when they
 * stop a timer, and which procedure steps block finishing. Pure, so the stop
 * button, the close-out modal and the server routes all apply the same rule.
 */

type WorkType = "Setup" | "Labor" | "Machine";

type StepRecordValues = {
  value: string | null;
  numericValue: number | null;
  booleanValue: boolean | null;
  userValue: string | null;
};

type ProcedureStep = {
  name: string;
  required: boolean | null;
  jobOperationStepRecord: StepRecordValues[] | null;
};

/**
 * Stopping a Labor or Machine timer on a single operation asks the close-out
 * questions. Setup makes no parts, so it stops at once; a batch closes out in
 * its own completion grid.
 */
export function requiresCloseOut({
  type,
  isBatched
}: {
  type: WorkType;
  isBatched: boolean;
}) {
  return type !== "Setup" && !isBatched;
}

function hasRecordedValue(record: StepRecordValues) {
  return (
    record.value !== null ||
    record.numericValue !== null ||
    record.booleanValue !== null ||
    record.userValue !== null
  );
}

/** The required steps with no recorded value, in their listed order. */
export function missingRequiredSteps<T extends ProcedureStep>(steps: T[]) {
  return steps.filter(
    (step) =>
      step.required === true &&
      !(step.jobOperationStepRecord ?? []).some(hasRecordedValue)
  );
}
