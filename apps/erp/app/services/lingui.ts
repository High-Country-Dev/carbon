import { resolveLanguage } from "@carbon/locale";
import type { Messages } from "@lingui/core";
import { useEffect, useReducer } from "react";

// The .po is compiled by @lingui/vite-plugin into a hashed chunk per locale,
// so the client fetches only the active language, cached immutably — instead
// of the whole catalog riding along in every root loader response.
const loaders = import.meta.glob(
  "../../../../packages/locale/locales/*/erp.po",
  { import: "messages" }
) as Record<string, () => Promise<Messages>>;

const cache = new Map<string, Messages>();

export async function preloadCatalog(locale?: string | null) {
  const language = resolveLanguage(locale);
  if (cache.has(language)) return;
  const load =
    loaders[`../../../../packages/locale/locales/${language}/erp.po`];
  cache.set(language, load ? await load() : {});
}

export function getCatalog(locale?: string | null): Messages {
  return cache.get(resolveLanguage(locale)) ?? {};
}

// Switching language re-runs the root loader with a new cookie, but the client
// only preloaded the language it hydrated with — fetch the new one and re-render.
export function useCatalog(locale?: string | null): Messages {
  const language = resolveLanguage(locale);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!cache.has(language)) preloadCatalog(language).then(rerender);
  }, [language]);
  return getCatalog(language);
}
