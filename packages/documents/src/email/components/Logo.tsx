// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { BRAND_NAME } from "@carbon/utils/brand";
import { Section, Text } from "react-email";

// The email header mark: the brand name set as white text on a dark tile.
// Gmail's apps and classic Outlook recolour an email in dark mode themselves
// and never run the theme's dark CSS, so a light/dark swap reaches only some
// clients; one tile with its background set reads the same on a white card
// and on a dark one. To use a real logo image instead, change this component
// (the web pages use BrandWordmark from @carbon/react).
// The old Carbon images (carbon-email-mark.png, carbon-word-dark-outline.png)
// stay in public/: emails already sent still load them.
export function Logo() {
  return (
    <Section className="mt-[32px]">
      <Text
        className="mb-4 mx-auto block text-center"
        style={{
          backgroundColor: "#09090b",
          borderRadius: "16px",
          color: "#ffffff",
          fontSize: "24px",
          fontWeight: 800,
          letterSpacing: "-0.02em",
          lineHeight: "80px",
          margin: "0 auto 16px",
          textAlign: "center",
          width: "120px"
        }}
      >
        {BRAND_NAME}
      </Text>
    </Section>
  );
}
