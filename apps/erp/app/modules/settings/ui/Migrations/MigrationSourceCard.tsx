import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  HStack,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { Link, useFetcher } from "react-router";
import { path } from "~/utils/path";

/** What the page needs to know about one registered migration source. */
export type MigrationSourceCardData = {
  id: string;
  name: string;
  description: string;
  /** The `companyIntegration` row that holds its credentials. */
  integrationId: string;
  connected: boolean;
};

/**
 * One card per system Carbon can migrate from.
 *
 * Two buttons, not one: **Preview** runs the identical code path and rolls the
 * write back, so somebody can see exactly what a migration would do to their
 * company before it does it. Preview is the primary action deliberately —
 * migrating first and reading the report afterwards is the same information in
 * the wrong order.
 */
export function MigrationSourceCard({
  source,
  disabled,
  scopeChoices,
  onStart
}: {
  source: MigrationSourceCardData;
  disabled: boolean;
  /** Offered when a previous run stopped to ask which scope to migrate. */
  scopeChoices:
    | { id: string; name: string; currencyCode: string | null }[]
    | null;
  /** Fired on click so the page can show the run before the job writes its
   *  marker. Called with false if the action refused, so the row doesn't spin forever. */
  onStart: (started: boolean) => void;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher<{ success: boolean }>();
  const [scopeId, setScopeId] = useState<string>("");

  const refused = fetcher.state === "idle" && fetcher.data?.success === false;
  useEffect(() => {
    if (refused) onStart(false);
  }, [refused, onStart]);

  const start = (dryRun: boolean) => {
    onStart(true);
    fetcher.submit(
      {
        intent: dryRun ? "preview" : "migrate",
        sourceId: source.id,
        scopeId: scopeId || ""
      },
      { method: "post", action: path.to.migrate }
    );
  };

  if (!source.connected) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{t`Connect ${source.name} first`}</CardTitle>
          <CardDescription>
            <Trans>
              Carbon needs read access to your account. Connecting takes a few
              minutes, and nothing in the system you are leaving is ever
              changed.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild>
            <Link to={path.to.integration(source.integrationId)}>
              {t`Connect ${source.name}`}
            </Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>{t`Bring your ${source.name} data into Carbon`}</CardTitle>
        <CardDescription>{source.description}</CardDescription>
      </CardHeader>

      {scopeChoices && scopeChoices.length > 0 && (
        <CardContent>
          <VStack spacing={1} className="w-full max-w-sm">
            <span className="text-sm font-medium">
              <Trans>Which one?</Trans>
            </span>
            <p className="text-xs text-muted-foreground">
              <Trans>
                This account holds several. One Carbon company holds one of them
                — migrating them together would double-count whatever moves
                between them.
              </Trans>
            </p>
            <Select value={scopeId} onValueChange={setScopeId}>
              <SelectTrigger id="scopeId">
                <SelectValue placeholder={t`Select one`} />
              </SelectTrigger>
              <SelectContent>
                {scopeChoices.map((scope) => (
                  <SelectItem key={scope.id} value={scope.id}>
                    {scope.currencyCode
                      ? `${scope.name} (${scope.currencyCode})`
                      : scope.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </VStack>
        </CardContent>
      )}

      <CardFooter>
        <HStack spacing={2}>
          <Button
            isDisabled={disabled}
            isLoading={fetcher.state !== "idle"}
            onClick={() => start(true)}
          >
            <Trans>Preview the migration</Trans>
          </Button>
          <Button
            variant="secondary"
            isDisabled={disabled}
            onClick={() => start(false)}
          >
            <Trans>Migrate now</Trans>
          </Button>
        </HStack>
      </CardFooter>
    </Card>
  );
}
