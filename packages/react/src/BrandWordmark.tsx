// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { BRAND_NAME } from "@carbon/utils/brand";
import type { HTMLAttributes } from "react";
import { cn } from "./utils/cn";

const sizes = {
  xs: "text-sm",
  sm: "text-lg",
  md: "text-2xl",
  lg: "text-4xl",
  xl: "text-5xl"
} as const;

type BrandWordmarkProps = HTMLAttributes<HTMLSpanElement> & {
  size?: keyof typeof sizes;
};

// The product's logo everywhere a web page shows one (login, MFA, invite,
// the public layout, the loading pulse). It is the brand name set as text, so
// it follows light and dark mode through `text-foreground`. To use a real
// logo image instead, change this component — every call site goes through it.
export function BrandWordmark({
  size = "lg",
  className,
  ...props
}: BrandWordmarkProps) {
  return (
    <span
      className={cn(
        "inline-block select-none font-headline font-extrabold leading-none tracking-tight text-foreground",
        sizes[size],
        className
      )}
      {...props}
    >
      {BRAND_NAME}
    </span>
  );
}
