// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { Badge, Button, cn, HStack, Status, VStack } from "@carbon/react";
import { datetime, redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useDateFormatter } from "@react-aria/i18n";
import { useMemo, useState } from "react";
import { LuChevronDown, LuChevronRight } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { Empty } from "~/components";
import { useQuantityFormatter } from "~/hooks";
import { getMissingParts } from "~/modules/production/missing-parts.service";
import {
  type JobMissingParts,
  MISSING_PARTS_WEEKS,
  type MissingPartLine,
  type MissingPartsPeriod,
  type PartProjection
} from "~/modules/production/ui/Jobs/missing-parts-logic";
import { PlanningWeekStrip } from "~/modules/production/ui/Planning/PlanningWeekStrip";
import {
  getLocationTimeZone,
  getOrCreatePeriods,
  resolveLocationId
} from "~/modules/shared/shared.service";
import { getDatabaseClient } from "~/services/database.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "production/missing-parts");

export const handle: Handle = {
  breadcrumb: msg`Jobs Missing Parts`,
  to: path.to.productionMissingParts
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "production"
  });

  const url = new URL(request.url);
  const locationId = await resolveLocationId(client, request, {
    searchParams: url.searchParams,
    userId,
    companyId,
    onDefaultsError: path.to.production,
    onNoLocations: path.to.production
  });

  const today = datetime.today(
    await getLocationTimeZone(client, locationId, companyId)
  );
  const periods = await getOrCreatePeriods(
    getDatabaseClient(),
    today,
    MISSING_PARTS_WEEKS
  );

  const result = await getMissingParts(client, {
    companyId,
    locationId,
    today,
    periods
  });
  if (result.error || !result.data) {
    logger.error("Failed to load jobs missing parts", {
      companyId,
      error: result.error
    });
    throw redirect(
      path.to.production,
      await flash(request, error(result.error, "Failed to load missing parts"))
    );
  }

  return {
    ...result.data,
    periods: periods.map((p) => ({
      id: p.id,
      startDate: p.startDate,
      endDate: p.endDate
    })),
    today: today.toString()
  };
}

export default function JobsMissingPartsRoute() {
  const { t } = useLingui();
  const { jobs, parts, periods, jobsMissingParts } =
    useLoaderData<typeof loader>();
  const [showAtRisk, setShowAtRisk] = useState(true);

  const visible = useMemo(
    () =>
      jobs
        .map((j) => ({
          ...j,
          lines: showAtRisk
            ? j.lines
            : j.lines.filter((l) => l.status === "missing")
        }))
        .filter((j) => j.lines.length > 0),
    [jobs, showAtRisk]
  );
  const atRiskJobs = jobs.length - jobsMissingParts;

  return (
    <div className="flex h-[calc(100dvh-var(--header-height))] w-full flex-col overflow-y-auto bg-card scrollbar-thin">
      <VStack spacing={4} className="w-full p-4">
        <HStack className="w-full flex-wrap justify-between gap-3">
          <VStack spacing={1}>
            <h1 className="text-2xl font-semibold tracking-tight">
              <Trans>Jobs Missing Parts</Trans>
            </h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              <Trans>
                Released jobs whose parts can't all come from stock. Red: the
                job needs more than is on hand now. Amber: on hand covers this
                job, but all the jobs and orders pulling on the part need more
                than is on hand and on order. The bars are the part's projected
                stock by week; open a part to see the jobs pulling it and the
                orders arriving each week.
              </Trans>
            </p>
          </VStack>
          <HStack className="flex-wrap gap-2">
            <Badge variant="red">{t`${jobsMissingParts} jobs short now`}</Badge>
            <Badge variant="yellow">{t`${atRiskJobs} jobs at risk`}</Badge>
            <Button
              variant="secondary"
              onClick={() => setShowAtRisk((v) => !v)}
            >
              {showAtRisk ? t`Hide at-risk parts` : t`Show at-risk parts`}
            </Button>
          </HStack>
        </HStack>

        {visible.length === 0 ? (
          <Empty>
            <Trans>Every released job can be filled from stock.</Trans>
          </Empty>
        ) : (
          <VStack spacing={3} className="w-full">
            {visible.map((job) => (
              <JobCard
                key={job.job.id}
                job={job}
                parts={parts}
                periods={periods}
              />
            ))}
          </VStack>
        )}
      </VStack>
    </div>
  );
}

function JobCard({
  job,
  parts,
  periods
}: {
  job: JobMissingParts;
  parts: Record<string, PartProjection>;
  periods: MissingPartsPeriod[];
}) {
  const { t } = useLingui();
  const dateFormatter = useDateFormatter({ month: "short", day: "numeric" });
  const due = job.job.dueDate
    ? dateFormatter.format(new Date(`${job.job.dueDate.slice(0, 10)}T12:00:00`))
    : null;
  return (
    <div className="w-full rounded-lg border bg-background">
      <HStack className="w-full flex-wrap justify-between gap-2 border-b px-4 py-3">
        <HStack className="gap-3">
          <Link
            to={path.to.job(job.job.id)}
            className="font-semibold hover:underline"
          >
            {job.job.jobId}
          </Link>
          {job.job.itemReadableId && (
            <span className="text-sm text-muted-foreground">
              {job.job.itemReadableId}
            </span>
          )}
          <Status color={job.job.status === "In Progress" ? "blue" : "green"}>
            {job.job.status}
          </Status>
        </HStack>
        <HStack className="gap-3 text-sm">
          {due && (
            <span className="text-muted-foreground">
              <Trans>Due {due}</Trans>
            </span>
          )}
          {job.missingCount > 0 ? (
            <Badge variant="red">{t`${job.missingCount} missing`}</Badge>
          ) : (
            <Badge variant="yellow">{t`At risk`}</Badge>
          )}
        </HStack>
      </HStack>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="w-6 px-2 py-2" />
              <th className="px-2 py-2 font-medium">
                <Trans>Part</Trans>
              </th>
              <th className="px-2 py-2 text-right font-medium">
                <Trans>Needed</Trans>
              </th>
              <th className="px-2 py-2 text-right font-medium">
                <Trans>On hand</Trans>
              </th>
              <th className="px-2 py-2 font-medium">
                <Trans>Needed by</Trans>
              </th>
              <th className="px-2 py-2 font-medium">
                <Trans>Stock by week</Trans>
              </th>
              <th className="px-2 py-2 font-medium">
                <Trans>Covered from</Trans>
              </th>
            </tr>
          </thead>
          <tbody>
            {job.lines.map((line) => (
              <PartRow
                key={line.materialId}
                line={line}
                part={parts[line.itemId]}
                periods={periods}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function weekLabel(
  periods: MissingPartsPeriod[],
  index: number | null,
  format: (d: Date) => string
) {
  if (index === null || !periods[index]) return null;
  return format(new Date(`${periods[index].startDate}T12:00:00`));
}

function PartRow({
  line,
  part,
  periods
}: {
  line: MissingPartLine;
  part: PartProjection | undefined;
  periods: MissingPartsPeriod[];
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const formatQuantity = useQuantityFormatter();
  const dateFormatter = useDateFormatter({ month: "short", day: "numeric" });
  const format = (d: Date) => dateFormatter.format(d);
  if (!part) return null;
  const values = part.weeks.map((w) => w.projected);
  const missing = line.status === "missing";
  const neededBy = weekLabel(periods, line.needWeek, format);
  const covered = weekLabel(periods, line.coveredWeek, format);

  return (
    <>
      <tr
        className="cursor-pointer border-t hover:bg-muted/40"
        onClick={() => setOpen((v) => !v)}
      >
        <td className="px-2 py-2 text-muted-foreground">
          {open ? <LuChevronDown /> : <LuChevronRight />}
        </td>
        <td className="px-2 py-2">
          <HStack className="gap-2">
            <span
              aria-hidden
              className={cn(
                "inline-block h-2 w-2 shrink-0 rounded-full",
                missing ? "bg-red-500" : "bg-yellow-500"
              )}
            />
            <VStack spacing={0}>
              <Link
                to={path.to.part(line.itemId)}
                className="whitespace-nowrap font-medium hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {part.item.readableId}
              </Link>
              {part.item.name !== part.item.readableId && (
                <span className="text-xs text-muted-foreground line-clamp-1">
                  {part.item.name}
                </span>
              )}
            </VStack>
          </HStack>
        </td>
        <td className="px-2 py-2 text-right tabular-nums">
          {formatQuantity(line.quantityToIssue)}
        </td>
        <td
          className={cn(
            "px-2 py-2 text-right tabular-nums",
            missing && "text-red-500"
          )}
        >
          {formatQuantity(line.onHand)}
        </td>
        <td className="px-2 py-2 whitespace-nowrap">
          {neededBy ? t`Week of ${neededBy}` : "—"}
        </td>
        <td className="px-2 py-2">
          <PlanningWeekStrip periods={periods} values={values} />
        </td>
        <td className="px-2 py-2 whitespace-nowrap">
          {covered ? (
            t`Week of ${covered}`
          ) : (
            <span className="text-red-500">{t`Not covered by open orders`}</span>
          )}
        </td>
      </tr>
      {open && (
        <tr className="bg-muted/30">
          <td />
          <td colSpan={6} className="px-2 pb-3 pt-1">
            <PartWeeks part={part} periods={periods} format={format} />
          </td>
        </tr>
      )}
    </>
  );
}

function PartWeeks({
  part,
  periods,
  format
}: {
  part: PartProjection;
  periods: MissingPartsPeriod[];
  format: (d: Date) => string;
}) {
  const formatQuantity = useQuantityFormatter();
  const active = part.weeks
    .map((week, index) => ({ week, index }))
    .filter(
      ({ week, index }) =>
        week.demand.length > 0 || week.supply.length > 0 || index === 0
    );

  return (
    <VStack spacing={2} className="w-full">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 pr-4 font-medium">
                <Trans>Week of</Trans>
              </th>
              <th className="py-1 pr-4 font-medium">
                <Trans>Jobs and orders pulling</Trans>
              </th>
              <th className="py-1 pr-4 font-medium">
                <Trans>Arriving</Trans>
              </th>
              <th className="py-1 text-right font-medium">
                <Trans>Projected stock</Trans>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t">
              <td className="py-1 pr-4 text-muted-foreground">
                <Trans>Now</Trans>
              </td>
              <td />
              <td />
              <td className="py-1 text-right tabular-nums">
                <Trans>{formatQuantity(part.onHand)} on hand</Trans>
              </td>
            </tr>
            {active.map(({ week, index }) => (
              <tr
                key={periods[index]?.id ?? index}
                className="border-t align-top"
              >
                <td className="py-1 pr-4 whitespace-nowrap">
                  {format(new Date(`${periods[index].startDate}T12:00:00`))}
                </td>
                <td className="py-1 pr-4">
                  <VStack spacing={0}>
                    {week.demand.map((d) => (
                      <span key={`${d.kind}-${d.id}`}>
                        <Link
                          to={
                            d.kind === "job"
                              ? path.to.job(d.id)
                              : path.to.salesOrder(d.id)
                          }
                          className="hover:underline"
                        >
                          {d.label}
                        </Link>{" "}
                        <span className="text-muted-foreground">
                          −{formatQuantity(d.quantity)}
                        </span>
                      </span>
                    ))}
                  </VStack>
                </td>
                <td className="py-1 pr-4">
                  <VStack spacing={0}>
                    {week.supply.map((s) => (
                      <span key={`${s.kind}-${s.id}`}>
                        <Link
                          to={
                            s.kind === "purchase"
                              ? path.to.purchaseOrder(s.id)
                              : path.to.job(s.id)
                          }
                          className="hover:underline"
                        >
                          {s.label}
                        </Link>{" "}
                        <span className="text-muted-foreground">
                          +{formatQuantity(s.quantity)}
                          {s.date
                            ? ` · ${format(new Date(`${s.date.slice(0, 10)}T12:00:00`))}`
                            : ""}
                        </span>
                      </span>
                    ))}
                  </VStack>
                </td>
                <td
                  className={cn(
                    "py-1 text-right tabular-nums",
                    week.projected < 0 && "font-medium text-red-500"
                  )}
                >
                  {formatQuantity(week.projected)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {part.draftPurchaseLines.length > 0 && (
        <p className="text-xs text-muted-foreground">
          <Trans>
            Draft purchase orders, not counted until they're finalized:
          </Trans>{" "}
          {part.draftPurchaseLines.map((d, i) => (
            <span key={d.id}>
              {i > 0 && ", "}
              <Link
                to={path.to.purchaseOrder(d.purchaseOrderId)}
                className="hover:underline"
              >
                {d.purchaseOrderReadableId}
              </Link>{" "}
              +{formatQuantity(d.quantityToReceive)}
              {d.promisedDate
                ? ` · ${format(new Date(`${d.promisedDate.slice(0, 10)}T12:00:00`))}`
                : ""}
            </span>
          ))}
        </p>
      )}
    </VStack>
  );
}
