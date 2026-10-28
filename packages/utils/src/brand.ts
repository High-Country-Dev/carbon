// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * The product name users see: tab titles, emails, PDFs, the PWA manifest and
 * in-app copy all read it from here, so renaming the product is this one line.
 *
 * No imports on purpose: the CI package (ci/src/auth-emails.ts) and the email
 * templates load this file directly, without the rest of @carbon/utils.
 *
 * Package names, identifiers, env vars and the license headers keep "Carbon".
 */
export const BRAND_NAME = "BOSS";
