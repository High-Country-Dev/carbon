// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { BrandWordmark, Heading, TooltipProvider } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { Outlet } from "react-router";

export default function PublicRoute() {
  return (
    <TooltipProvider>
      <div className="container relative h-full flex-col items-center justify-center grid lg:max-w-none lg:grid-cols-2 lg:px-0 bg-card">
        <div className="relative hidden h-full flex-col bg-muted p-10 lg:flex dark:border-r dark:bg-zinc-900 bg:zinc-100">
          <BrandWordmark size="xl" className="mb-3 z-50" />

          <div className="relative z-20 mt-auto">
            <blockquote className="space-y-2">
              <Heading size="display" className="text-foreground">
                <Trans>Let's build something</Trans>
                <span className="inline-block">
                  <span className="loading-dot">.</span>
                  <span className="loading-dot">.</span>
                  <span className="loading-dot">.</span>
                </span>
              </Heading>
            </blockquote>
          </div>
        </div>
        <div className="lg:p-8">
          <div className="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[350px]">
            <Outlet />
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
