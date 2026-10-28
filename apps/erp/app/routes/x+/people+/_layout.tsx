// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { BRAND_NAME } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { MetaFunction } from "react-router";

import { GroupedContentSidebar } from "~/components/Layout";
import usePeopleSubmodules from "~/modules/people/ui/usePeopleSubmodules";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export { RouteErrorBoundary as ErrorBoundary } from "@carbon/react/ErrorBoundary";

export const meta: MetaFunction = () => {
  return [{ title: `${BRAND_NAME} | People` }];
};

function PeopleSidebar() {
  const { groups } = usePeopleSubmodules();
  return <GroupedContentSidebar groups={groups} />;
}

export const handle: Handle = {
  breadcrumb: msg`People`,
  to: path.to.people,
  module: "people",
  sidebar: PeopleSidebar
};

export default function PeopleRoute() {
  return (
    <VStack spacing={0} className="h-full">
      <RecordOutlet />
    </VStack>
  );
}
