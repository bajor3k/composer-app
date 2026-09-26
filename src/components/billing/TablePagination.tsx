"use client";

// Sliding-window pager shared by the billing tables (same markup as the cash page footer).
export default function TablePagination({
  total,
  page,
  pageSize,
  onPageChange,
}: {
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0 || totalPages <= 1) return null;

  const VISIBLE = 5;
  let windowStart = Math.max(1, page - Math.floor(VISIBLE / 2));
  const windowEnd = Math.min(totalPages, windowStart + VISIBLE - 1);
  if (windowEnd - windowStart + 1 < VISIBLE) {
    windowStart = Math.max(1, windowEnd - VISIBLE + 1);
  }
  const visiblePages = Array.from({ length: windowEnd - windowStart + 1 }, (_, i) => windowStart + i);

  return (
    <div className="flex items-center justify-between mt-6 pb-2 px-6 pt-6 border-t border-black/5 dark:border-white/5">
      <span className="text-xs text-black/40 dark:text-white/40 tabular-nums">
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page === 1}
          className="px-2 py-1 rounded-md text-xs text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
        </button>
        <div className="flex items-center gap-1 overflow-hidden">
          {visiblePages.map((p) => (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              className={`w-7 h-7 rounded-md text-xs font-medium transition-all duration-200 ${
                page === p
                  ? "bg-black/[0.07] dark:bg-white/[0.07] text-black dark:text-white"
                  : "text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
        <button
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page === totalPages}
          className="px-2 py-1 rounded-md text-xs text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
        </button>
      </div>
    </div>
  );
}
