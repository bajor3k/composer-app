// Dev-tools-style element picker for the PageDrawer's same-origin iframe.
//
// The drawer renders each page in a same-origin iframe (no sandbox), so the
// parent can reach into `iframe.contentDocument`, highlight whatever the cursor
// is over, and intercept the click — without touching the individual pages.
//
// `startInspector` arms the tool and returns a `stop()` teardown. It is one-shot:
// a click fires `onPick` (with element-level detail) and tears down; Escape fires
// `onCancel`. The caller (PageDrawer) enriches the pick with page + account info.

// The element-level detail captured at click time. The caller adds page/account.
export interface ElementPick {
  label: string;
  elementRole: string;
  tagName: string;
  text?: string;
  context?: string;
  selector?: string;
}

export interface InspectorCallbacks {
  onPick: (pick: ElementPick) => void;
  onCancel: () => void;
}

// Resolve the cursor target to the *meaningful* element: an interactive ancestor
// (button/link) wins, otherwise the enclosing table cell, otherwise the element
// itself. Used for both the highlight and the capture so they always agree.
function resolveTarget(el: HTMLElement): HTMLElement {
  const interactive = el.closest("a, button, [role='button']");
  if (interactive) return interactive as HTMLElement;
  const cell = el.closest("th, td");
  if (cell) return cell as HTMLElement;
  return el;
}

function cleanText(el: Element | null): string {
  if (!el) return "";
  return ((el as HTMLElement).innerText || el.textContent || "").trim().replace(/\s+/g, " ");
}

// Best-effort stable selector.
function buildSelector(el: HTMLElement): string {
  const dw = el.getAttribute("data-walk") || el.closest("[data-walk]")?.getAttribute("data-walk");
  if (dw) return `[data-walk="${dw}"]`;
  const tid = el.getAttribute("data-testid");
  if (tid) return `[data-testid="${tid}"]`;
  if (el.id) return `#${el.id}`;
  return el.tagName.toLowerCase();
}

// The column header for a table cell, matched by the cell's index within its row.
function findColumnHeader(cell: HTMLElement): string | null {
  const row = cell.closest("tr");
  const table = cell.closest("table");
  if (!row || !table) return null;
  const idx = Array.from(row.children).indexOf(cell);
  if (idx < 0) return null;

  const theadRows = table.querySelectorAll("thead tr");
  let headerCells: Element[] = [];
  if (theadRows.length) {
    headerCells = Array.from(theadRows[theadRows.length - 1].children);
  } else {
    const firstRow = table.querySelector("tr");
    if (firstRow && firstRow !== row) headerCells = Array.from(firstRow.children);
  }
  return cleanText(headerCells[idx]).slice(0, 60) || null;
}

// The leading label cell of the row (the first cell, if it isn't the target).
function findRowLabel(cell: HTMLElement): string | null {
  const row = cell.closest("tr");
  if (!row) return null;
  const first = row.querySelector("th, td");
  if (!first || first === cell) return null;
  return cleanText(first).slice(0, 60) || null;
}

// Nearest preceding heading (section context) for non-table content.
function nearestHeading(el: HTMLElement): string | null {
  let node: HTMLElement | null = el;
  for (let depth = 0; node && depth < 6; depth++) {
    let sib = node.previousElementSibling as HTMLElement | null;
    while (sib) {
      if (/^h[1-6]$/.test(sib.tagName.toLowerCase())) return cleanText(sib).slice(0, 60) || null;
      const h = sib.querySelector?.("h1, h2, h3, h4, h5, h6");
      if (h) return cleanText(h).slice(0, 60) || null;
      sib = sib.previousElementSibling as HTMLElement | null;
    }
    node = node.parentElement;
  }
  return null;
}

// Turn a resolved element into a smart, semantic pick.
function describe(el: HTMLElement): ElementPick {
  const tag = el.tagName.toLowerCase();
  const text = cleanText(el);
  const short = text.slice(0, 200) || undefined;
  const selector = buildSelector(el);

  if (tag === "th" || el.getAttribute("role") === "columnheader") {
    return { label: text.slice(0, 80) || "Column header", elementRole: "column header", tagName: tag, text: short, selector };
  }

  if (tag === "td" || el.getAttribute("role") === "cell" || el.getAttribute("role") === "gridcell") {
    const header = findColumnHeader(el);
    const rowLabel = findRowLabel(el);
    const ctx = [header && `Column: ${header}`, rowLabel && `Row: ${rowLabel}`].filter(Boolean).join(" · ");
    const label = header ? `${header}: ${text.slice(0, 40)}` : text.slice(0, 60) || "Table cell";
    return { label, elementRole: "table cell", tagName: tag, text: short, context: ctx.slice(0, 200) || undefined, selector };
  }

  if (/^h[1-6]$/.test(tag)) {
    return { label: text.slice(0, 80) || "Heading", elementRole: "heading", tagName: tag, text: short, selector };
  }

  if (tag === "a" || tag === "button" || el.getAttribute("role") === "button") {
    const lbl = el.getAttribute("aria-label") || text || el.getAttribute("title") || tag;
    return { label: lbl.slice(0, 60), elementRole: tag === "a" ? "link" : "button", tagName: tag, text: short, selector };
  }

  const lbl = el.getAttribute("aria-label") || el.getAttribute("title") || text.slice(0, 60) || tag;
  const heading = nearestHeading(el);
  return {
    label: lbl.slice(0, 60) || tag,
    elementRole: tag,
    tagName: tag,
    text: short,
    context: heading ? `Section: ${heading}`.slice(0, 200) : undefined,
    selector,
  };
}

export function startInspector(
  iframe: HTMLIFrameElement,
  cb: InspectorCallbacks,
  options: { headerOffset?: number } = {},
): () => void {
  let doc: Document | null = null;
  try {
    doc = iframe.contentDocument;
  } catch {
    cb.onCancel();
    return () => {};
  }
  if (!doc || !doc.body) {
    cb.onCancel();
    return () => {};
  }
  const d = doc;

  // The drawer overlays a header band (icon row above a faint divider) on the top
  // `headerOffset` px of the iframe. Since the overlay below uses the iframe's own
  // viewport coordinates (y=0 == top of the drawer card), clamp the highlight to
  // this offset so the purple box stops at the divider instead of riding up into
  // the icon row. Defaults to 0 (no header) for any other caller.
  const headerOffset = Math.max(0, options.headerOffset ?? 0);

  // Highlight overlay — fixed-position inside the iframe doc, so its coordinates
  // match getBoundingClientRect() (iframe viewport). pointer-events:none keeps it
  // transparent to hit-testing.
  const overlay = d.createElement("div");
  overlay.setAttribute("data-composer-inspector-overlay", "");
  Object.assign(overlay.style, {
    position: "fixed",
    display: "none",
    top: "0px",
    left: "0px",
    width: "0px",
    height: "0px",
    border: "2px solid var(--accent, #6366f1)",
    background: "rgba(99, 102, 241, 0.12)",
    borderRadius: "4px",
    boxShadow: "0 0 0 1px rgba(255, 255, 255, 0.35)",
    pointerEvents: "none",
    zIndex: "2147483647",
    transition: "top 60ms ease-out, left 60ms ease-out, width 60ms ease-out, height 60ms ease-out",
  } as CSSStyleDeclaration);

  const label = d.createElement("div");
  Object.assign(label.style, {
    position: "absolute",
    left: "0px",
    padding: "2px 6px",
    font: "600 11px/1.4 ui-sans-serif, system-ui, sans-serif",
    color: "#fff",
    background: "var(--accent, #6366f1)",
    borderRadius: "4px",
    whiteSpace: "nowrap",
    maxWidth: "340px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    pointerEvents: "none",
  } as CSSStyleDeclaration);
  overlay.appendChild(label);
  d.body.appendChild(overlay);

  let current: HTMLElement | null = null;
  let stopped = false;

  // Place (and header-clamp) the highlight box over `el`. Returns false when the
  // element lies entirely within the header band — nothing to show or pick there.
  const place = (el: HTMLElement): boolean => {
    const rect = el.getBoundingClientRect();
    const top = Math.max(rect.top, headerOffset);
    const height = rect.bottom - top;
    if (height <= 0) {
      overlay.style.display = "none";
      return false;
    }
    overlay.style.display = "block";
    overlay.style.top = `${top}px`;
    overlay.style.left = `${rect.left}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${height}px`;
    const pick = describe(el);
    label.textContent = pick.elementRole && pick.elementRole !== pick.tagName ? `${pick.elementRole}: ${pick.label}` : pick.label;
    // Flip the label below the box when there isn't real room above the header line.
    const above = top - headerOffset > 24;
    label.style.bottom = above ? "calc(100% + 2px)" : "auto";
    label.style.top = above ? "auto" : "calc(100% + 2px)";
    return true;
  };

  const onMove = (e: MouseEvent) => {
    const raw = d.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    if (!raw || raw === overlay || overlay.contains(raw)) return;
    const tag = raw.tagName.toLowerCase();
    if (tag === "html" || tag === "body") {
      overlay.style.display = "none";
      current = null;
      return;
    }
    const target = resolveTarget(raw);
    // Drop the target when it falls entirely under the header band, so the area
    // behind the icon row stays unhighlighted and unpickable.
    current = place(target) ? target : null;
  };

  const onClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Prefer the hovered target; on a cold click, resolve from the point but honor
    // the header clamp so the icon-row band stays unpickable.
    let target = current;
    if (!target) {
      const raw = d.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const resolved = raw ? resolveTarget(raw) : null;
      if (resolved && resolved.getBoundingClientRect().bottom > headerOffset) target = resolved;
    }
    stop();
    if (target) cb.onPick(describe(target));
    else cb.onCancel();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      stop();
      cb.onCancel();
    }
  };

  function stop() {
    if (stopped) return;
    stopped = true;
    try {
      d.removeEventListener("mousemove", onMove, true);
      d.removeEventListener("click", onClick, true);
      d.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keydown", onKey, true);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      d.body.style.cursor = "";
    } catch {
      // iframe may have navigated away — nothing to clean up.
    }
  }

  d.addEventListener("mousemove", onMove, true);
  d.addEventListener("click", onClick, true);
  d.addEventListener("keydown", onKey, true);
  // Also catch Escape when focus is on the parent (e.g. right after arming).
  window.addEventListener("keydown", onKey, true);
  d.body.style.cursor = "crosshair";

  return stop;
}
