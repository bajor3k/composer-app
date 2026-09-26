import type { Action } from "@/lib/share-class/types";

// Semantic colors for each decision — the color coding IS the signal. Mapped onto
// Composer's tinted-badge convention (translucent fills work across all five themes).
const ACTION_STYLES: Record<string, string> = {
  CONVERT: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-500",
  NO_CHANGE: "bg-black/5 dark:bg-white/10 text-black/50 dark:text-white/50",
  SUPPRESSED: "bg-black/5 dark:bg-white/10 text-black/50 dark:text-white/50",
  REVIEW_TAX: "bg-[#F59E0B]/10 text-[#B45309] dark:text-[#F59E0B]",
  HELD_AWAY_ADVISE: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  DATA_GAP: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  PENDING_CUSTODIAN_DATA: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
};

export function actionLabel(action: string): string {
  return action.replace(/_/g, " ");
}

export function ActionPill({ action, flagged }: { action: Action; flagged?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span
        className={`px-2 py-0.5 rounded-full text-xs font-medium ${ACTION_STYLES[action] ?? ACTION_STYLES.NO_CHANGE}`}
      >
        {actionLabel(action)}
      </span>
      {flagged && (
        <span title="See drill-down" className="text-[#F59E0B] text-xs">
          ⚠
        </span>
      )}
    </span>
  );
}
