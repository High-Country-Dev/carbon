import type {
  DetectedGap,
  GapSignals,
  MigrationGapDefinition
} from "./types.ts";

/**
 * The gaps that apply to one account, worst first.
 *
 * A gap is reported unless the read PROVED it does not apply by counting zero
 * source records for it. Silence is not proof: a gap the source could not probe
 * — a feature the role cannot read, a record type the account does not expose —
 * has no count and is still shown, because "we could not check" and "there is
 * nothing there" must not look the same to somebody deciding whether to cut over.
 */
export function detectGaps(
  catalog: MigrationGapDefinition[],
  signals: GapSignals = {}
): DetectedGap[] {
  const counts = signals.counts ?? {};
  const examples = signals.examples ?? {};

  const severityRank = { high: 0, medium: 1, low: 2 } as const;

  return catalog
    .filter((gap) => counts[gap.id] !== 0)
    .map((gap) => ({
      ...gap,
      count: counts[gap.id] ?? null,
      examples: examples[gap.id] ?? []
    }))
    .sort((a, b) => {
      const bySeverity = severityRank[a.severity] - severityRank[b.severity];
      if (bySeverity !== 0) return bySeverity;
      // Within a severity, the ones that cost this customer the most records
      // first; an uncountable gap sorts after countable ones so the report leads
      // with numbers.
      const aCount = a.count ?? -1;
      const bCount = b.count ?? -1;
      if (aCount !== bCount) return bCount - aCount;
      return a.id.localeCompare(b.id);
    });
}

/** A one-line summary for the migration's completion notice. */
export function summarizeGaps(gaps: DetectedGap[]): string {
  const high = gaps.filter((gap) => gap.severity === "high").length;
  if (gaps.length === 0) return "No known gaps apply to this account.";
  if (high === 0)
    return `${gaps.length} things were left behind — see the migration report.`;
  return `${gaps.length} things were left behind, ${high} of them significant — see the migration report.`;
}
