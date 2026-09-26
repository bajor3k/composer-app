"use client";

import { useRef, useEffect, useState, useCallback } from "react";

interface ChartPoint {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PeriodChange {
  change: number;
  changePercent: number;
  label: string;
}

export interface CrosshairData {
  price: number;
  change: number;
  changePercent: number;
  time: number;
}

export interface ChartMarker {
  time: number;
  color: string;
  text: string;
  position: "aboveBar" | "belowBar";
}

export type ChartType = "area" | "candlestick";

interface PriceChartProps {
  symbol: string;
  onPeriodChange?: (data: PeriodChange | null) => void;
  onCrosshairMove?: (data: CrosshairData | null) => void;
  markers?: ChartMarker[];
  fillHeight?: boolean;
  hideControls?: boolean;
  periodIndex?: number;
  onPeriodIndexChange?: (i: number) => void;
  chartTypeValue?: ChartType;
  onChartTypeChange?: (t: ChartType) => void;
  showAxes?: boolean;
}

export const PERIODS = [
  { label: "1D", range: "1d", interval: "2m", desc: "Today" },
  { label: "1W", range: "5d", interval: "15m", desc: "Past Week" },
  { label: "1M", range: "1mo", interval: "1h", desc: "Past Month" },
  { label: "3M", range: "3mo", interval: "1d", desc: "Past 3 Months" },
  { label: "6M", range: "6mo", interval: "1d", desc: "Past 6 Months" },
  { label: "YTD", range: "ytd", interval: "1d", desc: "Year to Date" },
  { label: "1Y", range: "1y", interval: "1d", desc: "Past Year" },
  { label: "5Y", range: "5y", interval: "1wk", desc: "Past 5 Years" },
];

export default function PriceChart({ symbol, onPeriodChange, onCrosshairMove, markers, fillHeight, hideControls, periodIndex, onPeriodIndexChange, chartTypeValue, onChartTypeChange, showAxes }: PriceChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof import("lightweight-charts").createChart> | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const [internalPeriod, setInternalPeriod] = useState(0);
  const activePeriod = periodIndex ?? internalPeriod;
  const setActivePeriod = (i: number) => {
    if (onPeriodIndexChange) onPeriodIndexChange(i);
    else setInternalPeriod(i);
  };
  const [loading, setLoading] = useState(false);
  const [internalChartType, setInternalChartType] = useState<ChartType>("area");
  const chartType = chartTypeValue ?? internalChartType;
  const setChartType = (t: ChartType) => {
    if (onChartTypeChange) onChartTypeChange(t);
    else setInternalChartType(t);
  };
  const [data, setData] = useState<ChartPoint[]>([]);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [previousClose, setPreviousClose] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const onCrosshairMoveRef = useRef(onCrosshairMove);
  onCrosshairMoveRef.current = onCrosshairMove;

  // Event marker tooltip state
  const [hoveredMarker, setHoveredMarker] = useState<{ text: string; color: string; x: number; y: number } | null>(null);
  const markersRef = useRef<ChartMarker[] | undefined>(undefined);
  markersRef.current = markers;

  // Crosshair tooltip state
  const [crosshairTooltip, setCrosshairTooltip] = useState<{ label: string; x: number } | null>(null);
  const activePeriodRef = useRef(activePeriod);
  activePeriodRef.current = activePeriod;

  // Drag selection state
  const [dragAnchor, setDragAnchor] = useState<{ price: number; time: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ price: number; time: number } | null>(null);
  const isDraggingRef = useRef(false);
  const lastCrosshairRef = useRef<{ price: number; time: number } | null>(null);
  const dragAnchorTimeRef = useRef<number | null>(null);
  const [dragPixels, setDragPixels] = useState<{ left: number; width: number } | null>(null);

  const fetchData = useCallback(async (periodIdx: number) => {
    const p = PERIODS[periodIdx];
    setLoading(true);
    try {
      const res = await fetch(
        `/api/terminal/chart?symbol=${encodeURIComponent(symbol)}&range=${p.range}&interval=${p.interval}`
      );
      if (res.ok) {
        const json = await res.json();
        setData(json.data ?? []);
        setCurrentPrice(json.meta?.regularMarketPrice ?? null);
        setPreviousClose(json.meta?.chartPreviousClose ?? null);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [symbol]);

  useEffect(() => {
    fetchData(activePeriod);
  }, [symbol, activePeriod, fetchData]);

  // Report period change to parent
  // For 1D, return null so SecurityHeader uses the quote's accurate daily change
  useEffect(() => {
    if (!onPeriodChange) return;
    if (PERIODS[activePeriod].range === "1d") {
      onPeriodChange(null);
      return;
    }
    if (data.length < 2) {
      onPeriodChange(null);
      return;
    }
    const first = previousClose ?? data[0].close;
    const last = currentPrice ?? data[data.length - 1].close;
    const change = last - first;
    const changePercent = first !== 0 ? (change / first) * 100 : 0;
    onPeriodChange({ change, changePercent, label: PERIODS[activePeriod].desc });
  }, [data, activePeriod, onPeriodChange, currentPrice, previousClose]);

  useEffect(() => {
    if (!chartContainerRef.current || data.length === 0) return;

    let isMounted = true;

    async function renderChart() {
      const lc = await import("lightweight-charts");
      if (!isMounted || !chartContainerRef.current) return;

      // Clean up previous chart
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }

      const isDark = document.documentElement.classList.contains("dark");

      const parentH = chartContainerRef.current.parentElement?.clientHeight ?? 0;
      const chartHeight = expanded ? window.innerHeight - 80 : fillHeight && parentH > 100 ? parentH - (hideControls ? 0 : 44) : 360;

      const chart = lc.createChart(chartContainerRef.current, {
        width: chartContainerRef.current.clientWidth,
        height: chartHeight,
        layout: {
          background: { color: "transparent" },
          textColor: isDark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.4)",
          fontSize: 11,
        },
        grid: {
          vertLines: { color: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)" },
          horzLines: { color: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)" },
        },
        crosshair: {
          mode: lc.CrosshairMode.Normal,
          vertLine: { visible: false },
          horzLine: { visible: false },
        },
        rightPriceScale: {
          visible: !!showAxes,
          borderVisible: false,
        },
        timeScale: {
          visible: !!showAxes,
          borderVisible: false,
          ...(showAxes && activePeriodRef.current <= 2 ? {
            tickMarkFormatter: (time: number) => {
              const d = new Date(time * 1000);
              return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
            },
          } : {}),
        },
        handleScroll: expanded,
        handleScale: expanded,
      });

      chartRef.current = chart;

      const isPositive = data.length > 1 && data[data.length - 1].close >= data[0].close;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let mainSeries: any;

      if (chartType === "area") {
        mainSeries = chart.addSeries(lc.AreaSeries, {
          lineColor: isPositive ? "#10B981" : "#FF2D2D",
          topColor: isPositive
            ? (isDark ? "rgba(16,185,129,0.28)" : "rgba(16,185,129,0.15)")
            : (isDark ? "rgba(255,45,45,0.28)" : "rgba(255,45,45,0.15)"),
          bottomColor: isDark ? "rgba(255,255,255,0.04)" : "transparent",
          lineWidth: 2,
          crosshairMarkerRadius: 4,
          lastValueVisible: false,
          priceLineVisible: false,
        });
        mainSeries.setData(
          data.map((d) => ({
            time: d.time as never,
            value: d.close,
          }))
        );
      } else {
        mainSeries = chart.addSeries(lc.CandlestickSeries, {
          upColor: "#10B981",
          downColor: "#FF2D2D",
          borderUpColor: "#10B981",
          borderDownColor: "#FF2D2D",
          wickUpColor: "#10B981",
          wickDownColor: "#FF2D2D",
          lastValueVisible: false,
          priceLineVisible: false,
        });
        mainSeries.setData(
          data.map((d) => ({
            time: d.time as never,
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close,
          }))
        );
      }

      // Event markers on chart — small dots, no text labels (tooltip on hover)
      if (markers && markers.length > 0 && data.length > 0) {
        const minTime = data[0].time;
        const maxTime = data[data.length - 1].time;
        const lcMarkers = markers
          .filter((m) => m.time >= minTime && m.time <= maxTime)
          .sort((a, b) => a.time - b.time)
          .map((m) => ({
            time: m.time as never,
            position: m.position,
            shape: "circle" as const,
            color: m.color,
            size: 0.5,
          }));
        if (lcMarkers.length > 0) {
          lc.createSeriesMarkers(mainSeries, lcMarkers);
        }
      }

      // Volume histogram
      const volumeSeries = chart.addSeries(lc.HistogramSeries, {
        color: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
        priceFormat: { type: "volume" },
        priceScaleId: "volume",
      });
      chart.priceScale("volume").applyOptions({
        scaleMargins: { top: 0.85, bottom: 0 },
        visible: false,
      });
      volumeSeries.setData(
        data.map((d) => ({
          time: d.time as never,
          value: d.volume,
          color: d.close >= d.open
            ? isDark ? "rgba(16,185,129,0.15)" : "rgba(16,185,129,0.2)"
            : isDark ? "rgba(255,45,45,0.15)" : "rgba(255,45,45,0.2)",
        }))
      );

      // For 1D, set visible range to full trading day (9:30 AM - 4:00 PM ET)
      // so the line position reflects current time within the trading session
      if (activePeriodRef.current === 0 && data.length > 0) {
        const firstDate = new Date(data[0].time * 1000);
        const dateStr = firstDate.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
        const formatter = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "short" });
        const parts = formatter.formatToParts(firstDate);
        const tzAbbr = parts.find(p => p.type === "timeZoneName")?.value;
        const utcOffset = tzAbbr === "EDT" ? "-04:00" : "-05:00";
        const openTime = new Date(`${dateStr}T09:30:00${utcOffset}`).getTime() / 1000;
        const closeTime = new Date(`${dateStr}T16:00:00${utcOffset}`).getTime() / 1000;
        chart.timeScale().setVisibleRange({ from: openTime as never, to: closeTime as never });
      } else {
        chart.timeScale().fitContent();
      }

      // Build marker lookup for tooltip (keyed by day — normalize to midnight UTC)
      const markerByDay = new Map<number, ChartMarker[]>();
      if (markers && markers.length > 0) {
        for (const m of markers) {
          // Normalize to start-of-day (UTC) to match daily chart candle times
          const dayKey = Math.floor(m.time / 86400) * 86400;
          const arr = markerByDay.get(dayKey);
          if (arr) arr.push(m);
          else markerByDay.set(dayKey, [m]);
        }
      }

      // Crosshair move — report hovered price to parent + track for drag
      const basePrice = data[0]?.close ?? 0;
      chart.subscribeCrosshairMove((param) => {
        if (!param.time || !param.seriesData || param.seriesData.size === 0) {
          lastCrosshairRef.current = null;
          setHoveredMarker(null);
          setCrosshairTooltip(null);
          if (onCrosshairMoveRef.current) onCrosshairMoveRef.current(null);
          return;
        }
        const entries = Array.from(param.seriesData.values());
        const val = entries[0] as { value?: number; close?: number };
        const price = val?.value ?? val?.close;
        if (price == null) {
          lastCrosshairRef.current = null;
          setHoveredMarker(null);
          setCrosshairTooltip(null);
          if (onCrosshairMoveRef.current) onCrosshairMoveRef.current(null);
          return;
        }
        const time = param.time as number;
        lastCrosshairRef.current = { price, time };

        // Crosshair date/time tooltip
        try {
          const xCoord = chart.timeScale().timeToCoordinate(time as never);
          if (xCoord != null) {
            const d = new Date(time * 1000);
            const pidx = activePeriodRef.current;
            let label: string;
            if (pidx <= 1) {
              // 1D, 1W — show time + short date
              label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
            } else if (pidx === 2) {
              // 1M (hourly) — show date + time
              label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
            } else {
              // 3M+ — just date
              label = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
            }
            setCrosshairTooltip({ label, x: xCoord as number });
          }
        } catch { setCrosshairTooltip(null); }

        // Check if hovering over a marker day
        if (markerByDay.size > 0) {
          const dayKey = Math.floor(time / 86400) * 86400;
          const matched = markerByDay.get(dayKey) || markerByDay.get(time);
          if (matched && matched.length > 0) {
            try {
              const x = chart.timeScale().timeToCoordinate(time as never);
              const y = mainSeries.priceToCoordinate(price);
              if (x != null && y != null) {
                const text = matched.map((m) => m.text).join("\n");
                setHoveredMarker({ text, color: matched[0].color, x: x as number, y: y as number });
              }
            } catch { setHoveredMarker(null); }
          } else {
            setHoveredMarker(null);
          }
        }

        // If dragging, update drag current and compute highlight pixel range
        if (isDraggingRef.current) {
          setDragCurrent({ price, time });
          try {
            const ts = chart.timeScale();
            const anchorX = ts.timeToCoordinate(dragAnchorTimeRef.current as never);
            const currentX = ts.timeToCoordinate(time as never);
            if (anchorX != null && currentX != null) {
              const left = Math.min(anchorX, currentX);
              const width = Math.abs(currentX - anchorX);
              setDragPixels({ left, width });
            }
          } catch { /* ignore */ }
        }

        if (onCrosshairMoveRef.current) {
          const change = price - basePrice;
          const changePercent = basePrice !== 0 ? (change / basePrice) * 100 : 0;
          onCrosshairMoveRef.current({ price, change, changePercent, time });
        }
      });

      // Resize observer — guarded against disposed chart
      roRef.current?.disconnect();
      const ro = new ResizeObserver((entries) => {
        if (!isMounted || chartRef.current !== chart) return;
        const w = entries[0]?.contentRect?.width;
        if (w) {
          try { chart.applyOptions({ width: w }); } catch { /* chart disposed */ }
        }
      });
      ro.observe(chartContainerRef.current);
      roRef.current = ro;
    }

    renderChart();

    return () => {
      isMounted = false;
      roRef.current?.disconnect();
      roRef.current = null;
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [data, chartType, activePeriod, expanded, markers, fillHeight, showAxes]);

  // Drag selection handlers
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;

    function onMouseDown() {
      if (lastCrosshairRef.current) {
        isDraggingRef.current = true;
        dragAnchorTimeRef.current = lastCrosshairRef.current.time;
        setDragAnchor(lastCrosshairRef.current);
        setDragCurrent(null);
        setDragPixels(null);
      }
    }
    function onMouseUp() {
      isDraggingRef.current = false;
      dragAnchorTimeRef.current = null;
      setDragAnchor(null);
      setDragCurrent(null);
      setDragPixels(null);
    }
    function onMouseLeave() {
      isDraggingRef.current = false;
      dragAnchorTimeRef.current = null;
      setDragAnchor(null);
      setDragCurrent(null);
      setDragPixels(null);
    }

    container.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    container.addEventListener("mouseleave", onMouseLeave);
    return () => {
      container.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      container.removeEventListener("mouseleave", onMouseLeave);
    };
  }, [data]);

  // Compute drag selection info
  const dragInfo = dragAnchor && dragCurrent && dragAnchor.time !== dragCurrent.time ? (() => {
    const startTime = Math.min(dragAnchor.time, dragCurrent.time);
    const endTime = Math.max(dragAnchor.time, dragCurrent.time);
    // Use anchor as "from" and current as "to" regardless of direction
    const fromPrice = dragAnchor.price;
    const toPrice = dragCurrent.price;
    const change = toPrice - fromPrice;
    const changePercent = fromPrice !== 0 ? (change / fromPrice) * 100 : 0;
    const fmt = (t: number) => {
      const d = new Date(t * 1000);
      return activePeriod <= 1
        ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
        : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    };
    return { change, changePercent, from: fmt(startTime), to: fmt(endTime), isPositive: change >= 0 };
  })() : null;

  // Close on Escape key + lock body scroll when expanded
  useEffect(() => {
    if (!expanded) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKey);
    };
  }, [expanded]);

  return (
    <div className={expanded ? "fixed inset-0 z-50 bg-white dark:bg-black p-6 flex flex-col" : fillHeight && hideControls ? "h-full flex flex-col" : ""}>
      {/* Period Selector */}
      {!hideControls && (
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-0.5 bg-black/5 dark:bg-white/5 rounded-lg p-1">
          {PERIODS.map((p, i) => (
            <button
              key={p.label}
              onClick={() => setActivePeriod(i)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/15 dark:focus-visible:ring-white/15 ${
                activePeriod === i
                  ? "bg-white dark:bg-black medium:bg-[#e4e4e4] text-black dark:text-white shadow-sm"
                  : "text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 bg-black/5 dark:bg-white/5 rounded-lg p-1">
            <button
              onClick={() => setChartType("area")}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/15 dark:focus-visible:ring-white/15 ${
                chartType === "area"
                  ? "bg-white dark:bg-black medium:bg-[#e4e4e4] text-black dark:text-white shadow-sm"
                  : "text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white"
              }`}
            >
              Line
            </button>
            <button
              onClick={() => setChartType("candlestick")}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/15 dark:focus-visible:ring-white/15 ${
                chartType === "candlestick"
                  ? "bg-white dark:bg-black medium:bg-[#e4e4e4] text-black dark:text-white shadow-sm"
                  : "text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white"
              }`}
            >
              Candle
            </button>
          </div>
        </div>
      </div>
      )}

      {/* Chart Container */}
      <div className={`relative overflow-hidden ${hideControls ? "" : "rounded-lg"} ${expanded || (fillHeight && hideControls) ? "flex-1" : ""}`}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center z-10 bg-white/50 dark:bg-black/50">
            <span className="text-sm text-black/40 dark:text-white/40">Loading chart...</span>
          </div>
        )}
        <div ref={chartContainerRef} className="[&_a[href*='tradingview']]:!hidden" />

        {/* Drag Selection Highlight */}
        {dragPixels && dragPixels.width > 2 && (
          <div
            className="absolute top-0 bottom-0 pointer-events-none bg-black/[0.04] dark:bg-white/[0.04]"
            style={{ left: dragPixels.left, width: dragPixels.width }}
          />
        )}

        {/* Drag Selection Info */}
        {dragInfo && (
          <div className="absolute top-3 left-3 z-20 bg-white/90 dark:bg-black/90 backdrop-blur-sm rounded-lg px-3 py-2 shadow-lg border border-black/10 dark:border-white/10">
            <div className="flex items-baseline gap-2">
              <span className={`text-lg font-semibold tabular-nums ${dragInfo.isPositive ? "text-emerald-600 dark:text-emerald-500" : "text-[#FF2D2D]"}`}>
                {dragInfo.isPositive ? "+" : ""}{dragInfo.changePercent.toFixed(2)}%
              </span>
            </div>
            <div className="text-[10px] text-black/40 dark:text-white/40 mt-0.5 tabular-nums">
              {dragInfo.from} → {dragInfo.to}
            </div>
          </div>
        )}

        {/* Crosshair Vertical Line + Date Tooltip */}
        {crosshairTooltip && !dragInfo && (
          <>
            <div
              className="absolute pointer-events-none z-10"
              style={{ left: crosshairTooltip.x, top: 20, bottom: 0, width: 1 }}
            >
              <div className="w-full h-full bg-black/15 dark:bg-white/15" />
            </div>
            <div
              className="absolute top-1 pointer-events-none z-20"
              style={{ left: crosshairTooltip.x, transform: "translateX(-50%)" }}
            >
              <span className="text-[10px] text-black dark:text-white whitespace-nowrap tabular-nums">
                {crosshairTooltip.label}
              </span>
            </div>
          </>
        )}

        {/* Event Marker Tooltip */}
        {hoveredMarker && (
          <div
            className="absolute z-30 pointer-events-none bg-white/95 dark:bg-black/95 backdrop-blur-sm rounded-lg px-3 py-2 shadow-lg border border-black/10 dark:border-white/10 max-w-[260px]"
            style={{ left: Math.min(hoveredMarker.x + 12, (chartContainerRef.current?.clientWidth ?? 400) - 280), top: Math.max(hoveredMarker.y - 10, 4) }}
          >
            <div className="flex items-start gap-2">
              <span className="w-2 h-2 rounded-full flex-shrink-0 mt-1" style={{ backgroundColor: hoveredMarker.color }} />
              <span className="text-xs text-black/80 dark:text-white/80 leading-tight whitespace-pre-line">{hoveredMarker.text}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
