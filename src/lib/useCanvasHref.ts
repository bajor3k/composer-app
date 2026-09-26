"use client";

import { useSearchParams } from "next/navigation";

// In canvas mode (a page rendered inside the PageDrawer iframe with `?canvas=true`),
// cross-page navigation must carry `canvas=true` forward — otherwise the target page
// renders the full app chrome (sidebar/header) INSIDE the drawer iframe. This hook
// returns a function that appends `canvas=true` to an href only when the current page
// is itself in canvas mode; outside canvas mode it returns the href untouched.
export function useCanvasHref() {
  const searchParams = useSearchParams();
  const inCanvas = searchParams.get("canvas") === "true";
  return (href: string) =>
    inCanvas ? `${href}${href.includes("?") ? "&" : "?"}canvas=true` : href;
}
