"use client";

import { useEffect } from "react";
import type { AnalysisResult, Candidate } from "@/lib/share-class/types";
import { CONFIG } from "@/lib/share-class/config";
import { num, fmt$, fmt$2 } from "@/lib/share-class/format";

// The audit-trail drill-down: every class of the fund that was considered, why each
// was accepted or rejected, and the arithmetic. Ported from the prototype's detail().

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h4 className="text-[10.5px] uppercase tracking-wider text-black/40 dark:text-white/40 mb-2 pb-1.5 border-b border-black/5 dark:border-white/5">
        {title}
      </h4>
      {children}
    </div>
  );
}

function MathBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre className="font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap bg-black/[0.03] dark:bg-white/[0.03] border border-black/5 dark:border-white/5 rounded-lg p-3 tabular-nums text-black/80 dark:text-white/80 overflow-x-auto">
      {children}
    </pre>
  );
}

function Note({
  children,
  tone = "warn",
}: {
  children: React.ReactNode;
  tone?: "warn" | "info";
}) {
  const styles =
    tone === "info"
      ? "bg-blue-500/5 border-blue-500/40 text-black/70 dark:text-white/70"
      : "bg-[#F59E0B]/5 border-[#F59E0B]/50 text-black/70 dark:text-white/70";
  return (
    <div className={`border-l-2 ${styles} rounded-r-md px-3 py-2.5 text-[12px] leading-snug mb-3.5`}>
      {children}
    </div>
  );
}

function QualityBadge({ q }: { q?: string }) {
  if (!q) return null;
  const style =
    q === "VERIFIED"
      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-500"
      : q === "ASSUMED"
        ? "bg-orange-500/10 text-orange-600 dark:text-orange-400"
        : "bg-black/5 dark:bg-white/10 text-black/50 dark:text-white/50";
  return (
    <span className={`ml-1.5 px-1.5 py-0.5 rounded text-[9.5px] font-semibold tracking-wide ${style}`}>
      {q}
    </span>
  );
}

export function DetailPanel({
  result: r,
  onClose,
}: {
  result: AnalysisResult;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cur = r.current;

  // Current position cost math block.
  let currentCostBlock: string | null = null;
  if (r.curCost && cur && r.curAv) {
    const c = r.curCost;
    currentCostBlock =
      `expense ratio   ${cur.net_expense_ratio.toFixed(2)}%  ×  ${fmt$2(r.mv)}   =  ${fmt$2(c.er)}\n` +
      `ticket charges  ${r.trades} trades/yr × ${fmt$2(c.perTrade)}  =  ${fmt$2(c.ticket)}   [${r.curAv.fee_status}]\n` +
      `platform fee    ${c.abpBps} bps ${r.curAv.abp_exempt === "Y" ? "(exempt — NTF)" : ""}  =  ${fmt$2(c.abp)}\n` +
      `                                              ─────────────\n` +
      `total annual cost                              ${fmt$2(c.total)}`;
  }

  // Transition cost math block.
  let transitionBlock: string | null = null;
  if (r.transition) {
    const t = r.transition;
    transitionBlock =
      t.parts.map((p) => "• " + p).join("\n") +
      (t.total > 0
        ? `\n${"─".repeat(13)}\ntotal one-time  ${fmt$2(t.total)}   ·   annual saving ${fmt$2(
            r.savings,
          )}   →   payback ~${
            (r.paybackMonths ?? 0) < 1 ? "under 1 month" : Math.ceil(r.paybackMonths ?? 0) + " months"
          }`
        : "");
  }

  // Classes considered — sorted by all-in cost, unpriced last.
  const sortedCandidates: Candidate[] = [...r.candidates].sort(
    (a, b) => (a.priced ? a.cost!.total : 1e12) - (b.priced ? b.cost!.total : 1e12),
  );

  // Breakeven block.
  let breakevenBlock: string | null = null;
  if (r.trades && r.trades > 0 && r.best?.priced && r.curCost && cur) {
    const dER = (cur.net_expense_ratio - r.best.cls.net_expense_ratio) / 100;
    const T = r.best.cost!.perTrade;
    if (dER > 0 && T > 0) {
      const P = (r.trades * T) / dER;
      breakevenBlock =
        `P* = (N × T) / ΔER\n` +
        `   = (${r.trades} trades/yr × ${fmt$2(T)}) / ${(dER * 100).toFixed(2)}%\n` +
        `   = ${fmt$(P)}\n\n` +
        `position ${fmt$(r.mv)} is ${r.mv > P ? "ABOVE" : "BELOW"} breakeven → ${
          r.mv > P ? "the transaction-fee class wins" : "staying NTF is cheaper"
        }`;
    } else if (dER > 0 && T === 0) {
      breakevenBlock =
        `Ticket charge for systematic trades at ${r.h.custodian} = ${fmt$2(0)}\n` +
        `→ breakeven is ${fmt$(0)} — the transaction-fee class wins at any position size.`;
    }
  }

  const showErOnlyCaveat = r.curCost?.erOnly || r.best?.cost?.erOnly;
  const assumed = CONFIG.assumedTickets[r.h.custodian];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-[1px]"
      />
      <div className="relative w-full max-w-3xl max-h-[85vh] rounded-2xl bg-white dark:bg-[#111] border border-black/10 dark:border-white/10 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-black/5 dark:border-white/5">
          <div>
            <h3 className="text-base font-semibold text-black dark:text-white">
              {r.h.account_name} — {r.h.ticker}
            </h3>
            <div className="text-xs text-black/40 dark:text-white/40 mt-0.5">
              {r.h.account_id} · {r.h.registration_type} · {r.h.custodian} ·{" "}
              {r.h.advisory_or_brokerage} · {fmt$(r.mv)}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-black/5 dark:bg-white/5 text-black/70 dark:text-white/70 hover:bg-black/10 dark:hover:bg-white/10 transition-colors shrink-0"
          >
            Close
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 overflow-y-auto">
          <Note tone="info">
            <strong>Audit trail.</strong> Every class of this fund that was considered, why each
            was accepted or rejected, and the arithmetic. This is the record a reviewer would need
            to reconstruct the decision.
          </Note>

          <Section title="Decision">
            <div className="mb-2">
              <ActionBadge action={r.action} />
            </div>
            <div className="text-[13px] text-black/80 dark:text-white/80 leading-snug">
              {r.reason}
            </div>
          </Section>

          {r.flags.map((fl, i) => (
            <Note key={i}>⚠ {fl}</Note>
          ))}

          {currentCostBlock && cur && (
            <Section title={`Current position cost — ${r.h.ticker} (Class ${cur.share_class})`}>
              <MathBlock>{currentCostBlock}</MathBlock>
            </Section>
          )}

          {transitionBlock && (
            <Section title="One-time transition cost">
              <MathBlock>{transitionBlock}</MathBlock>
              {r.transition?.unknown && (
                <div className="text-[11.5px] text-black/40 dark:text-white/40 mt-1.5">
                  Some transition charges cannot be computed until the custodian fee schedule
                  arrives.
                </div>
              )}
            </Section>
          )}

          {sortedCandidates.length > 0 && (
            <Section title="Classes considered">
              <div className="space-y-2">
                {sortedCandidates.map((c, i) => {
                  const win =
                    r.best && c.cls.ticker === r.best.cls.ticker && r.action !== "NO_CHANGE";
                  return (
                    <div
                      key={c.cls.ticker + i}
                      className={`rounded-lg border px-3 py-2.5 ${
                        win
                          ? "border-emerald-500/40 bg-emerald-500/[0.06]"
                          : "border-black/5 dark:border-white/5 bg-black/[0.015] dark:bg-white/[0.015]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3 mb-1">
                        <div className="text-[13px]">
                          <span className="font-medium text-black dark:text-white tabular-nums">
                            {c.cls.ticker}
                          </span>{" "}
                          <span className="text-black/70 dark:text-white/70">
                            Class {c.cls.share_class}
                          </span>
                          <span className="text-[11.5px] text-black/40 dark:text-white/40">
                            {" "}
                            · ER {c.cls.net_expense_ratio.toFixed(2)}% · 12b-1 {c.cls.twelve_b_1}%
                          </span>
                        </div>
                        <div className="text-[13px] tabular-nums text-black/70 dark:text-white/70 shrink-0">
                          {c.priced ? fmt$2(c.cost!.total) + "/yr" : "—"}
                        </div>
                      </div>
                      <div className="text-[11.5px] text-black/60 dark:text-white/60 leading-snug">
                        {win && <strong>SELECTED — </strong>}
                        {c.reason}
                      </div>
                      {c.priced && c.cost && c.av && (
                        <div className="font-mono text-[11px] text-black/40 dark:text-white/40 mt-1.5">
                          ER {fmt$2(c.cost.er)} + tickets {fmt$2(c.cost.ticket)} + platform{" "}
                          {fmt$2(c.cost.abp)} · {c.av.fee_status}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {breakevenBlock && (
            <Section title="TF vs NTF breakeven">
              <MathBlock>{breakevenBlock}</MathBlock>
              <div className="text-[11.5px] text-black/40 dark:text-white/40 mt-1.5 leading-snug">
                {r.best?.cost?.perTrade === 0
                  ? "This is the single biggest lever in the analysis and it differs by custodian."
                  : "Uses current market value as a proxy for average balance over the holding period. A real model needs the advisor's expected holding period — it is not derivable from custodian data."}
              </div>
            </Section>
          )}

          {r.h.beneficiary_age && (
            <Note>
              529 beneficiary is age {r.h.beneficiary_age} — roughly {r.h.expected_holding_years}{" "}
              years to enrollment. FINRA's 529 Plan Share Class Initiative (Reg. Notice 19-04)
              treated C shares held for young beneficiaries over long horizons as a supervisory
              concern independent of cost. Flagging for review.
            </Note>
          )}

          {r.hhValue !== undefined && cur && (
            <Section title="Household aggregation">
              <div className="text-[12.5px] text-black/80 dark:text-white/80">
                Household <strong>{r.h.household_name || r.h.household_id}</strong> holds{" "}
                <strong>{fmt$(r.hhValue)}</strong> in {cur.fund_name} across all accounts, vs{" "}
                {fmt$(r.mv)} in this account alone.
              </div>
              <div className="text-[11.5px] text-black/40 dark:text-white/40 mt-1.5 leading-snug">
                Minimums are tested against the household total. <strong>Caveat:</strong> real Rights
                of Accumulation rules are set by each fund family's prospectus — which registrations
                and related parties may aggregate varies, and there is no cross-family standard. This
                simple same-fund household sum is a placeholder for that logic.
              </div>
            </Section>
          )}

          {showErOnlyCaveat && (
            <Note>
              <strong>ER-only comparison — custodian data pending.</strong> NTF/TF status for these
              classes at {r.h.custodian} is unknown, so ticket charges and platform fees are
              EXCLUDED from the numbers above. Context: if the recommended class is transaction-fee
              at {r.h.custodian}, an assumed schedule of{" "}
              {assumed ? fmt$2(num(assumed.sys)) : "—"} per systematic trade /{" "}
              {assumed ? fmt$2(num(assumed.adhoc)) : "—"} ad-hoc would apply
              {r.trades && r.trades > 0 ? ` (${r.trades} trades/yr here)` : ""} — firm-negotiated
              rates differ. This is exactly the file to request from the custodian.
            </Note>
          )}

          <Section title="Provenance">
            <div className="font-mono text-[11px] text-black/50 dark:text-white/50 leading-relaxed">
              <div>
                fund reference: {cur?.source ?? "—"} · as-of{" "}
                {cur?.as_of_date || cur?.filing_date || "—"}
                {cur?.accession ? ` · EDGAR accession ${cur.accession}` : ""}
                <QualityBadge q={cur?.data_quality} />
              </div>
              <div>
                availability: {r.curAv?.source ?? "—"} · as-of {r.curAv?.as_of_date || "—"}
                {r.curAv?.fee_status === "UNKNOWN" ? <QualityBadge q="ASSUMED" /> : null}
              </div>
              <div>conversion supported (family policy): {cur?.conversion_supported ?? "—"}</div>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

// Local action badge (larger than the table pill) for the Decision header.
function ActionBadge({ action }: { action: string }) {
  const styles: Record<string, string> = {
    CONVERT: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-500",
    NO_CHANGE: "bg-black/5 dark:bg-white/10 text-black/60 dark:text-white/60",
    SUPPRESSED: "bg-black/5 dark:bg-white/10 text-black/60 dark:text-white/60",
    REVIEW_TAX: "bg-[#F59E0B]/10 text-[#B45309] dark:text-[#F59E0B]",
    HELD_AWAY_ADVISE: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    DATA_GAP: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    PENDING_CUSTODIAN_DATA: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  };
  return (
    <span
      className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold ${styles[action] ?? styles.NO_CHANGE}`}
    >
      {action.replace(/_/g, " ")}
    </span>
  );
}
