"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";

interface DisplayItem {
  symbol: string;
  name: string;
  price?: number;
  change?: number;
  changePercent?: number;
}

interface Watchlist {
  id: string;
  name: string;
  created_at: string;
}

interface WatchlistSidebarProps {
  activeSymbol: string | null;
  onSelect: (symbol: string, name: string) => void;
  refreshKey: number;
  onActiveWatchlistChange: (id: string | null) => void;
}

export default function WatchlistSidebar({
  activeSymbol,
  onSelect,
  refreshKey,
  onActiveWatchlistChange,
}: WatchlistSidebarProps) {
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [activeWatchlistId, setActiveWatchlistId] = useState<string | null>(null);
  const [items, setItems] = useState<DisplayItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showCreateInput, setShowCreateInput] = useState(false);
  const [createName, setCreateName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
        setShowCreateInput(false);
        setEditingId(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Restore persisted active watchlist on mount
  useEffect(() => {
    const savedWatchlist = localStorage.getItem("composer-terminal-active-watchlist");
    if (savedWatchlist) setActiveWatchlistId(savedWatchlist);
  }, []);

  // Persist active watchlist + report the selection upward
  useEffect(() => {
    if (activeWatchlistId) localStorage.setItem("composer-terminal-active-watchlist", activeWatchlistId);
    onActiveWatchlistChange(activeWatchlistId);
  }, [activeWatchlistId, onActiveWatchlistChange]);

  // Fetch watchlists on mount
  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("terminal_watchlists")
        .select("*")
        .order("created_at", { ascending: true });
      if (data && data.length > 0) {
        setWatchlists(data);
        setActiveWatchlistId((prev) => {
          if (prev && data.some((w: Watchlist) => w.id === prev)) return prev;
          return data[0].id;
        });
      }
    }
    load();
  }, []);

  // Fetch items for the active watchlist
  const hasLoadedRef = useRef(false);
  const prevSourceRef = useRef<string>("");
  const fetchItems = useCallback(async () => {
    // Reset loaded state when switching watchlists
    const sourceKey = activeWatchlistId ?? "";
    if (sourceKey !== prevSourceRef.current) {
      hasLoadedRef.current = false;
      prevSourceRef.current = sourceKey;
    }
    // Only show loading skeleton on initial load, not on price refreshes
    if (!hasLoadedRef.current) setLoading(true);

    let symbols: { symbol: string; name: string }[] = [];

    if (activeWatchlistId) {
      const { data } = await supabase
        .from("terminal_watchlist_items")
        .select("symbol, name")
        .eq("watchlist_id", activeWatchlistId)
        .order("position", { ascending: true });
      symbols = (data ?? []).map((d: { symbol: string; name: string }) => ({ symbol: d.symbol, name: d.name }));
    }

    if (symbols.length === 0) {
      setItems([]);
      setLoading(false);
      return;
    }

    // One request for the whole watchlist. This previously issued a separate
    // /api/quote call per symbol on every 60s refresh — a 20-symbol watchlist
    // meant 20 upstream round-trips a minute per open tab, the largest
    // avoidable multiplier in the app. Requested symbols also join the shared
    // tracked set, so subsequent refreshes are served from cache.
    let withQuotes = symbols;
    try {
      const res = await fetch(
        `/api/market/snapshot?symbols=${encodeURIComponent(symbols.map((s) => s.symbol).join(","))}`,
      );
      if (res.ok) {
        const { data } = await res.json();
        withQuotes = symbols.map((s) => {
          const q = data?.quotes?.[s.symbol.toUpperCase()];
          return q
            ? { ...s, price: q.price, change: q.change, changePercent: q.changePercent }
            : s;
        });
      }
    } catch { /* keep last known values */ }

    setItems(withQuotes);
    setLoading(false);
    hasLoadedRef.current = true;
  }, [activeWatchlistId]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems, refreshKey]);

  // Auto-refresh every 60s
  useEffect(() => {
    const interval = setInterval(fetchItems, 60000);
    return () => clearInterval(interval);
  }, [fetchItems]);

  // Focus create input when shown
  useEffect(() => {
    if (showCreateInput) createInputRef.current?.focus();
  }, [showCreateInput]);

  // CRUD
  async function createWatchlist() {
    const name = createName.trim();
    if (!name) return;
    const id = crypto.randomUUID();
    await supabase.from("terminal_watchlists").insert({ id, name });
    const newWl = { id, name, created_at: new Date().toISOString() };
    setWatchlists((prev) => [...prev, newWl]);
    setActiveWatchlistId(id);
    setCreateName("");
    setShowCreateInput(false);
    setDropdownOpen(false);
  }

  async function renameWatchlist(id: string) {
    const name = editName.trim();
    if (!name) return;
    await supabase.from("terminal_watchlists").update({ name }).eq("id", id);
    setWatchlists((prev) => prev.map((w) => (w.id === id ? { ...w, name } : w)));
    setEditingId(null);
  }

  async function deleteWatchlist(id: string) {
    await supabase.from("terminal_watchlists").delete().eq("id", id);
    setWatchlists((prev) => {
      const remaining = prev.filter((w) => w.id !== id);
      if (activeWatchlistId === id) {
        setActiveWatchlistId(remaining.length > 0 ? remaining[0].id : null);
      }
      return remaining;
    });
    setDropdownOpen(false);
  }

  const activeWatchlistName =
    watchlists.find((w) => w.id === activeWatchlistId)?.name ?? "Watchlist";

  // Pointer-based drag-and-drop reorder for watchlist items
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const dragOffsetY = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const [dragTranslateY, setDragTranslateY] = useState(0);
  const pendingDragIndex = useRef<number | null>(null);
  const pendingStartY = useRef(0);
  const DRAG_THRESHOLD = 5; // pixels of movement before drag activates

  function handlePointerDown(e: React.PointerEvent, index: number) {
    e.preventDefault();
    const el = itemRefs.current[index];
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragOffsetY.current = e.clientY - rect.top;
    pendingDragIndex.current = index;
    pendingStartY.current = e.clientY;
    el.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent, index: number) {
    // Not yet dragging — check if we've moved past the threshold
    if (pendingDragIndex.current !== null && dragIndex === null) {
      if (pendingDragIndex.current !== index) return;
      const dist = Math.abs(e.clientY - pendingStartY.current);
      if (dist < DRAG_THRESHOLD) return;
      // Activate drag
      setDragIndex(pendingDragIndex.current);
      setDragOverIndex(pendingDragIndex.current);
      setDragTranslateY(0);
      pendingDragIndex.current = null;
    }

    if (dragIndex === null || dragIndex !== index) return;
    const el = itemRefs.current[dragIndex];
    if (!el || !listRef.current) return;

    const rect = el.getBoundingClientRect();
    const rawY = e.clientY - dragOffsetY.current - rect.top + dragTranslateY;
    setDragTranslateY(rawY);

    // Figure out which item the pointer is over by finding the closest midpoint
    const pointerY = e.clientY;
    let overIndex = dragIndex;
    let closestDist = Infinity;
    for (let i = 0; i < items.length; i++) {
      if (i === dragIndex) continue;
      const ref = itemRefs.current[i];
      if (!ref) continue;
      const r = ref.getBoundingClientRect();
      const midY = r.top + r.height / 2;
      const dist = Math.abs(pointerY - midY);
      if (dist < closestDist) {
        closestDist = dist;
        if ((i < dragIndex && pointerY < midY) || (i > dragIndex && pointerY > midY)) {
          overIndex = i;
        }
      }
    }
    setDragOverIndex(overIndex);
  }

  function handlePointerUp() {
    // If we never crossed the threshold, it was just a tap — fire the click
    if (pendingDragIndex.current !== null && dragIndex === null) {
      const idx = pendingDragIndex.current;
      pendingDragIndex.current = null;
      const item = items[idx];
      if (item) onSelect(item.symbol, item.name);
      return;
    }
    pendingDragIndex.current = null;

    if (dragIndex === null || dragOverIndex === null || dragIndex === dragOverIndex) {
      setDragIndex(null);
      setDragOverIndex(null);
      setDragTranslateY(0);
      return;
    }

    const reordered = [...items];
    const [moved] = reordered.splice(dragIndex, 1);
    reordered.splice(dragOverIndex, 0, moved);
    setItems(reordered);
    setDragIndex(null);
    setDragOverIndex(null);
    setDragTranslateY(0);

    // Persist new order to database
    if (activeWatchlistId) {
      const updates = reordered.map((item, i) =>
        supabase
          .from("terminal_watchlist_items")
          .update({ position: i })
          .eq("watchlist_id", activeWatchlistId)
          .eq("symbol", item.symbol)
      );
      Promise.all(updates).catch((err) => console.error("Failed to save watchlist order:", err));
    }
  }

  return (
    <div className="w-72 shrink-0 flex flex-col h-full">
      {/* Watchlist selector — single control (Models / Accounts removed) */}
      <div className="relative mb-3" ref={dropdownRef}>
        <button
          onClick={() => setDropdownOpen((o) => !o)}
          className="w-full flex items-center justify-between gap-1 bg-black/5 dark:bg-white/5 rounded-lg px-3 py-1.5 text-[11px] font-medium text-black dark:text-white transition-colors hover:bg-black/[0.07] dark:hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/20 dark:focus-visible:ring-white/20"
        >
          <span className="truncate">{activeWatchlistName}</span>
          <svg className={`w-3 h-3 shrink-0 text-black/30 dark:text-white/30 transition-transform ${dropdownOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>

        {dropdownOpen && (
          <div className="absolute left-0 right-0 top-full mt-1 bg-white dark:bg-[#111] rounded-xl shadow-lg border border-black/10 dark:border-white/10 z-30 overflow-hidden">
            <div className="max-h-64 overflow-y-auto py-1">
              {watchlists.map((item) => {
                const isActive = item.id === activeWatchlistId;

                return (
                  <div
                    key={item.id}
                    className={`group flex items-center px-3 py-2 text-xs cursor-pointer transition-colors ${
                      isActive
                        ? "bg-black/5 dark:bg-white/5 text-black dark:text-white font-medium"
                        : "text-black/60 dark:text-white/60 hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
                    }`}
                  >
                    {editingId === item.id ? (
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") renameWatchlist(item.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        onBlur={() => renameWatchlist(item.id)}
                        className="flex-1 bg-transparent text-xs text-black dark:text-white outline-none"
                        autoFocus
                      />
                    ) : (
                      <>
                        <span
                          className="flex-1 truncate"
                          onClick={() => {
                            setActiveWatchlistId(item.id);
                            setDropdownOpen(false);
                          }}
                        >
                          {item.name}
                        </span>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingId(item.id);
                              setEditName(item.name);
                            }}
                            className="p-0.5 rounded hover:bg-black/5 dark:hover:bg-white/5 text-black/30 dark:text-white/30 hover:text-black/60 dark:hover:text-white/60"
                            title="Rename"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" />
                            </svg>
                          </button>
                          {watchlists.length > 1 && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteWatchlist(item.id);
                              }}
                              className="p-0.5 rounded hover:bg-red-500/10 text-black/30 dark:text-white/30 hover:text-[#FF2D2D]"
                              title="Delete"
                            >
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Create new watchlist */}
            <div className="border-t border-black/5 dark:border-white/5">
              {showCreateInput ? (
                <div className="px-3 py-2 flex items-center gap-2">
                  <input
                    ref={createInputRef}
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") createWatchlist();
                      if (e.key === "Escape") { setShowCreateInput(false); setCreateName(""); }
                    }}
                    placeholder="Watchlist name..."
                    className="flex-1 bg-transparent text-xs text-black dark:text-white outline-none placeholder:text-black/20 dark:placeholder:text-white/20"
                  />
                  <button
                    onClick={createWatchlist}
                    className="text-[10px] font-medium px-2 py-1 rounded bg-black dark:bg-white text-white dark:text-black"
                  >
                    Add
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowCreateInput(true)}
                  className="w-full px-3 py-2 text-xs text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white hover:bg-black/[0.03] dark:hover:bg-white/[0.03] transition-colors text-left flex items-center gap-1.5"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  New Watchlist
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Items — scrollable */}
      <div className="flex-1 min-h-0 overflow-y-auto">
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 rounded-lg bg-black/[0.02] dark:bg-white/[0.02] animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-8">
          <svg className="w-8 h-8 mx-auto text-black/15 dark:text-white/15 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
          </svg>
          <p className="text-xs text-black/30 dark:text-white/30">
            Search for a security and click the star to add it here
          </p>
        </div>
      ) : (
        <div ref={listRef} className="space-y-0.5 relative">
          {items.map((item, index) => {
            const isActive = activeSymbol === item.symbol;
            const isPositive = (item.changePercent ?? 0) >= 0;
            const isDragging = dragIndex === index;
            const isDragOver = dragOverIndex === index && dragIndex !== index;
            const isAbove = dragIndex !== null && dragOverIndex !== null && index === dragOverIndex && dragIndex > dragOverIndex;
            const isBelow = dragIndex !== null && dragOverIndex !== null && index === dragOverIndex && dragIndex < dragOverIndex;
            const isOtherWhileDragging = dragIndex !== null && !isDragging;
            void isDragOver;

            return (
              <div key={item.symbol} className="relative">
                {/* Drop indicator line — top */}
                {isAbove && (
                  <div className="absolute -top-[1px] left-3 right-3 h-[2px] rounded-full bg-black/30 dark:bg-white/40 z-10" />
                )}
                <button
                  ref={(el) => { itemRefs.current[index] = el; }}
                  onPointerDown={(e) => handlePointerDown(e, index)}
                  onPointerMove={(e) => handlePointerMove(e, index)}
                  onPointerUp={handlePointerUp}
                  onClick={(e) => { e.preventDefault(); }}
                  style={{
                    transition: isDragging
                      ? "transform 0ms, box-shadow 200ms ease, opacity 200ms ease"
                      : "transform 200ms cubic-bezier(0.2, 0, 0, 1), opacity 200ms ease, box-shadow 200ms ease",
                    transform: isDragging
                      ? `translateY(${dragTranslateY}px) scale(1.06)`
                      : "translateY(0) scale(1)",
                    zIndex: isDragging ? 30 : undefined,
                    touchAction: "none",
                  }}
                  className={`relative w-full px-3 py-2.5 rounded-lg flex items-center justify-between text-left select-none cursor-grab active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/15 dark:focus-visible:ring-white/15 ${
                    isActive
                      ? "bg-black/[0.05] dark:bg-white/[0.05]"
                      : "hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
                  } ${isDragging ? "shadow-xl shadow-black/15 dark:shadow-black/40 bg-white dark:bg-[#1a1a1a] ring-1 ring-black/5 dark:ring-white/10" : ""} ${isOtherWhileDragging ? "opacity-35" : ""}`}
                >
                {isActive && (
                  <div className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-black dark:bg-white" />
                )}
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-black dark:text-white">{item.symbol}</div>
                  <div className="text-[11px] text-black/35 dark:text-white/35 truncate max-w-[120px]">
                    {item.name}
                  </div>
                </div>
                <div className="text-right shrink-0 ml-2">
                  {item.price != null ? (
                    <>
                      <div className="text-sm font-medium text-black dark:text-white tabular-nums">
                        ${item.price.toFixed(2)}
                      </div>
                      <div className={`text-[11px] font-medium tabular-nums ${isPositive ? "text-emerald-600 dark:text-emerald-500" : "text-[#FF2D2D]"}`}>
                        {isPositive ? "+" : ""}{(item.changePercent ?? 0).toFixed(2)}%
                      </div>
                    </>
                  ) : (
                    <div className="text-xs text-black/20 dark:text-white/20">—</div>
                  )}
                </div>
              </button>
                {/* Drop indicator line — bottom */}
                {isBelow && (
                  <div className="absolute -bottom-[1px] left-3 right-3 h-[2px] rounded-full bg-black/30 dark:bg-white/40 z-10" />
                )}
              </div>
            );
          })}
        </div>
      )}
      </div>
    </div>
  );
}
