import type { MigrationGapDefinition } from "@carbon/migration/gaps";
import { PLAN_SECTIONS, type PlanSection } from "@carbon/migration/plan";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  HStack,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type {
  MigrationCompanyResult,
  MigrationRunReport
} from "~/modules/settings";

/**
 * What the migration did, and what it left behind.
 *
 * The gap list is the reason this screen exists. A one-click migration that
 * quietly leaves things behind is worse than one that leaves the same things
 * behind and says so — the customer finds the hole at month-end close instead of
 * on day one. The prose comes from the SOURCE's gap catalog, passed in by the
 * route; the run only stores which gaps applied and what they cost THIS account.
 */

const SECTION_LABELS: Record<PlanSection, string> = {
  currencies: "Currencies",
  unitsOfMeasure: "Units of measure",
  paymentTerms: "Payment terms",
  shippingMethods: "Shipping methods",
  locations: "Locations",
  departments: "Departments",
  accounts: "Chart of accounts",
  customerTypes: "Customer types",
  supplierTypes: "Supplier types",
  customers: "Customers",
  suppliers: "Suppliers",
  items: "Items",
  supplierParts: "Supplier parts",
  billsOfMaterial: "Bills of material",
  openingStock: "Opening stock",
  salesOrders: "Sales orders",
  purchaseOrders: "Purchase orders"
};

const SEVERITY_VARIANT = {
  high: "destructive",
  medium: "secondary",
  low: "outline"
} as const;

/**
 * One company's rows. A migration writes a company per source scope, so the
 * counts only mean anything alongside the name of the company they landed in.
 */
function CompanySection({ result }: { result: MigrationCompanyResult }) {
  const rows = PLAN_SECTIONS.map((section) => ({
    section,
    label: SECTION_LABELS[section],
    extracted: result.extracted[section] ?? 0,
    counts: result.counts[section] ?? { inserted: 0, updated: 0, skipped: 0 }
  })).filter((row) => row.extracted > 0 || row.counts.inserted > 0);

  return (
    <VStack spacing={2} className="w-full border rounded-lg p-3">
      <HStack className="w-full justify-between items-start gap-2">
        <VStack spacing={0} className="min-w-0">
          <span className="text-sm font-medium truncate">
            {result.companyName}
          </span>
          <span className="text-xs text-muted-foreground truncate">
            {result.scopeName}
          </span>
        </VStack>
        {result.created && (
          <Badge variant="secondary" className="shrink-0">
            <Trans>New company</Trans>
          </Badge>
        )}
      </HStack>

      <div className="w-full overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground text-xs">
              <th className="text-left font-medium py-1.5">
                <Trans>Records</Trans>
              </th>
              <th className="text-right font-medium py-1.5">
                <Trans>Found</Trans>
              </th>
              <th className="text-right font-medium py-1.5">
                <Trans>Created</Trans>
              </th>
              <th className="text-right font-medium py-1.5">
                <Trans>Updated</Trans>
              </th>
              <th className="text-right font-medium py-1.5">
                <Trans>Already there</Trans>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.section} className="border-t">
                <td className="py-1.5">{row.label}</td>
                <td className="py-1.5 text-right tabular-nums">
                  {row.extracted.toLocaleString()}
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {row.counts.inserted.toLocaleString()}
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {row.counts.updated.toLocaleString()}
                </td>
                <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                  {row.counts.skipped.toLocaleString()}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr className="border-t">
                <td colSpan={5} className="py-3 text-muted-foreground">
                  <Trans>Nothing was found to migrate for this entity.</Trans>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {result.warnings.length > 0 && (
        <ul className="text-xs list-disc pl-5 space-y-1 w-full">
          {result.warnings.map((warning) => (
            <li key={warning} className="text-muted-foreground">
              {warning}
            </li>
          ))}
        </ul>
      )}
    </VStack>
  );
}

export function MigrationReport({
  report,
  catalog,
  dryRun
}: {
  report: MigrationRunReport;
  /** The gap catalog of the source this run read from. */
  catalog: MigrationGapDefinition[];
  dryRun: boolean;
}) {
  const { t } = useLingui();

  const gaps = report.gaps
    .map((gap) => {
      const definition = catalog.find((entry) => entry.id === gap.id);
      return definition ? { ...definition, ...gap } : null;
    })
    .filter((gap): gap is NonNullable<typeof gap> => gap !== null);

  const createdCount = report.companies.filter((c) => c.created).length;

  return (
    <VStack spacing={4} className="w-full">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>
            {dryRun ? (
              <Trans>What a migration would bring across</Trans>
            ) : (
              <Trans>What came across</Trans>
            )}
          </CardTitle>
          <CardDescription>
            {createdCount > 0 ? (
              dryRun ? (
                <Trans>
                  One Carbon company per entity in the account, all in this
                  company group. {createdCount} would be created.
                </Trans>
              ) : (
                <Trans>
                  One Carbon company per entity in the account, all in this
                  company group. {createdCount} were created.
                </Trans>
              )
            ) : (
              <Trans>
                Every record keeps a link back to the record it came from, so
                running this again updates rather than duplicates.
              </Trans>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <VStack spacing={3} className="w-full">
            {report.companies.map((result) => (
              <CompanySection
                key={result.scopeId || result.companyId}
                result={result}
              />
            ))}
            {report.companies.length === 0 && (
              <p className="text-sm text-muted-foreground">
                <Trans>
                  Nothing was found to migrate. Check that the role you
                  connected can read these records.
                </Trans>
              </p>
            )}
          </VStack>
        </CardContent>
      </Card>

      {report.skippedScopes.length > 0 && (
        <Card className="w-full">
          <CardHeader>
            <CardTitle>
              <Trans>Entities without a company</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="text-sm list-disc pl-5 space-y-1">
              {report.skippedScopes.map((scope) => (
                <li key={scope.scopeId} className="text-muted-foreground">
                  <span className="text-foreground">{scope.name}</span> —{" "}
                  {scope.reason}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {report.notes.length > 0 && (
        <Card className="w-full">
          <CardHeader>
            <CardTitle>
              <Trans>About this account</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="text-sm list-disc pl-5 space-y-1">
              {report.notes.map((note) => (
                <li key={note} className="text-muted-foreground">
                  {note}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card className="w-full">
        <CardHeader>
          <CardTitle>
            <Trans>What stays behind</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              A migration cannot bring everything. This is the complete list of
              what it did not, and what to do about each one.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <VStack spacing={3} className="w-full">
            {gaps.map((gap) => (
              <VStack
                key={gap.id}
                spacing={1}
                className="w-full border rounded-lg p-3"
              >
                <HStack className="w-full justify-between items-start gap-2">
                  <span className="text-sm font-medium">{gap.title}</span>
                  <HStack spacing={2} className="shrink-0">
                    {gap.count !== null && gap.count > 0 && (
                      <Badge variant="outline">
                        {t`${gap.count.toLocaleString()} records`}
                      </Badge>
                    )}
                    <Badge variant={SEVERITY_VARIANT[gap.severity]}>
                      {gap.id}
                    </Badge>
                  </HStack>
                </HStack>
                <p className="text-xs text-muted-foreground">{gap.detail}</p>
                {gap.examples.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {gap.examples.join(" · ")}
                  </p>
                )}
                <p className="text-xs">
                  <span className="font-medium">
                    <Trans>What to do instead:</Trans>{" "}
                  </span>
                  <span className="text-muted-foreground">
                    {gap.workaround}
                  </span>
                </p>
              </VStack>
            ))}
            {gaps.length === 0 && (
              <p className="text-sm text-muted-foreground">
                <Trans>
                  Nothing this migration leaves behind applies to your account.
                </Trans>
              </p>
            )}
          </VStack>
        </CardContent>
      </Card>
    </VStack>
  );
}
