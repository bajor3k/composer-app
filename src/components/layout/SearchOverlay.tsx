"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

/** A result row. `href` is where selecting it navigates; without one the row is inert. */
export type SearchItem = { label: string; href?: string };

export default function SearchOverlay({
  open,
  onClose,
  mode,
  items,
}: {
  open: boolean;
  onClose: () => void;
  mode: string;
  items: SearchItem[];
}) {
  const [query, setQuery] = useState("");
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const filtered = query.trim()
    ? items.filter((t) => t.label.toLowerCase().includes(query.toLowerCase()))
    : items;

  const handleSelect = (item: SearchItem) => {
    onClose();
    if (item.href) router.push(item.href);
    else if (mode === "Alerts") router.push("/alerts");
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[16vh] px-4 bg-black/30 dark:bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-black/10 dark:border-white/10 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-black/5 dark:border-white/5">
          <SearchIcon className="w-5 h-5 text-black/30 dark:text-white/30 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${mode.toLowerCase()}`}
            className="flex-1 bg-transparent text-sm text-black dark:text-white placeholder-black/30 dark:placeholder-white/30 outline-none"
          />
          <button
            onClick={onClose}
            className="p-1 rounded-md text-black/30 dark:text-white/30 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            aria-label="Close search"
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>
        <div className="max-h-[50vh] overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-black/40 dark:text-white/40">
              {items.length === 0 ? `Nothing to search in ${mode} yet` : "No results"}
            </div>
          ) : (
            filtered.map((item, i) => (
              <button
                key={item.href ?? i}
                onClick={() => handleSelect(item)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm text-black dark:text-white hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
              >
                <ChatBubbleIcon className="w-4 h-4 flex-shrink-0 text-black/30 dark:text-white/30" />
                <span className="truncate">{item.label}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35m1.85-5.4a7.25 7.25 0 11-14.5 0 7.25 7.25 0 0114.5 0z" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function ChatBubbleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
    </svg>
  );
}
