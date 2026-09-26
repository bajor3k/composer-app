"use client";

import { type ChatReference } from "./types";

// A chip representing a "smart reference" the user captured with the element
// picker. Mirrors AttachmentCard's look, but carries a pointer icon and a
// page · account subtitle. Used both staged (with onRemove) above the composer
// and read-only on a sent user message.
export default function ReferenceChip({
  reference,
  onRemove,
}: {
  reference: ChatReference;
  onRemove?: () => void;
}) {
  const subtitle = [reference.pageName, reference.accountName || reference.accountNumber]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className={`relative group flex items-center gap-2.5 pl-2.5 py-2 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] max-w-[240px] ${
        onRemove ? "pr-7" : "pr-3"
      }`}
      title={reference.context || reference.text || reference.label}
    >
      <PointerIcon className="w-4 h-4 flex-shrink-0 text-black/45 dark:text-white/45" />
      <div className="min-w-0">
        <p className="text-xs font-medium text-black dark:text-white truncate leading-tight">
          {reference.label}
        </p>
        {subtitle && (
          <p className="text-[10px] text-black/35 dark:text-white/35 leading-tight truncate uppercase tracking-wide">
            {subtitle}
          </p>
        )}
      </div>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove reference"
          className="absolute top-1 right-1.5 text-black/25 dark:text-white/25 hover:text-black dark:hover:text-white text-sm leading-none transition-colors"
        >
          ×
        </button>
      )}
    </div>
  );
}

// Clean cursor / navigation arrow (a mouse pointer without the tail) — matches the
// element-picker glyph in PageDrawer.
function PointerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round">
      <path d="M4.6 4.3a.5.5 0 0 1 .64-.64l15.2 5.95a.5.5 0 0 1-.05.95l-6.66 1.66a1 1 0 0 0-.73.73l-1.66 6.66a.5.5 0 0 1-.95.05z" />
    </svg>
  );
}
