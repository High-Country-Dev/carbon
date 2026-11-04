// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// LAND-299: job cost in dollars, estimate against actual, with margin. Shown only to people with Resources
// access (the same rule as rates, LAND-271).
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCurrencyFormatter, usePercentFormatter } from "~/hooks";
import type { JobCost } from "../../job-cost.service";

export default function JobCostSummary({ cost }: { cost: JobCost }) {
  const { t } = useLingui();
  const money = useCurrencyFormatter();
  const pct = usePercentFormatter();
  const rows: [string, JobCost["material"]][] = [
    [t`Material`, cost.material],
    [t`Labor`, cost.labor],
    [t`Machine`, cost.machine],
    [t`Overhead`, cost.overhead],
    [t`Outside processing`, cost.outside]
  ];
  const over = (l: JobCost["material"]) =>
    l.estimated > 0 && l.actual > l.estimated;
  const marginPct = (m: number) => (cost.revenue ? m / cost.revenue : 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Job Cost</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <Thead>
            <Tr>
              <Th />
              <Th className="text-right">
                <Trans>Estimated</Trans>
              </Th>
              <Th className="text-right">
                <Trans>Actual</Trans>
              </Th>
              <Th className="text-right">
                <Trans>Difference</Trans>
              </Th>
            </Tr>
          </Thead>
          <Tbody>
            {rows
              .filter(([, l]) => l.estimated !== 0 || l.actual !== 0)
              .map(([name, l]) => (
                <Tr key={name}>
                  <Td>{name}</Td>
                  <Td className="text-right">{money.format(l.estimated)}</Td>
                  <Td className={cn("text-right", over(l) && "text-red-500")}>
                    {money.format(l.actual)}
                  </Td>
                  <Td className={cn("text-right", over(l) && "text-red-500")}>
                    {money.format(l.actual - l.estimated)}
                  </Td>
                </Tr>
              ))}
            <Tr className="font-semibold">
              <Td>
                <Trans>Total cost</Trans>
              </Td>
              <Td className="text-right">
                {money.format(cost.total.estimated)}
              </Td>
              <Td
                className={cn("text-right", over(cost.total) && "text-red-500")}
              >
                {money.format(cost.total.actual)}
              </Td>
              <Td
                className={cn("text-right", over(cost.total) && "text-red-500")}
              >
                {money.format(cost.total.actual - cost.total.estimated)}
              </Td>
            </Tr>
            <Tr>
              <Td>
                <Trans>Hours</Trans>
              </Td>
              <Td className="text-right">{cost.hours.estimated.toFixed(1)}</Td>
              <Td className="text-right">{cost.hours.actual.toFixed(1)}</Td>
              <Td className="text-right">
                {(cost.hours.actual - cost.hours.estimated).toFixed(1)}
              </Td>
            </Tr>
            <Tr>
              <Td>
                <Trans>Sale price</Trans>
              </Td>
              <Td className="text-right" colSpan={3}>
                {cost.revenue === null
                  ? t`Not on a sales order`
                  : money.format(cost.revenue)}
              </Td>
            </Tr>
            {cost.margin && (
              <Tr className="font-semibold">
                <Td>
                  <Trans>Margin</Trans>
                </Td>
                <Td className="text-right">
                  {money.format(cost.margin.estimated)} (
                  {pct.format(marginPct(cost.margin.estimated))})
                </Td>
                <Td
                  className={cn(
                    "text-right",
                    cost.margin.actual < 0 && "text-red-500"
                  )}
                >
                  {money.format(cost.margin.actual)} (
                  {pct.format(marginPct(cost.margin.actual))})
                </Td>
                <Td className="text-right">
                  {money.format(cost.margin.actual - cost.margin.estimated)}
                </Td>
              </Tr>
            )}
          </Tbody>
        </Table>
      </CardContent>
    </Card>
  );
}
