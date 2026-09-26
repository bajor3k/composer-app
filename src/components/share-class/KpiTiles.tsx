import type { AnalysisResult } from "@/lib/share-class/types";
import { fmt$ } from "@/lib/share-class/format";

// The six headline tiles. Computed from the currently filtered result set so the
// numbers track the filter bar. "Annual saving identified" only counts asserted
// CONVERTs; ER-only pending savings are surfaced separately (never conflated).
export function KpiTiles({ results }: { results: AnalysisResult[] }) {
  const savings = results.reduce((s, r) => s + (r.action === "CONVERT" ? r.savings : 0), 0);
  const pendingSave = results.reduce(
    (s, r) => s + (r.action === "PENDING_CUSTODIAN_DATA" ? r.savings : 0),
    0,
  );
  const aum = results.reduce((s, r) => s + r.mv, 0);
  const count = (a: string) => results.filter((r) => r.action === a).length;

  const tiles = [
    {
      k: "Annual saving identified",
      v: fmt$(savings),
      n:
        pendingSave > 0
          ? `+ ${fmt$(pendingSave)}/yr ER-only, pending custodian data`
          : `${count("CONVERT")} positions actionable`,
    },
    { k: "Assets reviewed", v: fmt$(aum), n: `${results.length} positions` },
    { k: "Needs tax review", v: String(count("REVIEW_TAX")), n: "gain would be realized" },
    {
      k: "Pending / gaps",
      v: String(count("DATA_GAP") + count("PENDING_CUSTODIAN_DATA")),
      n: "awaiting custodian data",
    },
    { k: "Not eligible / no change", v: String(count("NO_CHANGE")), n: "correctly placed today" },
    {
      k: "Not actionable",
      v: String(count("HELD_AWAY_ADVISE") + count("SUPPRESSED")),
      n: "held-away, DAF, direct 529",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {tiles.map((t) => (
        <div
          key={t.k}
          className="rounded-xl border border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.02] px-4 py-3"
        >
          <div className="text-[11px] uppercase tracking-wider text-black/40 dark:text-white/40 leading-tight">
            {t.k}
          </div>
          <div className="mt-1.5 text-2xl font-semibold text-black dark:text-white tabular-nums">
            {t.v}
          </div>
          <div className="mt-0.5 text-[11px] text-black/40 dark:text-white/40 leading-snug">
            {t.n}
          </div>
        </div>
      ))}
    </div>
  );
}
