"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { usePageDrawer } from "./PageDrawerContext";
import PageLauncher from "./PageLauncher";
import { useChat } from "@/components/ai-chat";
import { startInspector, type ElementPick } from "@/lib/page-drawer/element-inspector";

// The drawer is flush (no left inset), so its left edge should track the cursor exactly.
const LEFT_INSET = 0;

// Height of the drawer's header band — the floating icon row above the faint
// divider. Single source of truth: it positions the divider AND clamps the
// element-picker highlight so the purple box stops at the line, never riding up
// into the icon row. 40px matches the main app Header's bottom border.
const HEADER_BAND_PX = 40;

// Right-side slide-out that renders an account page in an iframe (canvas=true strips the
// page's own chrome). Same floating-card treatment + left-edge resize as the Studio chat
// panel, so it matches the sidebar/navbar look.
export default function PageDrawer() {
  const { page, open, close, drawerWidth, setWidth, resizing, setResizing, expanded, toggleExpand } = usePageDrawer();
  const { attachReference, canvasAccountNumber, canvasAccountName } = useChat();
  const router = useRouter();
  const pathname = usePathname();
  const resizingRef = useRef(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const [picking, setPicking] = useState(false);
  // The session's selected account (from the chat picker bar). Broadcast on
  // `composer:session-context` — the same event the header chips consume — so a
  // launched page opens scoped to the account the user is working on, not the
  // page's default first account.
  const [sessionAccount, setSessionAccount] = useState<string | null>(null);
  useEffect(() => {
    const onCtx = (e: Event) => {
      const detail = (e as CustomEvent).detail as { accountNumber?: string | null } | null;
      setSessionAccount(detail?.accountNumber ?? null);
    };
    window.addEventListener("composer:session-context", onCtx);
    // Live signal — the chat broadcasts the picked account the instant it changes,
    // before any message is sent, so the open page re-scopes immediately.
    window.addEventListener("composer:active-account", onCtx);
    return () => {
      window.removeEventListener("composer:session-context", onCtx);
      window.removeEventListener("composer:active-account", onCtx);
    };
  }, []);
  // Drag-to-resize from the left edge (mirror of the Studio chat panel).
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      setWidth(window.innerWidth - e.clientX + LEFT_INSET);
    };
    const onUp = () => {
      if (!resizingRef.current) return;
      resizingRef.current = false;
      setResizing(false);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [setWidth, setResizing]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    setResizing(true);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  };

  // ── Element picker: inspect the drawer's iframe → stage a reference in chat ──
  const stopPicking = () => {
    stopRef.current?.();
    stopRef.current = null;
    setPicking(false);
  };

  const handlePick = (pick: ElementPick) => {
    stopRef.current = null;
    setPicking(false);
    if (!page) return;
    // Account identity: prefer what the iframe already posted to chat context
    // (composer:canvas:accountSelected), else fall back to the iframe's ?account= param.
    let accountNumber = canvasAccountNumber || undefined;
    const accountName = canvasAccountName || undefined;
    if (!accountNumber) {
      try {
        const href = iframeRef.current?.contentWindow?.location.href;
        if (href) accountNumber = new URL(href).searchParams.get("account") || undefined;
      } catch {
        // not ready — skip
      }
    }
    attachReference({
      id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      kind: "element",
      label: pick.label,
      pageName: page.name,
      pageHref: page.href,
      accountNumber,
      accountName,
      elementRole: pick.elementRole,
      tagName: pick.tagName,
      text: pick.text,
      context: pick.context,
      selector: pick.selector,
    });
    // Surface the center chat (and the new chip). The drawer stays open — its
    // state lives in PageDrawerProvider and survives the route change.
    if (pathname !== "/chat") router.push("/chat");
  };

  const togglePicking = () => {
    if (picking) {
      stopPicking();
      return;
    }
    const iframe = iframeRef.current;
    if (!iframe) return;
    setPicking(true);
    stopRef.current = startInspector(
      iframe,
      {
        onPick: handlePick,
        onCancel: () => {
          stopRef.current = null;
          setPicking(false);
        },
      },
      { headerOffset: HEADER_BAND_PX },
    );
  };

  // Cancel any active pick when the drawer closes, the page changes, or we unmount.
  useEffect(() => {
    if (!open) stopPicking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    stopPicking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.href]);
  useEffect(() => () => {
    stopRef.current?.();
  }, []);

  const src = page
    ? `${page.href}${page.href.includes("?") ? "&" : "?"}canvas=true${
        sessionAccount ? `&account=${encodeURIComponent(sessionAccount)}` : ""
      }`
    : "";
  // panelWidth (px) comes from the context — the same value AppShell uses for the
  // page content's right margin, so the panel and the content never disagree.

  return (
    <div
      className={`fixed right-0 top-0 h-screen z-40 ${open ? "" : "pointer-events-none"}`}
      style={{
        width: drawerWidth,
        transition: resizing ? "none" : "width 360ms cubic-bezier(0.34, 1.5, 0.64, 1)",
      }}
      aria-hidden={!open}
    >
      {/* While dragging, a full-viewport overlay sits above the iframe so the cursor never
          enters the iframe — otherwise the iframe swallows mousemove and the drag stutters. */}
      {resizing && <div className="fixed inset-0 z-[60] cursor-col-resize select-none" />}

      {/* Left-edge resize handle. Hidden only when expanded (full-screen). While
          auto-maxed (sidebar collapsed → drawer grown to the max width) the handle
          stays live — dragging it hands width control back to the user. */}
      {open && !expanded && (
        <div
          onMouseDown={startResize}
          title="Drag to resize"
          className="absolute top-0 -left-1 h-full w-4 cursor-col-resize z-50 group select-none"
        >
          <div
            className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-12 w-1 rounded-full bg-black/20 dark:bg-white/25 transition-opacity ${
              resizing ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
          />
        </div>
      )}

      {/* The page panel — a floating rounded card inset from the screen edges, in the
          navbar's lifted surface tone (bg-sidebar), so the launched page reads as a
          distinct panel like the left sidebar rather than a continuation of the chat.
          The controls float over the page's top-right, so there's no header bar. */}
      <aside className="page-drawer-card absolute inset-2 overflow-hidden rounded-2xl border border-border dark:border-border-dark bg-sidebar dark:bg-sidebar-dark medium:bg-[#c2c2c2] glass:backdrop-blur-2xl glass:backdrop-saturate-150">
        {/* The selected page in an iframe. In glass mode the page renders see-through
            (see .glass.in-canvas in globals.css) so the card's frosted frame shows behind it. */}
        {page && (
          <iframe ref={iframeRef} key={src} src={src} title={page.name} className="w-full h-full border-0 bg-transparent" />
        )}

        {/* Page launcher (9-dot) — top-left; opens the page menu (dropdown opens inward). */}
        <div className="absolute top-2.5 left-2.5 z-10 flex items-center gap-1">
          <PageLauncher variant="drawer" align="left" />
          {/* Expand / collapse — fills the screen (hiding the center chat) and back. */}
          <button
            type="button"
            title={expanded ? "Collapse page" : "Expand page to full screen"}
            aria-pressed={expanded}
            onClick={toggleExpand}
            className="p-1 rounded-md transition-colors text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5"
          >
            {expanded ? <CollapseIcon className="w-3.5 h-3.5" /> : <ExpandIcon className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Faint header line — sits below the floating controls so the pointer / close row
            reads as a header band over the page. Aligned at 40px to match the main app
            Header's bottom border across the screen. */}
        <div
          className="absolute inset-x-0 z-[6] h-px bg-black/10 dark:bg-white/10 pointer-events-none"
          style={{ top: HEADER_BAND_PX }}
          aria-hidden="true"
        />

        {/* Controls — flat icon row over the page, top-right (no chip backgrounds). */}
        <div className="absolute top-2.5 right-2.5 z-10 flex items-center gap-1">
          <button
            type="button"
            title={picking ? "Cancel element select (Esc)" : "Select an element to reference in chat"}
            aria-pressed={picking}
            onClick={togglePicking}
            className={`p-1 rounded-md transition-colors ${
              picking
                ? "text-accent bg-accent/10"
                : "text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5"
            }`}
          >
            <PointerIcon className="w-3.5 h-3.5" />
          </button>
          {/* Close (X) — dismisses the panel entirely, back to the centered chat. */}
          <button
            type="button"
            title="Close"
            onClick={close}
            className="p-1 rounded-md transition-colors text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5"
          >
            <CloseIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      </aside>
    </div>
  );
}

// Clean cursor / navigation arrow (a mouse pointer without the tail) — mirrors the
// Telegram-style send/navigation glyph.
function PointerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round">
      <path d="M4.6 4.3a.5.5 0 0 1 .64-.64l15.2 5.95a.5.5 0 0 1-.05.95l-6.66 1.66a1 1 0 0 0-.73.73l-1.66 6.66a.5.5 0 0 1-.95.05z" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

// Four corner arrows pointing outward — expand the page to full screen.
function ExpandIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3.75H4.5a.75.75 0 0 0-.75.75V9 M15 3.75h4.5a.75.75 0 0 1 .75.75V9 M9 20.25H4.5a.75.75 0 0 1-.75-.75V15 M15 20.25h4.5a.75.75 0 0 0 .75-.75V15" />
    </svg>
  );
}

// Four corner arrows pointing inward — collapse the page back to its panel.
function CollapseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.75 8.25H8.25V3.75 M20.25 8.25H15.75V3.75 M3.75 15.75H8.25V20.25 M20.25 15.75H15.75V20.25" />
    </svg>
  );
}

