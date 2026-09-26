import type { AnalysisResult } from "@/lib/share-class/types";
import { actionLabel } from "./ActionPill";

export interface Filters {
  advisor: string;
  household: string;
  custodian: string;
  registration: string;
  action: string;
}

export const EMPTY_FILTERS: Filters = {
  advisor: "ALL",
  household: "ALL",
  custodian: "ALL",
  registration: "ALL",
  action: "ALL",
};

type FilterKey = keyof Filters;

// `pick` is the value filtered on (a stable key); `labelOf` is what the user reads.
// Households are keyed by id but shown by name, so two households sharing a name are
// never merged.
const DEFS: {
  key: FilterKey;
  label: string;
  pick: (r: AnalysisResult) => string;
  labelOf?: (r: AnalysisResult) => string;
}[] = [
  { key: "advisor", label: "Advisor", pick: (r) => r.h.advisor },
  {
    key: "household",
    label: "Household",
    pick: (r) => r.h.household_id,
    labelOf: (r) => r.h.household_name || r.h.household_id,
  },
  { key: "custodian", label: "Custodian", pick: (r) => r.h.custodian },
  { key: "registration", label: "Registration", pick: (r) => r.h.registration_type },
  { key: "action", label: "Action", pick: (r) => r.action, labelOf: (r) => actionLabel(r.action) },
];

function optionsFor(
  results: AnalysisResult[],
  def: (typeof DEFS)[number],
): { value: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const r of results) {
    const value = def.pick(r);
    if (!value || seen.has(value)) continue;
    seen.set(value, def.labelOf ? def.labelOf(r) : value);
  }
  const opts = [...seen.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [{ value: "ALL", label: "All" }, ...opts];
}

export function FilterBar({
  results,
  filters,
  onChange,
  onExport,
  onUpload,
}: {
  results: AnalysisResult[];
  filters: Filters;
  onChange: (next: Filters) => void;
  onExport: () => void;
  onUpload: (file: File) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      {DEFS.map((def) => (
        <label key={def.key} className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-black/40 dark:text-white/40">
            {def.label}
          </span>
          <select
            value={filters[def.key]}
            onChange={(e) => onChange({ ...filters, [def.key]: e.target.value })}
            className="bg-black/5 dark:bg-white/5 rounded-lg text-sm text-black dark:text-white px-3 py-2 outline-none border border-transparent focus:border-black/10 dark:focus:border-white/10 min-w-[9rem] max-w-[14rem]"
          >
            {optionsFor(results, def).map((o) => (
              <option key={o.value} value={o.value} className="bg-white dark:bg-[#111]">
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ))}

      <div className="flex items-end gap-2 ml-auto">
        <button
          onClick={onExport}
          className="text-xs font-medium px-3 py-2 rounded-lg bg-black/5 dark:bg-white/5 text-black dark:text-white hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
        >
          Export CSV
        </button>
        <label className="text-xs font-medium px-3 py-2 rounded-lg bg-black/5 dark:bg-white/5 text-black dark:text-white hover:bg-black/10 dark:hover:bg-white/10 transition-colors cursor-pointer">
          Load holdings CSV
          <input
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>
    </div>
  );
}
