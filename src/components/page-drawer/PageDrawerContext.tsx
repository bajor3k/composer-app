"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

// The pages launched from the header Play button. Moved here out of the sidebar's
// Accounts section — selecting one opens it in the right-side PageDrawer.
export interface AccountPage {
  name: string;
  href: string;
}

export const ACCOUNT_PAGES: AccountPage[] = [
  { name: "Portfolio", href: "/accounts/portfolio" },
  { name: "Holdings", href: "/accounts/holdings" },
  { name: "Trade Blotter", href: "/accounts/trading" },
  { name: "Cash", href: "/accounts/cash" },
  { name: "Households", href: "/accounts/households" },
  { name: "Transfers", href: "/accounts/transfers" },
  { name: "Retirement Data", href: "/accounts/retirement" },
  { name: "Share Class Analysis", href: "/accounts/share-class" },
  { name: "Performance", href: "/accounts/performance" },
  { name: "Billing", href: "/accounts/billing" },
  { name: "CRM", href: "/communication/crm" },
];

// Resize bounds for the drawer (px). A page needs more room than the chat panel.
export const PAGE_DRAWER_MIN_WIDTH = 480;
export const PAGE_DRAWER_MAX_WIDTH = 1200;
export const PAGE_DRAWER_DEFAULT_WIDTH = 840;

const WIDTH_KEY = "composer-page-drawer-width";

// The drawer has two faces: a centered menu of launchable pages and a page
// rendered in the iframe. Menu mode is a fixed-width slide-out; page mode is the
// resizable panel.
export type PageDrawerMode = "menu" | "page";

// Menu mode opens to a quarter of the viewport, independent of the page-mode
// resize bounds.
export const PAGE_DRAWER_MENU_FRACTION = 0.25;

// The center column (chat) must stay usable when a page is expanded out — the
// chat never shrinks below this. Dragging the drawer wider than that point stops
// pushing the chat and overlaps it instead (see PAGE_DRAWER_CHAT_PEEK).
export const MIN_CENTER_WIDTH = 440;
// How much of the chat column stays visible when the drawer is dragged over it —
// the overlap stops here so the conversation is still peeking out behind the panel.
export const PAGE_DRAWER_CHAT_PEEK = 150;
// Even on a very narrow viewport the drawer stays at least this wide so its page
// remains readable (the chat can scroll / overlap rather than the drawer vanishing).
const PAGE_DRAWER_VIEWPORT_FLOOR = 360;
const COLLAPSED_SIDEBAR_WIDTH = 64;

interface PageDrawerValue {
  page: AccountPage | null;
  open: boolean;
  mode: PageDrawerMode;
  openMenu: () => void;
  toggle: () => void;
  openPage: (page: AccountPage) => void;
  close: () => void;
  width: number;
  // The width the page content's right margin reserves (0 when closed). Follows the
  // drawer until the center column hits MIN_CENTER_WIDTH — past that the drawer
  // overlaps the chat instead of pushing it, and this value stops growing.
  panelWidth: number;
  // The width the drawer card actually paints — equals panelWidth normally, grows past it
  // when dragged into the overlap zone, and jumps to the full viewport when `expanded`.
  // Kept separate from panelWidth so the content's right margin never squeezes the chat
  // below MIN_CENTER_WIDTH or forces a horizontal scrollbar.
  drawerWidth: number;
  // True when a launched page is expanded to fill the screen (the center chat is hidden).
  expanded: boolean;
  // True while the drawer auto-expands to fill the space freed by a collapsed sidebar
  // (its width is fixed at the max, so the resize handle is suppressed).
  autoMaxed: boolean;
  toggleExpand: () => void;
  setWidth: (w: number) => void;
  resizing: boolean;
  setResizing: (v: boolean) => void;
}

const PageDrawerContext = createContext<PageDrawerValue | null>(null);

function clampWidth(w: number) {
  return Math.min(PAGE_DRAWER_MAX_WIDTH, Math.max(PAGE_DRAWER_MIN_WIDTH, w));
}

export function PageDrawerProvider({ children }: { children: React.ReactNode }) {
  const [page, setPage] = useState<AccountPage | null>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<PageDrawerMode>("menu");
  const [expanded, setExpanded] = useState(false);
  const [width, setWidthState] = useState<number>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = parseInt(sessionStorage.getItem(WIDTH_KEY) || "", 10);
        if (!isNaN(saved)) return clampWidth(saved);
      } catch {}
    }
    return PAGE_DRAWER_DEFAULT_WIDTH;
  });
  const [resizing, setResizing] = useState(false);
  // True once the user drags the handle while the sidebar is collapsed — the drawer
  // then follows their width instead of staying pinned to the max. Reset whenever
  // the sidebar pin state changes so a fresh collapse re-claims the freed space.
  const [autoMaxOverridden, setAutoMaxOverridden] = useState(false);

  // Track viewport width + the sidebar's content offset so the drawer can cap
  // itself and never collapse the center column. Mirrors AppShell's own state,
  // sourced from the same localStorage keys and `composer:sidebar-*` events.
  const [viewportW, setViewportW] = useState<number>(() =>
    typeof window !== "undefined" ? window.innerWidth : 1440
  );
  // Mirror the sidebar's launch-open default (see Sidebar.tsx) so the drawer caps
  // against the right content offset from first paint; synced via the
  // `composer:sidebar-pinned` event below.
  const [sidebarPinned, setSidebarPinned] = useState<boolean>(true);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = parseInt(localStorage.getItem("sidebar-width") || "", 10);
        if (!isNaN(saved)) return Math.min(480, Math.max(200, saved));
      } catch {}
    }
    return 240;
  });

  useEffect(() => {
    const onResize = () => setViewportW(window.innerWidth);
    const onPinned = (e: Event) => {
      setSidebarPinned(!!(e as CustomEvent).detail);
      setAutoMaxOverridden(false);
    };
    const onWidth = (e: Event) => setSidebarWidth((e as CustomEvent).detail as number);
    window.addEventListener("resize", onResize);
    window.addEventListener("composer:sidebar-pinned", onPinned);
    window.addEventListener("composer:sidebar-width", onWidth);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("composer:sidebar-pinned", onPinned);
      window.removeEventListener("composer:sidebar-width", onWidth);
    };
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(WIDTH_KEY, String(width));
    } catch {}
  }, [width]);

  // Page mode: clamp the on-screen width so `viewport − sidebar − drawer`
  // stays ≥ MIN_CENTER_WIDTH. The user's stored width is preserved (used as-is
  // when the window is wide enough) and re-expands when there's room again.
  const sidebarOffset = sidebarPinned ? sidebarWidth : COLLAPSED_SIDEBAR_WIDTH;
  const maxByViewport = viewportW - sidebarOffset - MIN_CENTER_WIDTH;
  // The widest the drawer may paint right now: the project's resize ceiling, but
  // never so wide it eats the center column (MIN_CENTER_WIDTH) or drops below the floor.
  const maxAllowed = Math.max(
    PAGE_DRAWER_VIEWPORT_FLOOR,
    Math.min(PAGE_DRAWER_MAX_WIDTH, maxByViewport),
  );
  // Past maxAllowed the chat stops shrinking and the drawer slides over it instead —
  // but the overlap stops while PAGE_DRAWER_CHAT_PEEK px of the chat is still visible.
  const paintCap = Math.max(
    PAGE_DRAWER_VIEWPORT_FLOOR,
    viewportW - sidebarOffset - PAGE_DRAWER_CHAT_PEEK,
  );
  // With the left sidebar collapsed, a launched page claims the freed space and grows
  // to that ceiling — until the user drags the handle, which hands control back to
  // their chosen width. Re-pinning the sidebar restores the user's chosen width. (Menu
  // mode is a fixed fraction and never auto-maxes.)
  const autoMaxed = open && mode !== "menu" && !sidebarPinned && !autoMaxOverridden;
  // What the drawer card paints in page mode: auto-max claims exactly the freed,
  // non-overlapping space; a manual drag can go further, into the overlap zone.
  const pageWidth = autoMaxed ? maxAllowed : Math.min(width, paintCap);
  // Page mode is the resizable panel; only menu mode is fixed.
  const effectiveWidth = mode === "menu" ? width : pageWidth;

  // The width the content's right margin reserves (px), shared with AppShell. Menu
  // mode is a fixed fraction of the viewport; page mode follows the drawer but stops
  // at maxAllowed so the chat never drops below MIN_CENTER_WIDTH — past that the
  // drawer overlaps instead of pushing. Closed collapses to 0 so the margin animates
  // away with the panel.
  const panelWidth = !open
    ? 0
    : mode === "menu"
    ? viewportW * PAGE_DRAWER_MENU_FRACTION
    : Math.min(pageWidth, maxAllowed);

  // Expanded page mode paints the full viewport so the card covers the chat; page
  // mode paints pageWidth (which may overlap the chat); menu mode paints panelWidth.
  const drawerWidth = !open
    ? 0
    : expanded && mode !== "menu"
    ? viewportW
    : mode === "menu"
    ? panelWidth
    : pageWidth;

  const openMenu = useCallback(() => {
    setMode("menu");
    setOpen(true);
  }, []);
  const toggle = useCallback(() => {
    setOpen((o) => {
      if (!o) setMode("menu");
      return !o;
    });
  }, []);
  const openPage = useCallback(
    (p: AccountPage) => {
      setPage(p);
      setMode("page");
      setOpen(true);
      // A fresh open never starts overlapped — the stored width applies up to the
      // push limit; the overlap zone is reachable only by dragging the handle.
      setWidthState((w) => Math.min(w, maxAllowed));
    },
    [maxAllowed],
  );
  const close = useCallback(() => {
    setOpen(false);
    setExpanded(false);
  }, []);
  const toggleExpand = useCallback(() => setExpanded((e) => !e), []);
  const setWidth = useCallback((w: number) => {
    setWidthState(clampWidth(w));
    // A manual resize while auto-maxed takes over from the pinned-to-max width.
    setAutoMaxOverridden(true);
  }, []);

  return (
    <PageDrawerContext.Provider
      value={{
        page,
        open,
        mode,
        openMenu,
        toggle,
        openPage,
        close,
        width: effectiveWidth,
        panelWidth,
        drawerWidth,
        expanded,
        autoMaxed,
        toggleExpand,
        setWidth,
        resizing,
        setResizing,
      }}
    >
      {children}
    </PageDrawerContext.Provider>
  );
}

export function usePageDrawer() {
  const ctx = useContext(PageDrawerContext);
  if (!ctx) throw new Error("usePageDrawer must be used within PageDrawerProvider");
  return ctx;
}
