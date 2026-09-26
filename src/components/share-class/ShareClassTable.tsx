import type { AnalysisResult } from "@/lib/share-class/types";
import { fmt$, fmt$2 } from "@/lib/share-class/format";
import { ActionPill } from "./ActionPill";

const RECOMMEND_ACTIONS = new Set(["CONVERT", "REVIEW_TAX", "PENDING_CUSTODIAN_DATA"]);

// The Reason prose lives in the drill-down (row click) and the row tooltip — keeping it
// out of the table keeps rows single-line and scannable at drawer widths.
const COLUMNS: { label: string; align: "left" | "right"; px: string }[] = [
  { label: "Account", align: "left", px: "px-4" },
  { label: "Registration", align: "left", px: "px-3" },
  { label: "Cust.", align: "left", px: "px-3" },
  { label: "Current", align: "left", px: "px-3" },
  { label: "Recommended", align: "left", px: "px-3" },
  { label: "Market Value", align: "right", px: "px-3" },
  { label: "Cost cut (bps)", align: "right", px: "px-3" },
  { label: "Saves / yr", align: "right", px: "px-3" },
  { label: "Action", align: "left", px: "px-3" },
];

// A ticker + share-class pair (ticker emphasized, class muted).
function ClassCell({ ticker, cls }: { ticker?: string; cls?: string }) {
  if (!ticker) return <span className="text-black/30 dark:text-white/30">—</span>;
  return (
    <span className="whitespace-nowrap">
      <span className="font-medium text-black dark:text-white tabular-nums">{ticker}</span>
      {cls ? <span className="text-black/40 dark:text-white/40"> {cls}</span> : null}
    </span>
  );
}

export function ShareClassTable({
  rows,
  onSelect,
}: {
  rows: AnalysisResult[];
  onSelect: (r: AnalysisResult) => void;
}) {
  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 z-10">
        <tr className="border-b border-black/5 dark:border-white/5 bg-white dark:bg-[#0a0a0a] medium:bg-[#bcbcbc]">
          {COLUMNS.map((col) => (
            <th
              key={col.label}
              className={`text-${col.align} ${col.px} py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider whitespace-nowrap`}
            >
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const showRec = RECOMMEND_ACTIONS.has(r.action) && r.best;
          return (
            <tr
              key={r.h.account_id + "|" + r.h.ticker}
              onClick={() => onSelect(r)}
              title={r.reason}
              className="border-b border-black/5 dark:border-white/5 align-top transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02] cursor-pointer"
            >
              <td className="px-4 py-3.5">
                <div className="font-semibold text-black dark:text-white whitespace-nowrap">
                  {r.h.account_name}
                </div>
                <div className="text-[11px] text-black/40 dark:text-white/40">{r.h.account_id}</div>
              </td>
              <td className="px-3 py-3.5 whitespace-nowrap">
                <div className="text-black/70 dark:text-white/70 text-xs">{r.h.registration_type}</div>
                <div className="text-[10.5px] text-black/40 dark:text-white/40">
                  {r.h.advisory_or_brokerage}
                </div>
              </td>
              <td className="px-3 py-3.5 text-black/50 dark:text-white/50 text-xs whitespace-nowrap">
                {r.h.custodian}
              </td>
              <td className="px-3 py-3.5">
                <ClassCell ticker={r.h.ticker} cls={r.current?.share_class} />
              </td>
              <td className="px-3 py-3.5">
                {showRec ? (
                  <ClassCell ticker={r.best!.cls.ticker} cls={r.best!.cls.share_class} />
                ) : (
                  <span className="text-black/30 dark:text-white/30">—</span>
                )}
              </td>
              <td className="px-3 py-3.5 text-right tabular-nums text-black/70 dark:text-white/70 whitespace-nowrap">
                {fmt$(r.mv)}
              </td>
              <td
                className={`px-3 py-3.5 text-right tabular-nums whitespace-nowrap ${
                  r.savings > 0
                    ? "text-emerald-600 dark:text-emerald-500 font-medium"
                    : "text-black/30 dark:text-white/30"
                }`}
              >
                {r.savings > 0 ? r.deltaBps.toFixed(1) : "—"}
              </td>
              <td
                className={`px-3 py-3.5 text-right tabular-nums whitespace-nowrap ${
                  r.action === "CONVERT"
                    ? "text-emerald-600 dark:text-emerald-500 font-semibold"
                    : r.savings > 0
                      ? "text-black/70 dark:text-white/70"
                      : "text-black/30 dark:text-white/30"
                }`}
              >
                {r.savings > 0 ? fmt$2(r.savings) : "—"}
              </td>
              <td className="px-3 py-3.5">
                <ActionPill action={r.action} flagged={r.flags.length > 0} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
