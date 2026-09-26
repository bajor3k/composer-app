"use client";

import { useEffect, useRef, useState } from "react";
import { usePageDrawer, ACCOUNT_PAGES, type AccountPage } from "./PageDrawerContext";

// The page-launcher control: a panel-rectangle icon that opens a dropdown of pages.
// Click pins it open; hover previews it (like the left navbar's collapsed-icon hover).
// Picking a page opens it in the right-side drawer. Rendered in the app header while the
// drawer is closed, and inside the drawer's control row (next to Close) once it's open —
// so the control always sits in the top-right, beside the page.
export default function PageLauncher({
  variant = "header",
  align = "right",
  icon = "grid",
}: {
  variant?: "header" | "drawer";
  // Which edge the dropdown hugs — "right" when the icon sits on the right, "left"
  // when it sits on the left (so the menu opens inward instead of off-screen).
  align?: "left" | "right";
  // Trigger glyph: the 9-dot grid (default) or the side-panel rectangle (header,
  // where the panel icon reads as "open a page in the side panel").
  icon?: "grid" | "panel";
}) {
  const { open: drawerOpen, openPage, page: activePage } = usePageDrawer();
  const [pinned, setPinned] = useState(false);
  // The menu opens only on click — no hover preview.
  const dropdownOpen = pinned;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pinned) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setPinned(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPinned(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [pinned]);

  const selectPage = (p: AccountPage) => {
    // Open / switch to the page. The panel is dismissed via its own top-left X (or Esc).
    openPage(p);
    setPinned(false);
  };

  const isDrawer = variant === "drawer";
  // Header icon matches the terminal toggle (w-4, lighter idle); drawer icon matches
  // the page's own control row (w-3.5, dimmer idle).
  const buttonClass = isDrawer
    ? `p-1 rounded-md transition-colors ${
        dropdownOpen
          ? "text-black dark:text-white bg-black/5 dark:bg-white/5"
          : "text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5"
      }`
    : `p-1.5 rounded-lg transition-colors hover:bg-black/5 dark:hover:bg-white/5 ${
        dropdownOpen || drawerOpen
          ? "text-black dark:text-white"
          : "text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white"
      }`;
  const iconClass = isDrawer ? "w-3.5 h-3.5" : "w-4 h-4";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Open page menu"
        aria-haspopup="menu"
        aria-expanded={dropdownOpen}
        title="Open page menu"
        onClick={() => setPinned((p) => !p)}
        className={buttonClass}
      >
        {icon === "panel" ? <PanelIcon className={iconClass} /> : <GridDotsIcon className={iconClass} />}
      </button>

      {dropdownOpen && (
        <div
          role="menu"
          className={`absolute ${align === "left" ? "left-0" : "right-0"} top-full mt-1.5 z-50 min-w-[210px] py-1 rounded-xl border border-border dark:border-border-dark bg-sidebar dark:bg-sidebar-dark medium:bg-[#c2c2c2] glass:backdrop-blur-2xl glass:backdrop-saturate-150 shadow-xl max-h-[75vh] overflow-y-auto`}
        >
          {ACCOUNT_PAGES.map((p) => {
            const active = drawerOpen && activePage?.href === p.href;
            return (
              <button
                key={p.href}
                type="button"
                role="menuitem"
                onClick={() => selectPage(p)}
                className={`w-full text-left px-3 py-1.5 text-[13px] transition-colors ${
                  active
                    ? "text-black dark:text-white font-medium bg-black/5 dark:bg-white/5"
                    : "text-black/70 dark:text-white/70 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5"
                }`}
              >
                {p.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// 3×3 grid of dots (app-launcher "9-dot" glyph).
function GridDotsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      {[6, 12, 18].map((cy) =>
        [6, 12, 18].map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.5" />),
      )}
    </svg>
  );
}

// Rectangle with a right-side divider — reads as "open a page in the side panel".
function PanelIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 4.5v15" />
    </svg>
  );
}
