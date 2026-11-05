// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";

/**
 * Last sign-in is not stored in the app DB — it lives in Supabase Auth. Page
 * through the admin API (service role) and index by user id. This is a full
 * scan of the auth users; fine for an admin list page.
 */
export async function getLastSignInByUserId(): Promise<
  Map<string, string | null>
> {
  const serviceRole = getCarbonServiceRole();
  const map = new Map<string, string | null>();
  const perPage = 1000;
  const maxPages = 50; // ~50k users backstop against an unbounded loop

  for (let page = 1; page <= maxPages; page++) {
    const { data, error } = await serviceRole.auth.admin.listUsers({
      page,
      perPage
    });
    if (error || !data?.users?.length) break;
    for (const user of data.users) {
      map.set(user.id, user.last_sign_in_at ?? null);
    }
    if (data.users.length < perPage) break;
  }

  return map;
}
