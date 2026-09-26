"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface SearchablePickerProps<T> {
  label: string; // tooltip + search-box context ("Account #")
  icon?: React.ReactNode; // little icon shown in the chip (blank value until selected)
  emptyLabel?: string; // shown next to the icon when no value (e.g. "Household"); icon-only if omitted
  placeholder: string; // search-box placeholder
  value: T | null;
  options: T[];
  getKey: (o: T) => string;
  getPrimary: (o: T) => string; // bold line + trigger value
  getSecondary?: (o: T) => string; // dim line
  matches: (o: T, q: string) => boolean; // search filter
  onSelect: (o: T) => void;
  onClear?: () => void;
  disabled?: boolean;
  emptyHint?: string; // shown when there are no options
  open: boolean;
  onOpenChange: (open: boolean) => void;
  centered?: boolean; // open as a big centered modal (portaled) instead of an anchored dropdown
  accentColor?: string; // overrides the chip's default blue (e.g. the custodian brand color)
}

// A compact dropdown trigger that opens a small card with a search box and a
// filtered, single-select list. Opens upward (bottom-full) since the bar sits
// low on screen in both the hero and docked layouts. `open` is controlled by the
// parent so only one picker in the bar is open at a time.
export default function SearchablePicker<T>({
  label,
  icon,
  emptyLabel,
  placeholder,
  value,
  options,
  getKey,
  getPrimary,
  getSecondary,
  matches,
  onSelect,
  onClear,
  disabled,
  emptyHint,
  open,
  onOpenChange,
  centered,
  accentColor,
}: SearchablePickerProps<T>) {
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Escape closes either mode. The anchored dropdown also closes on outside click;
  // the centered modal is portaled out of this element and uses its own backdrop,
  // so an outside-click check here would fire on the modal's own contents.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", onKey);
    let onDown: ((e: MouseEvent) => void) | undefined;
    if (!centered) {
      onDown = (e: MouseEvent) => {
        if (ref.current && !ref.current.contains(e.target as Node)) onOpenChange(false);
      };
      document.addEventListener("mousedown", onDown);
    }
    return () => {
      document.removeEventListener("keydown", onKey);
      if (onDown) document.removeEventListener("mousedown", onDown);
    };
  }, [open, onOpenChange, centered]);

  // Focus the search on open; clear the query when it closes.
  useEffect(() => {
    if (open) inputRef.current?.focus();
    else setQuery("");
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim();
    const list = q ? options.filter((o) => matches(o, q)) : options;
    return list.slice(0, 200); // cap the rendered rows; search narrows further
  }, [query, options, matches]);

  const selectedKey = value ? getKey(value) : null;
  const selected = !!value;

  // The chip is blue by default; an accentColor (e.g. the custodian brand color)
  // recolors the background tint, icon, label, and clear control via a CSS var so
  // the same arbitrary-value classes work for any firm. No dark variant needed —
  // brand colors read the same in both themes.
  const acc = accentColor;
  const bgCls = acc
    ? selected
      ? "bg-[var(--acc)]/15 hover:bg-[var(--acc)]/25"
      : "bg-[var(--acc)]/10 hover:bg-[var(--acc)]/20"
    : selected
    ? "bg-[#2D9CFF]/15 hover:bg-[#2D9CFF]/25"
    : "bg-[#2D9CFF]/10 hover:bg-[#2D9CFF]/20";
  const iconCls = acc ? "text-[var(--acc)]/80 shrink-0" : "text-[#1E7FE0]/70 dark:text-[#5CB0FF]/70 shrink-0";
  const valueCls = acc ? "text-[var(--acc)]" : "text-[#1E7FE0] dark:text-[#5CB0FF]";
  const emptyCls = acc ? "text-[var(--acc)]" : "text-[#1E7FE0] dark:text-[#5CB0FF]";
  const clearCls = acc
    ? "text-[var(--acc)]/60 hover:text-[var(--acc)]"
    : "text-[#1E7FE0]/50 dark:text-[#5CB0FF]/50 hover:text-[#1E7FE0] dark:hover:text-[#5CB0FF]";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onOpenChange(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={value ? `${label}: ${getPrimary(value)}` : `Select ${label}`}
        style={acc ? ({ "--acc": acc } as React.CSSProperties) : undefined}
        className={`group inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-sm chip-raise ${bgCls}`}
      >
        {icon && <span className={iconCls}>{icon}</span>}
        {value ? (
          <span className={`font-semibold max-w-[160px] truncate ${valueCls}`}>
            {getPrimary(value)}
          </span>
        ) : emptyLabel ? (
          <span className={emptyCls}>{emptyLabel}</span>
        ) : null}
        {value && onClear && (
          <span
            role="button"
            tabIndex={0}
            aria-label={`Clear ${label}`}
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                onClear();
              }
            }}
            className={`ml-0.5 -mr-0.5 px-0.5 leading-none ${clearCls}`}
          >
            ×
          </span>
        )}
      </button>

      {open && !disabled && !centered && (
        <div
          role="listbox"
          className="absolute left-0 bottom-full mb-2 z-50 w-72 max-w-[80vw] rounded-xl border border-border dark:border-border-dark bg-sidebar dark:bg-sidebar-dark medium:bg-[#c2c2c2] shadow-xl overflow-hidden"
        >
          <div className="p-2 border-b border-black/[0.06] dark:border-white/[0.08]">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              className="w-full px-2.5 py-1.5 rounded-lg border border-border dark:border-border-dark bg-surface dark:bg-surface-dark text-sm text-black dark:text-white placeholder-black/30 dark:placeholder-white/30 outline-none focus:border-black dark:focus:border-white transition-colors"
            />
          </div>
          <div className="max-h-[min(50vh,18rem)] overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-xs text-black/40 dark:text-white/40">
                {options.length === 0 ? emptyHint || "Nothing to show" : "No matches"}
              </p>
            ) : (
              filtered.map((o) => {
                const key = getKey(o);
                const isActive = key === selectedKey;
                const secondary = getSecondary?.(o);
                return (
                  <button
                    key={key}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    onClick={() => {
                      onSelect(o);
                      onOpenChange(false);
                    }}
                    className={`w-full flex items-center justify-between gap-3 px-3 py-1.5 text-left transition-colors ${
                      isActive
                        ? "bg-black/5 dark:bg-white/5"
                        : "hover:bg-black/5 dark:hover:bg-white/5"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium text-black dark:text-white truncate leading-tight">
                        {getPrimary(o)}
                      </span>
                      {secondary && (
                        <span className="block text-[11px] text-black/40 dark:text-white/40 truncate leading-tight">
                          {secondary}
                        </span>
                      )}
                    </span>
                    {isActive && <CheckIcon className="w-4 h-4 shrink-0 text-black/60 dark:text-white/60" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      {open && !disabled && centered && createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
          {/* Backdrop — click anywhere to dismiss. */}
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => onOpenChange(false)} />
          {/* Centered search panel — bigger, command-palette style (matches the hero picker). */}
          <div className="relative w-full max-w-xl rounded-2xl border border-black/10 dark:border-white/10 bg-surface dark:bg-surface-dark shadow-2xl overflow-hidden text-left">
            <div className="px-4 py-3.5 border-b border-black/5 dark:border-white/5">
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={placeholder}
                className="w-full bg-transparent px-1 text-lg font-normal text-black dark:text-white placeholder-black/30 dark:placeholder-white/30 outline-none"
              />
            </div>
            <div className="max-h-[55vh] overflow-y-auto py-1.5">
              {filtered.length === 0 ? (
                <p className="px-4 py-3 text-sm text-black/40 dark:text-white/40">
                  {options.length === 0 ? emptyHint || "Nothing to show" : "No matches"}
                </p>
              ) : (
                filtered.map((o) => {
                  const key = getKey(o);
                  const isActive = key === selectedKey;
                  const secondary = getSecondary?.(o);
                  return (
                    <button
                      key={key}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      onClick={() => {
                        onSelect(o);
                        onOpenChange(false);
                      }}
                      className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors ${
                        isActive ? "bg-black/5 dark:bg-white/5" : "hover:bg-black/5 dark:hover:bg-white/5"
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-black dark:text-white truncate leading-tight">
                          {getPrimary(o)}
                        </span>
                        {secondary && (
                          <span className="block text-xs text-black/40 dark:text-white/40 truncate leading-tight">
                            {secondary}
                          </span>
                        )}
                      </span>
                      {isActive && <CheckIcon className="w-4 h-4 shrink-0 text-black/60 dark:text-white/60" />}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}
