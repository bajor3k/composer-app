"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import UserMenu from "./UserMenu";
import SearchOverlay from "./SearchOverlay";
import { useState, useEffect, useRef } from "react";
import { useWalkthrough } from "@/components/walkthrough/WalkthroughContext";
import {
  PRIMARY_ROW,
  PRIMARY_ROW_ACTIVE,
  PRIMARY_ROW_INACTIVE,
} from "./sidebar-styles";
import ChatRecents from "./ChatRecents";
import CasesList from "./CasesList";
import { useChatRecents } from "./use-chat-recents";

// Open-sidebar resize bounds (px)
// 240 is the narrowest width where the "Composer" wordmark plus the header
// icons still fit on one line inside the card (header min-content ≈ 221px + insets).
const MIN_SIDEBAR_WIDTH = 240;
const MAX_SIDEBAR_WIDTH = 480;
const DEFAULT_SIDEBAR_WIDTH = 240;
const RIGHT_INSET = 8; // matches the card's `right-2` inset so the edge tracks the cursor

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [searchOpen, setSearchOpen] = useState(false);
  // The navbar launches "out" (expanded) on every app open, rather than restoring a
  // persisted collapsed state. Collapsing still works for the session and survives
  // in-app navigation (via the localStorage mirror written below), but a fresh launch
  // always starts expanded. Width stays user-persisted.
  const [pinned, setPinned] = useState<boolean>(true);
  // Persisted width of the open sidebar (px). Drag the right edge to resize.
  const [expandedWidth, setExpandedWidth] = useState<number>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = parseInt(localStorage.getItem("sidebar-width") || "", 10);
        if (!isNaN(saved)) return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, saved));
      } catch {}
    }
    return DEFAULT_SIDEBAR_WIDTH;
  });
  const [resizing, setResizing] = useState(false);
  const resizingRef = useRef(false);
  // True while the bottom user menu (and its side flyouts) is open — suppresses the
  // resize handle so it can't steal clicks meant for a menu item.
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  // Hover-preview flyout shown when the collapsed panel icon is hovered.
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { steps, currentStep, highlightTarget } = useWalkthrough();
  const { recents: chatRecents } = useChatRecents();

  // Current session sub-mode (chat | alert | report), broadcast by the chat
  // page so the matching nav row highlights to match what's on screen. The sidebar lives
  // in the persistent layout, so this listener is attached before the chat page mounts.
  const [chatSubmode, setChatSubmode] = useState("chat");
  useEffect(() => {
    const onMode = (e: Event) => setChatSubmode(((e as CustomEvent).detail as string) || "chat");
    window.addEventListener("composer:chat-mode", onMode);
    return () => window.removeEventListener("composer:chat-mode", onMode);
  }, []);

  const walkthroughActive = currentStep >= 0 && currentStep < steps.length;
  const sidebarExpanded = pinned || walkthroughActive || !!highlightTarget;
  // The hover flyout only exists in the collapsed state.
  const previewState = !sidebarExpanded && previewOpen;

  // Highlight the chat-driven rows only while the chat/create surface is on screen;
  // chatSubmode is sticky, so gate it behind the route.
  const inChatArea = pathname.startsWith("/chat") || pathname.startsWith("/create");
  const chatRowActive = (mode: string) => inChatArea && chatSubmode === mode;

  // Persist pin state + notify the shell so it can shift content over
  useEffect(() => {
    try {
      localStorage.setItem("sidebar-pinned", String(pinned));
    } catch {}
    window.dispatchEvent(new CustomEvent("composer:sidebar-pinned", { detail: pinned }));
  }, [pinned]);

  // Persist width + notify the shell so the page margin follows the sidebar's right edge
  useEffect(() => {
    try {
      localStorage.setItem("sidebar-width", String(expandedWidth));
    } catch {}
    window.dispatchEvent(new CustomEvent("composer:sidebar-width", { detail: expandedWidth }));
  }, [expandedWidth]);

  // Drag-to-resize: listeners live for the component's lifetime, gated by resizingRef
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      const next = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, e.clientX + RIGHT_INSET));
      setExpandedWidth(next);
    };
    const onUp = () => {
      if (!resizingRef.current) return;
      resizingRef.current = false;
      setResizing(false);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      window.dispatchEvent(new CustomEvent("composer:sidebar-resizing", { detail: false }));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    setResizing(true);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";
    window.dispatchEvent(new CustomEvent("composer:sidebar-resizing", { detail: true }));
  };

  // Hover-preview open/close, shared by the panel icon and the flyout card.
  const openPreview = () => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    if (!sidebarExpanded) setPreviewOpen(true);
  };
  const closePreview = () => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => setPreviewOpen(false), 160);
  };
  useEffect(() => () => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
  }, []);

  // Browser-style back / forward next to the Composer wordmark.
  const navArrows = (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        title="Back"
        onClick={() => router.back()}
        className="p-1 rounded-md text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
      >
        <NavBackIcon className="w-4 h-4" />
      </button>
      <button
        type="button"
        title="Forward"
        onClick={() => router.forward()}
        className="p-1 rounded-md text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
      >
        <NavFwdIcon className="w-4 h-4" />
      </button>
    </div>
  );

  // ── The single, unified nav list (no Research / Studio / Agents tabs). ──
  // New Session = a plain chat. Alerts / Reports switch the center chat
  // into that creation mode. Documents opens the form gallery. Pinned + Recents
  // live below, unchanged.
  const modeContent = (
    <>
      <ul className="space-y-0.5 mb-2">
        <li>
          <Link
            href="/chat"
            onClick={() => window.dispatchEvent(new CustomEvent("composer:new-chat"))}
            className={`w-full ${PRIMARY_ROW} ${chatRowActive("chat") ? PRIMARY_ROW_ACTIVE : PRIMARY_ROW_INACTIVE}`}
          >
            <NewChatIcon className="w-4 h-4 shrink-0" />
            New Workspace
          </Link>
        </li>
        <li>
          {/* Alerts is the Alert Center, not a chat mode. The natural-language
              builder still lives at /create?new=alert, reached from the center's
              "Describe in chat" link. */}
          <Link
            href="/alerts"
            className={`w-full ${PRIMARY_ROW} ${
              pathname.startsWith("/alerts") ? PRIMARY_ROW_ACTIVE : PRIMARY_ROW_INACTIVE
            }`}
          >
            <AlertsIcon className="w-4 h-4 shrink-0" />
            Alerts
          </Link>
        </li>
        <li>
          {/* Reports is the Report Center, not a chat mode. The natural-language
              builder still lives at /create?new=report, reached from the
              center's "Describe in chat" link. */}
          <Link
            href="/reports"
            className={`w-full ${PRIMARY_ROW} ${
              pathname.startsWith("/reports") ? PRIMARY_ROW_ACTIVE : PRIMARY_ROW_INACTIVE
            }`}
          >
            <ReportsIcon className="w-4 h-4 shrink-0" />
            Reports
          </Link>
        </li>
      </ul>
      <CasesList />
      <ChatRecents />
    </>
  );

  // The full navbar body (header + nav + account) — used by the flyout card.
  const navbarBody = (
    <>
      {/* Header: logo + search */}
      <div className="flex items-center justify-between pt-3 px-3 mb-1">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-black dark:text-white whitespace-nowrap">Composer</span>
          {navArrows}
        </div>
        <button
          type="button"
          title="Search"
          onClick={() => setSearchOpen(true)}
          className="p-1.5 rounded-lg text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
        >
          <SearchIcon className="w-5 h-5" />
        </button>
      </div>
      <nav className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-2 pb-2">{modeContent}</nav>
      <UserMenu expanded inline />
    </>
  );

  return (
    <div
      className="fixed left-0 top-0 h-screen z-40"
      style={{
        width: sidebarExpanded ? expandedWidth : 64,
        transition: resizing ? "none" : "width 360ms cubic-bezier(0.34, 1.5, 0.64, 1)",
      }}
    >
    <aside
      className={`app-sidebar absolute flex flex-col transition-[inset,background-color,border-color,border-radius] duration-[320ms] ease-[cubic-bezier(0.32,0.72,0,1)] ${
        sidebarExpanded
          ? "is-expanded inset-y-2 left-2 right-2 rounded-2xl border border-border dark:border-border-dark bg-sidebar dark:bg-sidebar-dark medium:bg-[#c2c2c2] glass:backdrop-blur-2xl glass:backdrop-saturate-150"
          : "inset-0 border border-transparent bg-background"
      }`}
    >
      {/* Sidebar header / toggle — the panel toggle icon stays visible when collapsed.
          Expanded uses pt-1 (vs pt-3) to cancel the card's 8px inset-y-2, so the toggle
          holds the same higher position it has when collapsed instead of dropping down. */}
      <div className={`flex items-center px-3 mb-1 ${sidebarExpanded ? "pt-1 justify-between" : "pt-3 justify-center"}`}>
        {sidebarExpanded && (
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-black dark:text-white whitespace-nowrap">Composer</span>
            {navArrows}
          </div>
        )}
        <div className="flex items-center gap-1">
          {sidebarExpanded && (
            <button
              type="button"
              title="Search"
              onClick={() => setSearchOpen(true)}
              className="p-1.5 rounded-lg text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            >
              <SearchIcon className="w-5 h-5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setPinned((p) => !p)}
            onMouseEnter={openPreview}
            onMouseLeave={closePreview}
            title={pinned ? "Close sidebar" : "Open sidebar"}
            className="p-1.5 rounded-lg text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          >
            <SidebarPanelIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Nav (only when pinned open; the flyout renders its own copy) */}
      <nav className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-2 pb-20">
        {sidebarExpanded && modeContent}
      </nav>

    </aside>

    {/* Hover flyout — collapsed only. Pops below the panel icon, hugs the left edge,
        content-height capped above the screen bottom. Mirrors the full navbar. */}
    {previewState && (
      <div
        onMouseEnter={openPreview}
        onMouseLeave={closePreview}
        className="app-sidebar-flyout absolute left-2 top-12 z-50 flex flex-col rounded-2xl border border-border dark:border-border-dark bg-sidebar dark:bg-sidebar-dark medium:bg-[#c2c2c2] glass:backdrop-blur-2xl glass:backdrop-saturate-150 shadow-xl overflow-hidden animate-[fadeIn_120ms_ease-out]"
        style={{ width: expandedWidth, maxHeight: "calc(100vh - 64px)" }}
      >
        {navbarBody}
      </div>
    )}

    {/* User avatar — pinned to the outer wrapper's constant bottom-left so it never moves
        between states. Hidden while the hover flyout is up (the card carries its own). */}
    {!previewState && <UserMenu expanded={sidebarExpanded} onExpand={() => setPinned(true)} onOpenChange={setUserMenuOpen} />}

    {/* Resize handle — drag the right edge of the open sidebar to set its width.
        Hidden while the user menu is open so its side flyouts (which overlap this
        right-edge strip) receive clicks instead of triggering a resize. */}
    {sidebarExpanded && !userMenuOpen && (
      <div
        onMouseDown={startResize}
        title="Drag to resize"
        className="absolute top-0 right-0 h-full w-3 cursor-grab active:cursor-grabbing z-50 group select-none"
      >
        <div className="absolute top-1/2 right-[6px] -translate-y-1/2 h-12 w-1 rounded-full bg-black/15 dark:bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    )}

    <SearchOverlay
      open={searchOpen}
      onClose={() => setSearchOpen(false)}
      mode="Sessions"
      items={chatRecents.map((r) => ({ label: r.title, href: `/chat?c=${encodeURIComponent(r.id)}` }))}
    />
    </div>
  );
}

// --- Sidebar toggle icons ---

function NavBackIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
    </svg>
  );
}

function NavFwdIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35m1.85-5.4a7.25 7.25 0 11-14.5 0 7.25 7.25 0 0114.5 0z" />
    </svg>
  );
}

function SidebarPanelIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v15" />
    </svg>
  );
}

// --- Nav item icons ---

function NewChatIcon({ className }: { className?: string }) {
  // Plus — "New Session".
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

function AlertsIcon({ className }: { className?: string }) {
  // Bell — "Alerts".
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
    </svg>
  );
}

function ReportsIcon({ className }: { className?: string }) {
  // Document with text lines — "Reports".
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  );
}

