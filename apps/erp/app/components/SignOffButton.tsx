// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// LAND-299: our own sign-off on a quote or PO (Carbon's approvals are Enterprise code, not used). Shows who
// signed off and when; people with Resources access can sign off or take it back. `onChange` reports whether
// the document is signed off, so the header can hold Finalize until it is.
import { Badge, Button } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useEffect } from "react";
import { LuBadgeCheck } from "react-icons/lu";
import { useFetcher } from "react-router";
import { usePermissions } from "~/hooks";

type State = {
  signedOffBy: string | null;
  signedOffAt: string | null;
  name: string | null;
};

export default function SignOffButton({
  table,
  id,
  editable,
  onChange
}: {
  table: "quote" | "purchaseOrder";
  id: string;
  editable: boolean;
  onChange?: (signedOff: boolean) => void;
}) {
  const permissions = usePermissions();
  const canSignOff = permissions.can("view", "resources");
  const loader = useFetcher<State>();
  const action = useFetcher<{ ok?: boolean }>();
  const url = `/x/sign-off/${table}/${id}`;

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload after each sign-off change
  useEffect(() => {
    loader.load(url);
  }, [url, action.data]);

  const signed = !!loader.data?.signedOffBy;
  useEffect(() => {
    if (loader.data) onChange?.(signed);
  }, [loader.data, signed, onChange]);

  if (signed) {
    const when = loader.data?.signedOffAt
      ? new Date(loader.data.signedOffAt).toLocaleDateString()
      : "";
    return (
      <span className="inline-flex items-center gap-2">
        <Badge variant="green">
          <LuBadgeCheck className="mr-1" />
          <Trans>Signed off</Trans>
          {loader.data?.name ? ` · ${loader.data.name}` : ""}
          {when ? ` · ${when}` : ""}
        </Badge>
        {editable && canSignOff && (
          <Button
            variant="ghost"
            size="sm"
            isDisabled={action.state !== "idle"}
            onClick={() =>
              action.submit({ signOff: "0" }, { method: "post", action: url })
            }
          >
            <Trans>Undo</Trans>
          </Button>
        )}
      </span>
    );
  }
  if (!editable) return null;
  return canSignOff ? (
    <Button
      variant="secondary"
      leftIcon={<LuBadgeCheck />}
      isDisabled={action.state !== "idle"}
      onClick={() =>
        action.submit({ signOff: "1" }, { method: "post", action: url })
      }
    >
      <Trans>Sign off</Trans>
    </Button>
  ) : (
    <Badge variant="outline">
      <Trans>Needs sign-off</Trans>
    </Badge>
  );
}
