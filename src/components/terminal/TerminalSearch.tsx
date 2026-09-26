"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { sanitizePostgrestSearch } from "@/lib/sanitize";

interface SearchResult {
  symbol: string;
  name: string;
  type?: string;
  exchange?: string;
  price?: number;
}

interface TerminalSearchProps {
  onSelect: (symbol: string, name: string) => void;
  compact?: boolean;
}

export default function TerminalSearch({ onSelect, compact }: TerminalSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.length === 0) {
      setResults([]);
      setOpen(false);
      return;
    }

    const timeout = setTimeout(async () => {
      // Search local Security table first
      const { data: dbResults } = await supabase
        .from("Security")
        .select("symbol, name, price")
        // Raw input here would be interpolated straight into a PostgREST
        // filter, where a comma or paren changes the parsed expression.
        .or(
          `symbol.ilike.%${sanitizePostgrestSearch(query)}%,name.ilike.%${sanitizePostgrestSearch(query)}%`,
        )
        .order("symbol")
        .limit(5);

      const local: SearchResult[] = (dbResults ?? []).map((r) => ({
        symbol: r.symbol,
        name: r.name,
        price: Number(r.price),
      }));

      // Fallback to Yahoo Finance search
      let yahoo: SearchResult[] = [];
      if (local.length < 3) {
        try {
          const res = await fetch(`/api/quote/search?q=${encodeURIComponent(query)}`);
          if (res.ok) {
            const data = await res.json();
            yahoo = (data.results ?? [])
              .filter((r: SearchResult) => !local.some((l) => l.symbol === r.symbol))
              .map((r: SearchResult) => ({
                symbol: r.symbol,
                name: r.name,
                type: r.type,
                exchange: r.exchange,
              }));
          }
        } catch { /* ignore */ }
      }

      setResults([...local, ...yahoo].slice(0, 8));
      setHighlightedIndex(-1);
      setOpen(true);
    }, 300);

    return () => clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
        <svg
          className={`absolute ${compact ? "left-2.5 w-3.5 h-3.5 text-black/20 dark:text-white/20" : "left-3 w-4 h-4 text-black/30 dark:text-white/30"} top-1/2 -translate-y-1/2`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
        <input
          type="text"
          placeholder={compact ? "Tickers" : "Search any ticker or company..."}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          onKeyDown={(e) => {
            if (!open || results.length === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlightedIndex((prev) => (prev + 1) % results.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlightedIndex((prev) => (prev <= 0 ? results.length - 1 : prev - 1));
            } else if (e.key === "Enter" && highlightedIndex >= 0) {
              e.preventDefault();
              const r = results[highlightedIndex];
              onSelect(r.symbol, r.name);
              setQuery("");
              setResults([]);
              setOpen(false);
              setHighlightedIndex(-1);
            } else if (e.key === "Escape") {
              setOpen(false);
              setHighlightedIndex(-1);
            }
          }}
          className={compact
            ? "w-full pl-8 pr-3 py-1.5 rounded-lg text-[11px] bg-black/[0.03] dark:bg-white/[0.03] text-black dark:text-white placeholder:text-black/20 dark:placeholder:text-white/20 outline-none border border-transparent focus:border-black/10 dark:focus:border-white/10 transition-colors"
            : "w-full pl-9 pr-4 py-2 bg-black/5 dark:bg-white/5 rounded-lg text-sm text-black dark:text-white placeholder-black/30 dark:placeholder-white/30 outline-none focus:ring-1 focus:ring-black/10 dark:focus:ring-white/10"
          }
        />
      </div>

      {open && results.length > 0 && (
        <div className="absolute z-50 top-full mt-2 w-full bg-white dark:bg-[#111] rounded-xl shadow-lg border border-black/10 dark:border-white/10 overflow-hidden max-h-80 overflow-y-auto">
          {results.map((r, i) => (
            <button
              key={r.symbol}
              onClick={() => {
                onSelect(r.symbol, r.name);
                setQuery("");
                setResults([]);
                setOpen(false);
                setHighlightedIndex(-1);
              }}
              onMouseEnter={() => setHighlightedIndex(i)}
              className={`w-full px-4 py-3 flex items-center justify-between transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-black/15 dark:focus-visible:ring-white/15 ${
                i === highlightedIndex
                  ? "bg-black/[0.06] dark:bg-white/[0.06]"
                  : "hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="font-semibold text-sm text-black dark:text-white">{r.symbol}</span>
                <span className="text-xs text-black/40 dark:text-white/40 truncate max-w-[300px]">{r.name}</span>
              </div>
              <div className="flex items-center gap-2">
                {r.price && (
                  <span className="text-sm text-black/50 dark:text-white/50 tabular-nums">
                    ${r.price.toFixed(2)}
                  </span>
                )}
                {r.exchange && (
                  <span className="text-[10px] text-black/30 dark:text-white/30 uppercase">{r.exchange}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
