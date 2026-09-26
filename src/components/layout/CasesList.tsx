"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCases, type Case } from "./use-cases";
import { ChevronIcon, EMPTY_ITEM, HEADER_CHEVRON, MUTED_HEADER, PRIMARY_ROW_PLAIN, SECONDARY_ROW } from "./sidebar-styles";

// Sidebar "Cases" section: collapsible header, a "+ New Case" row that opens an
// independent case chat (/create?new=case — the first message creates the case
// and the chat stays on that page), then the team's shared cases (DB-backed,
// kept live via realtime). Rows navigate to the case workspace at /cases/[id].
export default function CasesList() {
  const { cases, remove, loading } = useCases();
  const pathname = usePathname();
  const [open, setOpen] = useState(true);
  const [menuId, setMenuId] = useState<string | null>(null);

  // Close the kebab menu on outside click / Esc (mirrors ChatRecents).
  useEffect(() => {
    if (!menuId) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest("[data-cases-menu]") && !t.closest("[data-cases-menu-trigger]")) {
        setMenuId(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuId(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuId]);

  const renderRow = (item: Case) => {
    // Show the account number (falling back to the case name if a case has no
    // account attached).
    const label = item.accountNumber ?? item.name;
    return (
    <li key={item.id} className="group/row relative">
      <Link
        href={`/cases/${item.id}`}
        className={`${SECONDARY_ROW} flex items-center gap-2 pr-7 ${
          pathname === `/cases/${item.id}`
            ? "bg-surface dark:bg-surface-dark text-black dark:text-white"
            : ""
        }`}
      >
        <BriefcaseIcon className="w-3.5 h-3.5 shrink-0 text-black/40 dark:text-white/40" />
        <span className="truncate min-w-0" title={label}>{label}</span>
      </Link>
      <button
        type="button"
        data-cases-menu-trigger
        aria-label="Case options"
        aria-haspopup="menu"
        aria-expanded={menuId === item.id}
        onClick={(e) => {
          e.stopPropagation();
          setMenuId(menuId === item.id ? null : item.id);
        }}
        className={`absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded-md text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 transition-opacity ${
          menuId === item.id ? "opacity-100" : "opacity-0 group-hover/row:opacity-100 focus:opacity-100"
        }`}
      >
        <KebabIcon className="w-4 h-4" />
      </button>
      {menuId === item.id && (
        // Elevated surface — same lift as the recents menu so it reads over the sidebar in dark.
        <div
          data-cases-menu
          role="menu"
          className="absolute right-1 top-[calc(50%+0.75rem)] z-50 min-w-[8rem] py-1 rounded-lg border border-border dark:border-white/10 bg-sidebar dark:bg-[#242424] medium:bg-[#c2c2c2] shadow-xl"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              remove(item.id);
              setMenuId(null);
            }}
            className="w-full text-left px-3 py-1.5 text-[13px] text-black/70 dark:text-white/70 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          >
            Delete
          </button>
        </div>
      )}
    </li>
    );
  };

  return (
    <div className="mt-4">
      <button type="button" onClick={() => setOpen((o) => !o)} className={MUTED_HEADER}>
        <span>Cases</span>
        <ChevronIcon className={`${HEADER_CHEVRON} ${open ? "rotate-0" : "-rotate-90"}`} />
      </button>
      {open && (
        <ul className="space-y-0.5">
          <li>
            <Link
              href="/create?new=case"
              onClick={() => window.dispatchEvent(new CustomEvent("composer:new-case"))}
              className={PRIMARY_ROW_PLAIN}
            >
              <PlusIcon className="w-4 h-4 shrink-0" />
              New Case
            </Link>
          </li>
          {cases.length === 0 ? (
            <li className={EMPTY_ITEM}>{loading ? "Loading…" : "No cases yet."}</li>
          ) : (
            cases.map(renderRow)
          )}
        </ul>
      )}
    </div>
  );
}

function BriefcaseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m-12 8.006c-.66 0-1.207-.535-1.207-1.196V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.885m7.5 0a48.667 48.667 0 00-7.5 0" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

function KebabIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </svg>
  );
}
