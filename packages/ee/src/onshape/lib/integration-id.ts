/**
 * Carbon carries two Onshape integrations at once.
 *
 * `onshape` is the original pull-shaped one: Carbon lists documents, pulls
 * models, and a webhook attaches assets when Onshape releases. `onshape-v2` is
 * the panel — push-only, driven from inside Onshape by the person who decides
 * when CAD data should land in Carbon.
 *
 * They are separate integrations rather than two modes of one because they own
 * separate state: each has its own OAuth grant and credential row, and each
 * writes its own `externalIntegrationMapping` namespace. A company can install
 * either, both, or neither, and uninstalling one never disturbs the other.
 *
 * The pair is expected to be temporary — v2 is intended to replace v1 — but
 * while both are installable, every read that answers "does Carbon know about
 * this Onshape thing?" has to consider both namespaces, and every write has to
 * name exactly one. That is what these constants are for: an `"onshape"` string
 * literal in panel code is almost always a bug now.
 */

export const ONSHAPE_INTEGRATION_ID = "onshape";
export const ONSHAPE_V2_INTEGRATION_ID = "onshape-v2";

export type OnshapeIntegrationId =
  | typeof ONSHAPE_INTEGRATION_ID
  | typeof ONSHAPE_V2_INTEGRATION_ID;

/**
 * Both namespaces, for reads that must see an item however it was linked —
 * the item page's source card, and anything answering "is this already in
 * Carbon?". Order matters where a single row is picked: v2 first, because a
 * company running both is migrating toward it.
 */
export const ONSHAPE_INTEGRATION_IDS: readonly OnshapeIntegrationId[] = [
  ONSHAPE_V2_INTEGRATION_ID,
  ONSHAPE_INTEGRATION_ID
];

export function isOnshapeIntegrationId(
  value: unknown
): value is OnshapeIntegrationId {
  return (
    value === ONSHAPE_INTEGRATION_ID || value === ONSHAPE_V2_INTEGRATION_ID
  );
}
