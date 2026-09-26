// ── Sidebar style tokens — single source of truth for all 3 modes (Chat / Studio / Agents)
//    AND the ChatRecents component. Edit a value here once; every consumer updates together. ──

// Primary nav row (Chat nav, Studio items, Agents agent rows, New chat / New agent)
export const PRIMARY_ROW =
  "flex items-center gap-2 px-3 py-0.5 rounded-lg text-[13px] transition-colors whitespace-nowrap";
export const PRIMARY_ROW_ACTIVE =
  "bg-surface dark:bg-surface-dark text-black dark:text-white font-semibold";
export const PRIMARY_ROW_INACTIVE =
  "font-medium text-black/70 dark:text-white/70 hover:text-black dark:hover:text-white hover:bg-surface dark:hover:bg-surface-dark";
export const PRIMARY_ROW_PLAIN = `w-full ${PRIMARY_ROW} ${PRIMARY_ROW_INACTIVE}`; // rows with no active state (New chat / New agent)

// Secondary list row (Chat Recents; Agents Active now / Scheduled / History items)
export const SECONDARY_ROW =
  "w-full text-left truncate px-3 py-0.5 rounded-lg text-[13px] font-medium text-black/70 dark:text-white/70 hover:text-black dark:hover:text-white hover:bg-surface dark:hover:bg-surface-dark transition-colors";

// Muted collapsible sub-header (Chat "Recents" / "Pinned"; Agents "Active now" / "Scheduled" / "History")
export const MUTED_HEADER =
  "group w-full flex items-center gap-1 px-3 mb-0.5 py-1 rounded-lg text-[13px] font-medium text-black/45 dark:text-white/45 hover:text-black/70 dark:hover:text-white/70 transition-colors";
// Studio top-level group header (COMMUNICATION / ACCOUNTS) — deliberately distinct (uppercase, full-strength).
export const GROUP_HEADER =
  "group w-full flex items-center gap-1 px-3 mb-0.5 py-0.5 rounded-lg text-[11px] font-medium uppercase tracking-wider text-black dark:text-white transition-colors";

// Empty-state list item + the chevron used in every collapsible header (rotation appended inline)
export const EMPTY_ITEM = "px-3 py-2 text-[13px] text-black/35 dark:text-white/35";
export const HEADER_CHEVRON = "w-3 h-3 shrink-0 opacity-0 group-hover:opacity-100 transition-all duration-200";

export function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
    </svg>
  );
}
