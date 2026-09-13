/**
 * Coercions for loosely-typed source rows.
 *
 * Every system a migration reads from returns something sloppier than its own
 * schema claims: numbers as strings, booleans as single characters, dates in
 * whatever the account's display preference is. These are the one place that is
 * dealt with, so no mapper has to remember it — and so the ONE policy that
 * matters, `date()` refusing to guess, is impossible to bypass by accident.
 */

/** One row from a source's tabular API, before coercion. */
export type SourceRow = Record<string, unknown>;

export function str(row: SourceRow, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

export function requiredStr(
  row: SourceRow,
  key: string,
  fallback: string
): string {
  return str(row, key) ?? fallback;
}

export function num(row: SourceRow, key: string): number | null {
  const value = row[key];
  if (value === null || value === undefined || value === "") return null;
  const parsed =
    typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function numOr(row: SourceRow, key: string, fallback: number): number {
  return num(row, key) ?? fallback;
}

/** Many source APIs answer with `'T'` / `'F'` text rather than SQL booleans. */
export function bool(row: SourceRow, key: string): boolean {
  const value = row[key];
  if (typeof value === "boolean") return value;
  const text = String(value ?? "")
    .trim()
    .toUpperCase();
  return text === "T" || text === "TRUE" || text === "Y" || text === "1";
}

/** A source date column, normalized to `YYYY-MM-DD` — or null when it is ambiguous. */
export function date(row: SourceRow, key: string): string | null {
  const value = str(row, key);
  if (!value) return null;

  // Already ISO.
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // A slash date is `DD/MM/YYYY` or `MM/DD/YYYY` depending on the account's own
  // display preference, and these APIs give no way to tell them apart from the
  // value alone. An ambiguous date is left unset rather than guessed — a
  // promised date silently off by months is worse than a blank one, and the
  // mapper reports it.
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (slash) {
    const [, a, b, year] = slash;
    const first = Number(a);
    const second = Number(b);
    if (first > 12 && second <= 12) {
      return `${year}-${String(second).padStart(2, "0")}-${String(first).padStart(2, "0")}`;
    }
    if (second > 12 && first <= 12) {
      return `${year}-${String(first).padStart(2, "0")}-${String(second).padStart(2, "0")}`;
    }
    return null;
  }

  return null;
}
