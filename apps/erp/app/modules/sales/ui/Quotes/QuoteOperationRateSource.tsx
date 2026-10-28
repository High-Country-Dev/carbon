// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Json } from "@carbon/database";
import { Button } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { LuRotateCcw, LuTriangleAlert } from "react-icons/lu";
import { useCurrencyFormatter } from "~/hooks";
import { usePeople } from "~/stores";

export type OperationRate = "laborRate" | "machineRate" | "overheadRate";

type RateSource = {
  source: "Work Center" | "Process Average" | "Manual" | "Imported";
  at: string;
  by: string | null;
};

/** What a rate is measured against: the operation's work center, or the
 *  average of the process's active work centers when it has none. */
export type RateReference = {
  kind: "workCenter" | "processAverage";
  name: string | null;
  rates: Record<OperationRate, number>;
  ratesUpdatedAt: string | null;
};

const SHORT_DATE = { month: "short", day: "numeric", year: "numeric" } as const;

// Rates are stored to 4 places; below half a cent they're the same rate.
export function ratesDiffer(a: number, b: number) {
  return Math.abs(a - b) >= 0.005;
}

export function getRateSource(
  rateSources: Json | null | undefined,
  rate: OperationRate
): RateSource | null {
  if (!rateSources || typeof rateSources !== "object") return null;
  if (Array.isArray(rateSources)) return null;
  const entry = rateSources[rate];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const { source, at, by } = entry as Record<string, unknown>;
  if (typeof source !== "string" || typeof at !== "string") return null;
  return {
    source: source as RateSource["source"],
    at,
    by: typeof by === "string" ? by : null
  };
}

/**
 * The line under a rate on a quote operation: where the saved rate came from,
 * who set it and when, and, when it no longer matches its work center (or the
 * process average), what that is now with a button to reset to it.
 */
export default function QuoteOperationRateSource({
  rate,
  value,
  savedValue,
  rateSources,
  reference,
  onReset
}: {
  rate: OperationRate;
  value: number;
  savedValue: number | null | undefined;
  rateSources: Json | null | undefined;
  reference: RateReference | null;
  onReset: (value: number) => void;
}) {
  const { t } = useLingui();
  const [people] = usePeople();
  const formatter = useCurrencyFormatter({ rate: true });

  const saved = getRateSource(rateSources, rate);
  const isUnsaved = savedValue == null || ratesDiffer(value, savedValue);
  const referenceRate = reference?.rates[rate];
  const deviates =
    referenceRate !== undefined && ratesDiffer(value, referenceRate);

  const byName = saved?.by
    ? (people.find((p) => p.id === saved.by)?.name ?? null)
    : null;
  const referenceName =
    reference?.kind === "processAverage" ? null : reference?.name;
  const referenceLabel = referenceName ?? t`the work center`;
  const referenceRateText =
    referenceRate !== undefined ? formatter.format(referenceRate) : "";

  let sourceLine: ReactNode = null;
  if (isUnsaved) {
    sourceLine = <Trans>Not saved yet</Trans>;
  } else if (saved) {
    const when = formatDate(saved.at, SHORT_DATE);
    const label =
      saved.source === "Work Center" ? (
        <Trans>From {referenceLabel}</Trans>
      ) : saved.source === "Process Average" ? (
        <Trans>Process average</Trans>
      ) : saved.source === "Imported" ? (
        <Trans>Imported from JobBoss</Trans>
      ) : (
        <Trans>Manual override on this quote</Trans>
      );
    sourceLine = (
      <>
        {label} · {when}
        {byName ? ` · ${byName}` : ""}
      </>
    );
  }

  const referenceDate = reference?.ratesUpdatedAt
    ? formatDate(reference.ratesUpdatedAt, SHORT_DATE)
    : null;

  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground -mt-2">
      {sourceLine && <span>{sourceLine}</span>}
      {reference && referenceRate !== undefined && deviates ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-amber-600 dark:text-amber-500">
          <LuTriangleAlert className="size-3 shrink-0" />
          <span>
            {reference.kind === "processAverage" ? (
              <Trans>Process average is {referenceRateText}</Trans>
            ) : (
              <Trans>
                {referenceLabel} is {referenceRateText}
              </Trans>
            )}
            {referenceDate ? (
              <>
                {" "}
                <Trans>(rates set {referenceDate})</Trans>
              </>
            ) : null}
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            leftIcon={<LuRotateCcw />}
            onClick={() => onReset(referenceRate)}
          >
            {reference.kind === "processAverage" ? (
              <Trans>Reset to process average</Trans>
            ) : (
              <Trans>Reset to work center rate</Trans>
            )}
          </Button>
        </div>
      ) : reference && referenceDate ? (
        <span>
          {reference.kind === "processAverage" ? (
            <Trans>Matches the process average</Trans>
          ) : (
            <Trans>
              Matches {referenceLabel} (rates set {referenceDate})
            </Trans>
          )}
        </span>
      ) : null}
    </div>
  );
}
