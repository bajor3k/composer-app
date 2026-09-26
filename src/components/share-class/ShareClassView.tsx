"use client";

import { useEffect, useMemo, useState } from "react";
import { analyzeBook } from "@/lib/share-class/engine";
import { loadDataset } from "@/lib/share-class/datasets";
import { fetchDbHoldings } from "@/lib/share-class/db-holdings";
import { parseCSV } from "@/lib/share-class/csv";
import { fmt$ } from "@/lib/share-class/format";
import { CONFIG } from "@/lib/share-class/config";
import type { AnalysisResult, RawRow } from "@/lib/share-class/types";
import { KpiTiles } from "./KpiTiles";
import { FilterBar, EMPTY_FILTERS, type Filters } from "./FilterBar";
import { ShareClassTable } from "./ShareClassTable";
import { DetailPanel } from "./DetailPanel";

interface EdgarState {
  status: "idle" | "loading" | "done" | "error";
  asOf?: string | null;
  matched?: number;
  total?: number;
  error?: string;
}

export function ShareClassView() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [uploaded, setUploaded] = useState<RawRow[] | null>(null);
  const [uploadInfo, setUploadInfo] = useState<string | null>(null);
  const [selected, setSelected] = useState<AnalysisResult | null>(null);
  const [edgar, setEdgar] = useState<EdgarState>({ status: "idle" });
  const [dbHoldings, setDbHoldings] = useState<RawRow[] | null>(null);
  const [source, setSource] = useState<"loading" | "live" | "sample">("loading");

  // Load the firm's real fund positions. Falls back to the built-in sample book if the
  // query fails or no fund positions exist in the book yet.
  useEffect(() => {
    let cancelled = false;
    fetchDbHoldings()
      .then((rows) => {
        if (cancelled) return;
        if (rows.length) {
          setDbHoldings(rows);
          setSource("live");
        } else {
          setSource("sample");
        }
      })
      .catch(() => {
        if (!cancelled) setSource("sample");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Run the engine. An uploaded CSV wins, then the firm's real positions, then the
  // sample book. Fund reference and custodian availability always come from the
  // built-in files.
  const results = useMemo(() => {
    const { funds, avail, holdings } = loadDataset();
    return analyzeBook(funds, avail, uploaded ?? dbHoldings ?? holdings);
  }, [uploaded, dbHoldings]);

  const filtered = useMemo(
    () =>
      results.filter(
        (r) =>
          (filters.custodian === "ALL" || r.h.custodian === filters.custodian) &&
          (filters.registration === "ALL" || r.h.registration_type === filters.registration) &&
          (filters.action === "ALL" || r.action === filters.action) &&
          (filters.household === "ALL" || r.h.household_id === filters.household) &&
          (filters.advisor === "ALL" || r.h.advisor === filters.advisor),
      ),
    [results, filters],
  );

  const rows = useMemo(
    () => [...filtered].sort((a, b) => b.savings - a.savings),
    [filtered],
  );

  const accountCount = useMemo(
    () => new Set(results.map((r) => r.h.account_id)).size,
    [results],
  );

  const savingIdentified = filtered.reduce(
    (s, r) => s + (r.action === "CONVERT" ? r.savings : 0),
    0,
  );
  const pendingSaving = filtered.reduce(
    (s, r) => s + (r.action === "PENDING_CUSTODIAN_DATA" ? r.savings : 0),
    0,
  );

  // Live provenance check: confirm each fund on screen against SEC EDGAR and pull its
  // latest 485BPOS filing date. Fee numbers stay from the verified dataset — this keeps
  // the "as-of" provenance honest and current.
  async function refreshEdgar() {
    const tickers = [...new Set(results.map((r) => r.h.ticker))].filter(Boolean);
    if (!tickers.length) return;
    setEdgar({ status: "loading" });
    try {
      const res = await fetch(
        `/api/share-class/edgar?tickers=${encodeURIComponent(tickers.join(","))}`,
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `EDGAR request failed (${res.status})`);
      }
      const j = (await res.json()) as {
        data: { ticker: string; found: boolean; latestFiling?: { filingDate: string } | null }[];
      };
      const found = j.data.filter((d) => d.found && d.latestFiling);
      const asOf = found
        .map((d) => d.latestFiling!.filingDate)
        .sort()
        .reverse()[0];
      setEdgar({ status: "done", asOf: asOf ?? null, matched: found.length, total: j.data.length });
    } catch (e) {
      setEdgar({ status: "error", error: e instanceof Error ? e.message : "EDGAR request failed" });
    }
  }

  function onUpload(file: File) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = parseCSV(String(ev.target?.result ?? ""));
        setUploaded(parsed);
        setFilters(EMPTY_FILTERS);
        setUploadInfo(
          `Loaded ${parsed.length} positions from ${file.name}. Fund reference and custodian availability are still the built-in files — any ticker not in them returns DATA GAP, which is the honest answer.`,
        );
      } catch {
        setUploadInfo(`Could not parse ${file.name} as CSV.`);
      }
    };
    reader.readAsText(file);
  }

  function onExport() {
    const head = [
      "account_id", "account_name", "advisor", "household", "registration_type", "custodian",
      "advisory_or_brokerage", "current_ticker", "current_class", "current_er", "recommended_ticker",
      "recommended_class", "recommended_er", "market_value", "current_annual_cost",
      "recommended_annual_cost", "annual_saving", "delta_bps", "action", "reason", "embedded_gain",
      "ref_as_of", "avail_as_of", "ref_source",
    ];
    const data: (string | number | undefined)[][] = rows.map((r) => [
      r.h.account_id, r.h.account_name, r.h.advisor, r.h.household_name || r.h.household_id, r.h.registration_type,
      r.h.custodian, r.h.advisory_or_brokerage, r.h.ticker, r.current?.share_class ?? "",
      r.current?.net_expense_ratio ?? "", r.best?.cls.ticker ?? "", r.best?.cls.share_class ?? "",
      r.best?.cls.net_expense_ratio ?? "", r.mv.toFixed(2), r.curCost?.total.toFixed(2) ?? "",
      r.best?.cost?.total.toFixed(2) ?? "", r.action === "CONVERT" ? r.savings.toFixed(2) : "0.00",
      r.savings > 0 ? r.deltaBps.toFixed(1) : "", r.action, r.reason, r.gain?.toFixed(2) ?? "",
      r.current?.as_of_date ?? "", r.curAv?.as_of_date ?? "", r.current?.source ?? "",
    ]);
    const csv = [head, ...data]
      .map((row) =>
        row
          .map((cell) => {
            const s = String(cell ?? "");
            return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
          })
          .join(","),
      )
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "share-class-review.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {/* Header — static block above the scroll container. pt-12 clears the drawer's floating control band. */}
      <div className="px-16 pt-12 pb-4">
        <div className="flex items-center gap-6 flex-wrap">
          <h1 className="text-lg font-semibold text-black dark:text-white">Share Class Analysis</h1>
          <div className="flex items-center gap-6 text-sm">
            <div>
              <span className="text-black/50 dark:text-white/50">Positions:</span>{" "}
              <span className="font-semibold text-black dark:text-white">{filtered.length}</span>
            </div>
            <div>
              <span className="text-black/50 dark:text-white/50">Saving identified:</span>{" "}
              <span className="font-semibold text-black dark:text-white tabular-nums">
                {fmt$(savingIdentified)}
              </span>
              {pendingSaving > 0 && (
                <span className="text-black/40 dark:text-white/40">
                  {" "}
                  + {fmt$(pendingSaving)} pending
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Scroll container. Everything aligns to px-16; the table's sticky thead pins to
          the top of this scroller. */}
      <div className="flex-1 overflow-y-auto px-16 pb-12">
        <p className="text-[13px] text-black/50 dark:text-white/50 max-w-3xl">
          Finds cheaper share classes a client is <em>eligible</em> to hold, net of ticket charges
          and platform fees — and shows its work.
        </p>

        <div className="mt-6">
          <KpiTiles results={filtered} />
        </div>

        {/* Positions */}
        <div className="mt-8 flex items-end justify-between gap-4 flex-wrap mb-4">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-sm font-semibold text-black dark:text-white">Positions</h2>
            <SourceBadge
              source={uploaded ? "upload" : source}
              accounts={accountCount}
            />
            <EdgarRefresh edgar={edgar} onRefresh={refreshEdgar} />
          </div>
          <FilterBar
            results={results}
            filters={filters}
            onChange={setFilters}
            onExport={onExport}
            onUpload={onUpload}
          />
        </div>
        {uploadInfo && (
          <div className="mb-3 text-[11.5px] text-black/50 dark:text-white/50 bg-black/[0.03] dark:bg-white/[0.03] rounded-lg px-3 py-2">
            {uploadInfo}
          </div>
        )}

        <ShareClassTable rows={rows} onSelect={setSelected} />
        {rows.length === 0 && (
          <div className="text-center py-16 text-black/40 dark:text-white/40 text-sm">
            No positions match the current filters.
          </div>
        )}

        <FirmConfig />
        <Footer />
      </div>

      {selected && <DetailPanel result={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

// Where the positions on screen came from — real book, uploaded file, or the built-in
// sample. Kept quiet; it matters most when the firm's book hasn't loaded.
function SourceBadge({
  source,
  accounts,
}: {
  source: "loading" | "live" | "sample" | "upload";
  accounts: number;
}) {
  const label =
    source === "loading"
      ? "Loading accounts…"
      : source === "live"
        ? `${accounts} accounts`
        : source === "upload"
          ? `Uploaded file · ${accounts} accounts`
          : "Sample book";
  return (
    <span className="text-[11px] text-black/40 dark:text-white/40 tabular-nums">{label}</span>
  );
}

// Neutral inline EDGAR control. Blends with the toolbar; shows live provenance once refreshed.
function EdgarRefresh({ edgar, onRefresh }: { edgar: EdgarState; onRefresh: () => void }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        onClick={onRefresh}
        disabled={edgar.status === "loading"}
        className="text-[11px] font-medium px-2.5 py-1 rounded-md bg-black/5 dark:bg-white/5 text-black/60 dark:text-white/60 hover:bg-black/10 dark:hover:bg-white/10 hover:text-black dark:hover:text-white transition-colors disabled:opacity-50"
      >
        {edgar.status === "loading" ? "Checking EDGAR…" : "Refresh from EDGAR"}
      </button>
      {edgar.status === "done" && (
        <span className="text-[11px] text-black/40 dark:text-white/40 tabular-nums">
          Live · latest 485BPOS as-of {edgar.asOf ?? "—"} · {edgar.matched}/{edgar.total} on EDGAR
        </span>
      )}
      {edgar.status === "error" && (
        <span className="text-[11px] text-black/50 dark:text-white/50">{edgar.error}</span>
      )}
    </div>
  );
}

function FirmConfig() {
  return (
    <div className="mt-10 rounded-xl border border-black/5 dark:border-white/5 px-4 py-4">
      <h2 className="text-sm font-semibold text-black dark:text-white mb-3">Firm configuration</h2>
      <div className="flex flex-wrap gap-x-8 gap-y-2 text-[12.5px] text-black/60 dark:text-white/60">
        <div>
          Pershing asset-based pricing:{" "}
          <code className="font-mono bg-black/5 dark:bg-white/10 px-1.5 py-0.5 rounded text-black/80 dark:text-white/80">
            {CONFIG.abpBps.PERSHING} bps
          </code>{" "}
          on non-FundVest-NTF assets
        </div>
        <div>
          Schwab: <code className="font-mono bg-black/5 dark:bg-white/10 px-1.5 py-0.5 rounded text-black/80 dark:text-white/80">0 bps</code>
        </div>
        <div>
          Fidelity: <code className="font-mono bg-black/5 dark:bg-white/10 px-1.5 py-0.5 rounded text-black/80 dark:text-white/80">0 bps</code>
        </div>
      </div>
      <p className="mt-3 text-[11.5px] text-black/40 dark:text-white/40 leading-snug max-w-4xl">
        These are placeholders. Real values are firm-negotiated and must come from our custodian
        relationship managers — they are not published. The Pershing figure materially changes
        NTF-vs-TF outcomes and is the clearest example of why this tool cannot be built from public
        data.
      </p>
    </div>
  );
}

function Footer() {
  return (
    <div className="mt-8 pt-5 border-t border-black/5 dark:border-white/5 text-[11.5px] text-black/40 dark:text-white/40 leading-relaxed max-w-4xl space-y-2">
      <p>
        <strong className="text-black/60 dark:text-white/60">
          What this tool deliberately does not do:
        </strong>{" "}
        model revenue sharing, sub-TA fees, or negotiated schedules beyond one default; compute
        breakpoints or Rights of Accumulation beyond simple
        same-fund household aggregation; account for fund-family-specific ROA linkage rules; or reach
        any conclusion about a client, an account, or the firm&apos;s obligations.
      </p>
      <p>
        <strong className="text-black/60 dark:text-white/60">On the regulatory framing:</strong> the
        SEC&apos;s 2018 Share Class Selection Disclosure Initiative was a Division of Enforcement
        self-report program, not a rule. Its orders charged failure to <em>disclose</em> the conflict
        under Advisers Act §206(2) — not the act of selecting a costlier class. This tool therefore
        flags positions for <em>human review</em>. It never renders a verdict.
      </p>
    </div>
  );
}
