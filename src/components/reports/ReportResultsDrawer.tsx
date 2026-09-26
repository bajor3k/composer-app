"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ReportDataRenderer } from "@/components/ai-chat/AiChatMessage";

export interface ReportResult {
  label: string;
  rows: Record<string, unknown>[] | Record<string, unknown> | null;
  rowCount: number | null;
  durationMs: number | null;
  error?: string | null;
}

/**
 * The output panel for a report run.
 *
 * Reuses ReportDataRenderer — the same component that renders report tables in
 * chat — so a report looks identical wherever it's read, and the CSV / Excel
 * export buttons come along for free rather than being rebuilt here.
 */
export default function ReportResultsDrawer({
  result,
  running,
  onClose,
}: {
  result: ReportResult | null;
  running: boolean;
  onClose: () => void;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const dismiss = () => {
    setShown(false);
    window.setTimeout(onClose, 320);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-[120]">
      <div
        className={`absolute inset-0 bg-black/40 dark:bg-black/60 transition-opacity duration-[320ms] ${shown ? "opacity-100" : "opacity-0"}`}
        onClick={dismiss}
      />
      {/* Wider than the alert builder: a report can be 20 columns, and squeezing
          it into a form-width panel would make the table unreadable. */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Report results"
        className={`absolute inset-y-2 right-2 w-[min(920px,calc(100vw-1rem))] flex flex-col overflow-hidden
          rounded-2xl border border-border dark:border-border-dark
          bg-sidebar dark:bg-sidebar-dark medium:bg-[#c2c2c2]
          glass:backdrop-blur-2xl glass:backdrop-saturate-150 shadow-2xl
          transition-transform duration-[320ms] ease-[cubic-bezier(0.32,0.72,0,1)]
          ${shown ? "translate-x-0" : "translate-x-[calc(100%+1rem)]"}`}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-black/5 dark:border-white/5">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-black dark:text-white truncate">
              {result?.label ?? "Running report…"}
            </h2>
            {result && !result.error && (
              <p className="mt-0.5 text-[11px] text-black/40 dark:text-white/40">
                {(result.rowCount ?? 0).toLocaleString()} row
                {result.rowCount === 1 ? "" : "s"}
                {result.durationMs !== null ? ` · ${result.durationMs.toLocaleString()}ms` : ""} · as
                of now
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Close"
            className="p-1 rounded-md text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 transition-colors shrink-0"
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4">
          {running && (
            <div className="py-16 text-center text-sm text-black/40 dark:text-white/40">
              Running…
            </div>
          )}

          {!running && result?.error && (
            <div
              role="alert"
              className="px-3 py-2 rounded-lg text-xs bg-red-500/10 text-red-700 dark:text-red-300 border border-red-500/20"
            >
              {result.error}
            </div>
          )}

          {!running && result && !result.error && (
            <ReportDataRenderer data={result.rows} />
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
