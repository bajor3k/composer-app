"use client";

const BASE =
  "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs bg-black/5 dark:bg-white/5 medium:bg-[#e4e4e4] text-black/70 dark:text-white/70";

/**
 * The scope chip shared by the rules table and the activity feed.
 *
 * When it names a single account it becomes a handoff: clicking opens that
 * account's Portfolio in the right-side drawer with the workspace chat centered,
 * so you go from "this alert fired" to "here's the account, ask the agent" in one
 * click. Household and whole-book scopes have no single account to open, so they
 * render static — an affordance that does nothing is worse than none.
 */
export default function ScopeChip({
  label,
  accountNumber,
  onOpenAccount,
}: {
  label: string;
  accountNumber?: string | null;
  onOpenAccount?: (accountNumber: string) => void;
}) {
  if (!accountNumber || !onOpenAccount) {
    return <span className={BASE}>{label}</span>;
  }

  return (
    <button
      type="button"
      title={`Open ${accountNumber} in the workspace`}
      onClick={(e) => {
        e.stopPropagation();
        onOpenAccount(accountNumber);
      }}
      className={`${BASE} hover:bg-black/10 dark:hover:bg-white/10 hover:text-black dark:hover:text-white transition-colors cursor-pointer`}
    >
      {label}
    </button>
  );
}
