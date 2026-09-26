"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import Sidebar from "./Sidebar";
import Header from "./Header";
import AutoCopyPaste from "@/components/ui/AutoCopyPaste";
import { AiChatProvider, useChat } from "@/components/ai-chat";
import { WalkthroughProvider } from "@/components/walkthrough/WalkthroughContext";
import WalkthroughOverlay from "@/components/walkthrough/WalkthroughOverlay";
import CanvasChatPanel from "@/components/ai-chat/CanvasChatPanel";
import CanvasHeader from "@/components/ai-chat/CanvasHeader";
import PageDrawer from "@/components/page-drawer/PageDrawer";
import { PageDrawerProvider, usePageDrawer } from "@/components/page-drawer/PageDrawerContext";

// Routes that render without app chrome (sidebar, header, etc.)
const PUBLIC_ROUTES = ["/sign"];

function AppShellInner({ children }: { children: React.ReactNode }) {
  const { canvasPage } = useChat();
  const isCanvasMode = canvasPage !== null;
  const pathname = usePathname();
  // Studio mode mirrors the sidebar/header definition: anything that isn't Chat or Agents.
  const isStudio =
    !pathname.startsWith("/chat") && !pathname.startsWith("/agents");
  // Terminal is a full-screen focus surface: the sidebar is hidden and the content
  // fills the viewport. The header keeps its Close (X) to return to where you were.
  const isFullScreen = pathname.startsWith("/knowledge/terminal");
  const {
    open: pageDrawerOpen,
    panelWidth: pageDrawerWidth,
    resizing: pageDrawerResizing,
  } = usePageDrawer();
  // Match the sidebar's launch-open default so the content offset is correct from the
  // first paint (no collapsed→expanded flash). Kept in sync with runtime toggles via
  // the `composer:sidebar-pinned` event below.
  const [sidebarPinned, setSidebarPinned] = useState<boolean>(true);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = parseInt(localStorage.getItem("sidebar-width") || "", 10);
        if (!isNaN(saved)) return Math.min(480, Math.max(240, saved));
      } catch {}
    }
    return 240;
  });
  const [sidebarResizing, setSidebarResizing] = useState(false);

  // Keep content offset in sync with the sidebar pin state, width, and resize drag
  useEffect(() => {
    const onPinned = (e: Event) => setSidebarPinned(!!(e as CustomEvent).detail);
    const onWidth = (e: Event) => setSidebarWidth((e as CustomEvent).detail as number);
    const onResizing = (e: Event) => setSidebarResizing(!!(e as CustomEvent).detail);
    window.addEventListener("composer:sidebar-pinned", onPinned);
    window.addEventListener("composer:sidebar-width", onWidth);
    window.addEventListener("composer:sidebar-resizing", onResizing);
    return () => {
      window.removeEventListener("composer:sidebar-pinned", onPinned);
      window.removeEventListener("composer:sidebar-width", onWidth);
      window.removeEventListener("composer:sidebar-resizing", onResizing);
    };
  }, []);

  const contentMarginPx = isFullScreen ? 0 : sidebarPinned ? sidebarWidth : 64;
  // The page drawer pushes page content left, mirroring how the sidebar pushes
  // from the left. (Never in canvas mode.)
  const pageDrawerMarginPx = !isCanvasMode && pageDrawerOpen ? pageDrawerWidth : 0;
  // Premium ease for the page sliding over / off the sidebar beneath it.
  // The page is an opaque layer above the sidebar (no edge shadow, so it blends
  // with the rest of the app) that slides to cover/uncover the navbar.
  const transitionParts: string[] = [];
  if (!sidebarResizing) transitionParts.push("margin-left 320ms cubic-bezier(0.32, 0.72, 0, 1)");
  if (!pageDrawerResizing) transitionParts.push("margin-right 360ms cubic-bezier(0.34, 1.5, 0.64, 1)");
  const pageLayer = {
    marginLeft: contentMarginPx,
    marginRight: pageDrawerMarginPx,
    transition: transitionParts.length ? transitionParts.join(", ") : "none",
  };

  return (
    <>
      <AutoCopyPaste />
      <div className="flex min-h-screen">
        {!isFullScreen && <Sidebar />}
        {isCanvasMode ? (
          // Canvas layout: chat left + page iframe right
          <div
            className="relative z-30 flex-1 flex h-screen overflow-hidden min-w-0 bg-background"
            style={pageLayer}
          >
            {/* Chat panel */}
            <div className="w-[35%] min-w-[360px] max-w-[500px] flex flex-col h-full border-r border-black/10 dark:border-white/10 flex-shrink-0">
              <CanvasChatPanel />
            </div>
            {/* Page iframe */}
            <div className="flex-1 flex flex-col h-full min-w-0">
              <CanvasHeader />
              <iframe
                key={canvasPage}
                src={`${canvasPage}${canvasPage.includes("?") ? "&" : "?"}canvas=true`}
                className="flex-1 w-full border-0"
                title="Canvas page"
              />
            </div>
          </div>
        ) : (
          // Normal layout
          <div
            className="relative z-30 flex-1 flex flex-col h-screen overflow-hidden min-w-0 bg-background"
            style={pageLayer}
          >
            <Header />
            <main className="flex-1 min-h-0 min-w-0 flex flex-col">{children}</main>
          </div>
        )}
      </div>
      {!isCanvasMode && <PageDrawer />}
      <WalkthroughOverlay />
    </>
  );
}

function CanvasParamGate({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const isInsideCanvas = searchParams.get("canvas") === "true";

  if (isInsideCanvas) {
    return <main className="canvas-surface h-screen overflow-hidden">{children}</main>;
  }

  return <AppShellInner>{children}</AppShellInner>;
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPublicRoute = PUBLIC_ROUTES.some((r) => pathname.startsWith(r));

  if (isPublicRoute) {
    return <>{children}</>;
  }

  return (
    <AiChatProvider>
      <WalkthroughProvider>
        <PageDrawerProvider>
          <Suspense fallback={
            <div className="flex min-h-screen">
              <Sidebar />
              <div className="flex-1 ml-16 flex flex-col h-screen overflow-hidden min-w-0">
                <Header />
                <main className="flex-1 min-h-0 min-w-0 flex flex-col">{children}</main>
              </div>
            </div>
          }>
            <CanvasParamGate>{children}</CanvasParamGate>
          </Suspense>
        </PageDrawerProvider>
      </WalkthroughProvider>
    </AiChatProvider>
  );
}
