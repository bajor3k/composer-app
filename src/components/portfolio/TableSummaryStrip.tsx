// Shared summary strip for the lower portfolio tables — replaces the boxed
// summary cards with one calm horizontal row of label/value pairs. Same
// numbers, less chrome.
export type StripItem = {
  label: string;
  value: string;
  /** neutral = plain text · gain/loss = fixed color · signed = pick by raw's sign */
  tone?: "neutral" | "gain" | "loss" | "signed";
  raw?: number;
};

function toneClass(item: StripItem): string {
  const tone = item.tone === "signed" ? ((item.raw ?? 0) >= 0 ? "gain" : "loss") : item.tone ?? "neutral";
  if (tone === "gain") return "text-emerald-600 dark:text-emerald-500";
  if (tone === "loss") return "text-[#FF2D2D]";
  return "text-black dark:text-white";
}

export default function TableSummaryStrip({ items }: { items: StripItem[] }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2 mb-4">
      {items.map((it) => (
        <div key={it.label} className="flex items-baseline gap-2">
          <span className="text-xs text-black/40 dark:text-white/40 uppercase tracking-wider">{it.label}</span>
          <span className={`text-sm font-semibold ${toneClass(it)}`}>{it.value}</span>
        </div>
      ))}
    </div>
  );
}
