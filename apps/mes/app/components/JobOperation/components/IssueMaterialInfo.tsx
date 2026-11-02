// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  cn,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@carbon/react";
import { BRAND_NAME } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuInfo } from "react-icons/lu";

/**
 * The "i" beside Issue: what issuing does, in plain words. A popover on
 * desktop and a bottom sheet on phones (Popover switches itself), so it opens
 * on a tap. The wording follows the automatic issue: the completion backflush
 * (the ERP's issueJobOperationMaterials) and the step backflush both skip
 * batch- and serial-tracked material, and take only what is still unissued.
 */
export function IssueMaterialInfo({ className }: { className?: string }) {
  const { t } = useLingui();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton
          aria-label={t`What does Issue do?`}
          variant="ghost"
          icon={<LuInfo />}
          className={cn("text-muted-foreground", className)}
        />
      </PopoverTrigger>
      <PopoverContent
        aria-label={t`Issue Material`}
        align="end"
        className="w-80 max-w-[calc(100vw-2rem)] text-sm"
      >
        <div className="flex flex-col gap-2">
          <p>
            <Trans>
              Issue records material you take from stock for this job: stock
              goes down and the material counts toward the job.
            </Trans>
          </p>
          <p>
            <Trans>
              For batch- or serial-tracked material you also pick the batch or
              serial. Tracked material is never taken automatically, so issue it
              here.
            </Trans>
          </p>
          <p>
            <Trans>
              Other material you don't issue, {BRAND_NAME} takes from stock
              automatically when you log finished pieces. What you already
              issued counts toward that, so nothing is taken twice.
            </Trans>
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
