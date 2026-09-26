"use client";

import { usePathname, useRouter } from "next/navigation";
import PageLauncher from "@/components/page-drawer/PageLauncher";
import { usePageDrawer } from "@/components/page-drawer/PageDrawerContext";
import CustodianSwitcher from "./CustodianSwitcher";

export default function Header() {
  const pathname = usePathname();
  const router = useRouter();
  // Terminal is a full-screen focus surface — it drops the custodian switcher and the
  // page launcher for a plain Close (X) that returns you to where you were.
  const isTerminal = pathname.startsWith("/knowledge/terminal");
  const isFocusedPage = isTerminal;
  const { open: drawerOpen } = usePageDrawer();

  return (
    <header className="h-10 bg-background flex items-center justify-between pl-3 pr-2">
      {/* Left — custodian switcher, shown on every tab. top-[8px] lines it up with the
          sidebar logo + toggle, which hold their higher (collapsed) position in both states. */}
      <div className="relative top-[8px] flex items-center gap-3">
        {!isFocusedPage && <CustodianSwitcher />}
      </div>

      {/* Right side — shown on every page. top-[8px]: nudge down to line up with the
          sidebar toggle's higher position. */}
      <div className="relative top-[8px] flex items-center gap-1">
        {/* Terminal: Close returns to a fresh session. Otherwise the page launcher —
            which lives here only while the drawer is closed (once a page is open it moves
            into the drawer's control row, so it always sits top-right beside the page). */}
        {isFocusedPage ? (
          <button
            type="button"
            aria-label="Close"
            title="Close"
            onClick={() => router.back()}
            className="p-1.5 rounded-lg text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        ) : (
          !drawerOpen && (
            /* Panel icon → the page menu (opens in the side drawer). */
            <PageLauncher variant="header" icon="panel" />
          )
        )}
      </div>
    </header>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
