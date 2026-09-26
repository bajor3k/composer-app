"use client";

import { useState, useEffect, useRef } from "react";

interface EtfMatch {
  etfSymbol: string;
  holdingName: string;
  weight: number;
  value: number | null;
  shares: number | null;
}

interface EtfExposureProps {
  symbol: string;
  name: string;
  onSelect?: (symbol: string, name: string) => void;
}

function fmtValue(val: number | null): string {
  if (val == null) return "—";
  if (val >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
  if (val >= 1e6) return `$${(val / 1e6).toFixed(0)}M`;
  return `$${val.toLocaleString()}`;
}

export default function EtfExposure({ symbol, name, onSelect }: EtfExposureProps) {
  const [etfs, setEtfs] = useState<EtfMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Abort previous request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setEtfs([]);
    setLoading(true);
    setFailed(false);

    const params = new URLSearchParams();
    params.set("symbol", symbol);
    params.set("name", name);

    fetch(`/api/terminal/equity-exposure?${params.toString()}`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error("failed");
        return res.json();
      })
      .then((json) => {
        if (!controller.signal.aborted) {
          setEtfs(json.etfs ?? []);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          if (err.name !== "AbortError") {
            setFailed(true);
          }
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [symbol, name]);

  // Hide if server unavailable or no results after loading
  if (failed) return null;
  if (!loading && etfs.length === 0) return null;

  return (
    <div>
      <h4 className="text-xs font-semibold text-black dark:text-white uppercase tracking-wider mb-3">
        ETFs Holding {symbol}
      </h4>

      {loading && (
        <div className="space-y-1">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-4 py-2 px-3">
              <div className="w-14 h-4 shrink-0 bg-black/[0.03] dark:bg-white/[0.03] animate-pulse rounded" />
              <div className="w-12 h-4 bg-black/[0.03] dark:bg-white/[0.03] animate-pulse rounded" />
              <div className="w-16 h-3 bg-black/[0.03] dark:bg-white/[0.03] animate-pulse rounded" />
            </div>
          ))}
        </div>
      )}

      {!loading && etfs.length > 0 && (
        <div className="space-y-1">
          {etfs.map((etf) => (
            <div
              key={etf.etfSymbol}
              role="button"
              tabIndex={0}
              onClick={() => onSelect?.(etf.etfSymbol, etf.etfSymbol)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect?.(etf.etfSymbol, etf.etfSymbol);
                }
              }}
              className="flex items-center gap-4 py-2 px-3 rounded-lg hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/15 dark:focus-visible:ring-white/15"
            >
              <span className="text-sm font-semibold text-black dark:text-white w-14 shrink-0">
                {etf.etfSymbol}
              </span>
              <span className="text-sm font-medium text-black/70 dark:text-white/70 tabular-nums">
                {(etf.weight * 100).toFixed(2)}%
              </span>
              <span className="text-xs text-black/30 dark:text-white/30 tabular-nums">
                {fmtValue(etf.value)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
