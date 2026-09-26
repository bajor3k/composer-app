"use client";

import { useEffect, useRef, useState } from "react";
import { formatMarketCap, formatVolume } from "@/lib/format-utils";

interface QuoteData {
  symbol: string;
  name: string;
  price: number;
  previousClose: number;
  change: number;
  changePercent: number;
  high52w: number;
  low52w: number;
  dayHigh: number;
  dayLow: number;
  open: number;
  volume: number;
  marketCap: number;
  peRatio: number | null;
  dividendYield: number | null;
  quoteType: string;
}

interface PeriodChange {
  change: number;
  changePercent: number;
  label: string;
}

interface CrosshairData {
  price: number;
  change: number;
  changePercent: number;
  time: number;
}

interface SecurityHeaderProps {
  quote: QuoteData;
  isWatchlisted: boolean;
  onToggleWatchlist?: () => void;
  periodChange?: PeriodChange | null;
  crosshairData?: CrosshairData | null;
}


export default function SecurityHeader({ quote, isWatchlisted, onToggleWatchlist, periodChange, crosshairData }: SecurityHeaderProps) {
  const defaultChange = periodChange ?? { change: quote.change, changePercent: quote.changePercent, label: "Today" };

  // Animated price that smoothly interpolates toward target
  const isHovering = crosshairData != null;
  const targetPrice = isHovering ? crosshairData.price : quote.price;
  const targetChange = isHovering ? crosshairData.change : defaultChange.change;
  const targetChangePercent = isHovering ? crosshairData.changePercent : defaultChange.changePercent;

  const [animPrice, setAnimPrice] = useState(quote.price);
  const [animChange, setAnimChange] = useState(defaultChange.change);
  const [animChangePercent, setAnimChangePercent] = useState(defaultChange.changePercent);
  const rafRef = useRef<number>(0);
  const currentRef = useRef({ price: quote.price, change: defaultChange.change, pct: defaultChange.changePercent });

  useEffect(() => {
    const target = { price: targetPrice, change: targetChange, pct: targetChangePercent };
    let running = true;

    function tick() {
      if (!running) return;
      const lerp = 0.25; // smoothing factor — higher = snappier
      const cur = currentRef.current;
      cur.price += (target.price - cur.price) * lerp;
      cur.change += (target.change - cur.change) * lerp;
      cur.pct += (target.pct - cur.pct) * lerp;

      // Snap when close enough
      if (Math.abs(target.price - cur.price) < 0.005) {
        cur.price = target.price;
        cur.change = target.change;
        cur.pct = target.pct;
        setAnimPrice(cur.price);
        setAnimChange(cur.change);
        setAnimChangePercent(cur.pct);
        return; // stop animating
      }

      setAnimPrice(cur.price);
      setAnimChange(cur.change);
      setAnimChangePercent(cur.pct);
      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => { running = false; cancelAnimationFrame(rafRef.current); };
  }, [targetPrice, targetChange, targetChangePercent]);

  const displayLabel = isHovering ? "" : (periodChange?.label ?? "Today");
  const isPositive = animChange >= 0;

  return (
    <div className="flex items-start justify-between">
      {/* Left: Symbol + Price */}
      <div className="shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-semibold text-black dark:text-white">{quote.symbol}</h2>
          <span className="text-sm text-black/40 dark:text-white/40">{quote.name}</span>
          {isLeveraged(quote.name) ? (
            <span className="px-2 py-0.5 text-[10px] font-semibold uppercase rounded bg-yellow-500/15 text-yellow-600 dark:text-yellow-400">
              Leveraged
            </span>
          ) : (
            <span className={`px-2 py-0.5 text-[10px] font-semibold uppercase rounded ${quoteTypeColor(quote.quoteType)}`}>
              {quote.quoteType}
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-3 mt-1">
          <span className="text-3xl font-semibold text-black dark:text-white tabular-nums">
            ${animPrice.toFixed(2)}
          </span>
          <span className={`text-lg font-medium tabular-nums transition-colors duration-150 ${isPositive ? "text-emerald-600 dark:text-emerald-500" : "text-[#FF2D2D]"}`}>
            {isPositive ? "+" : ""}{animChange.toFixed(2)} ({isPositive ? "+" : ""}{animChangePercent.toFixed(2)}%)
          </span>
        </div>
      </div>

      {/* Right: Key Stats + Watchlist */}
      <div className="flex items-start gap-6">
        <div className="flex items-start gap-6 flex-wrap justify-end">
          <Stat label="Market Cap" value={quote.marketCap ? `$${formatMarketCap(quote.marketCap)}` : "—"} />
          <Stat label="P/E" value={quote.peRatio ? quote.peRatio.toFixed(1) : "—"} />
          <Stat label="52W High" value={`$${quote.high52w.toFixed(2)}`} />
          <Stat label="52W Low" value={`$${quote.low52w.toFixed(2)}`} />
          <Stat label="Volume" value={formatVolume(quote.volume)} />
          <Stat label="Open" value={`$${quote.open.toFixed(2)}`} />
          <Stat label="Div Yield" value={quote.dividendYield ? `${quote.dividendYield.toFixed(2)}%` : "—"} />
        </div>

        {/* Watchlist Toggle */}
        {onToggleWatchlist && (
          <button
            onClick={onToggleWatchlist}
            className="p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/15 dark:focus-visible:ring-white/15"
            title={isWatchlisted ? "Remove from watchlist" : "Add to watchlist"}
          >
            <svg
              className="w-5 h-5"
              fill={isWatchlisted ? "currentColor" : "none"}
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

function isLeveraged(name: string): boolean {
  const n = name.toLowerCase();
  return /(2x|3x|-1x|-2x|-3x|ultra|leveraged|inverse|direxion\s+(daily|monthly))/i.test(n);
}

function quoteTypeColor(type: string): string {
  switch (type?.toUpperCase()) {
    case "EQUITY": return "bg-blue-500/10 text-blue-600 dark:text-blue-400";
    case "ETF": return "bg-orange-500/10 text-orange-600 dark:text-orange-400";
    case "MUTUALFUND": return "bg-amber-500/10 text-amber-600 dark:text-amber-500";
    case "INDEX": return "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400";
    case "CRYPTOCURRENCY": return "bg-orange-500/10 text-orange-600 dark:text-orange-400";
    case "FUTURE": return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-500";
    default: return "bg-black/5 dark:bg-white/5 text-black/40 dark:text-white/40";
  }
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] font-medium text-black/30 dark:text-white/30 uppercase tracking-wider">{label}</span>
      <span className="text-sm text-black/70 dark:text-white/70 tabular-nums">{value}</span>
    </div>
  );
}
