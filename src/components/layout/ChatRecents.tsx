"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useChatRecents, type ChatRecent } from "./use-chat-recents";
import { ChevronIcon, EMPTY_ITEM, HEADER_CHEVRON, MUTED_HEADER, SECONDARY_ROW } from "./sidebar-styles";

export default function ChatRecents() {
  const router = useRouter();
  const { recents, pin, unpin, rename, remove } = useChatRecents();
  const [pinnedOpen, setPinnedOpen] = useState(true);
  const [recentsOpen, setRecentsOpen] = useState(true);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const pinnedItems = recents.filter((r) => r.pinned);
  const recentItems = recents.filter((r) => !r.pinned);

  // Close the kebab menu on outside click / Esc.
  useEffect(() => {
    if (!menuId) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest("[data-recents-menu]") && !t.closest("[data-recents-menu-trigger]")) {
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

  const renderRow = (item: ChatRecent) => (
    <li key={item.id} className="group/row relative">
      {editingId === item.id ? (
        <RenameInput
          initial={item.title}
          onCommit={(val) => {
            rename(item.id, val);
            setEditingId(null);
          }}
          onCancel={() => setEditingId(null)}
        />
      ) : (
        <>
          <button
            type="button"
            data-testid="recent-row"
            title={item.title}
            onClick={() => {
              // The push keeps the URL shareable/reloadable; the event is what actually
              // loads the thread when we're already on /chat, where router.push does
              // not remount the page. Same pattern as composer:new-case.
              router.push(`/chat?c=${encodeURIComponent(item.id)}`);
              window.dispatchEvent(
                new CustomEvent("composer:open-conversation", { detail: item.id }),
              );
            }}
            className={`${SECONDARY_ROW} flex items-center gap-2 pr-7`}
          >
            <span className="truncate min-w-0">{item.title}</span>
          </button>
          <button
            type="button"
            data-recents-menu-trigger
            data-testid="recent-kebab"
            aria-label="Recent options"
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
            // Elevated surface: the menu floats over the sidebar, so in dark mode it needs a
            // lift above the sidebar's own #121212 (a same-color card was nearly invisible).
            <div
              data-recents-menu
              role="menu"
              className="absolute right-1 top-[calc(50%+0.75rem)] z-50 min-w-[8rem] py-1 rounded-lg border border-border dark:border-white/10 bg-sidebar dark:bg-[#242424] medium:bg-[#c2c2c2] shadow-xl"
            >
              <MenuItem
                label={item.pinned ? "Unpin" : "Pin"}
                onClick={() => {
                  if (item.pinned) unpin(item.id);
                  else pin(item.id);
                  setMenuId(null);
                }}
              />
              <MenuItem
                label="Rename"
                onClick={() => {
                  setEditingId(item.id);
                  setMenuId(null);
                }}
              />
              <MenuItem
                label="Delete"
                onClick={() => {
                  remove(item.id);
                  setMenuId(null);
                }}
              />
            </div>
          )}
        </>
      )}
    </li>
  );

  return (
    <>
      {/* Pinned — only appears once something is actually pinned. */}
      {pinnedItems.length > 0 && (
        <div className="mt-4">
          <button type="button" onClick={() => setPinnedOpen((o) => !o)} className={MUTED_HEADER}>
            <span>Pinned</span>
            <ChevronIcon className={`${HEADER_CHEVRON} ${pinnedOpen ? "rotate-0" : "-rotate-90"}`} />
          </button>
          {pinnedOpen && <ul className="space-y-0.5">{pinnedItems.map((item) => renderRow(item))}</ul>}
        </div>
      )}

      {/* Recents */}
      <div className="mt-4">
        <button type="button" onClick={() => setRecentsOpen((o) => !o)} className={MUTED_HEADER}>
          <span>History</span>
          <ChevronIcon className={`${HEADER_CHEVRON} ${recentsOpen ? "rotate-0" : "-rotate-90"}`} />
        </button>
        {recentsOpen && (
          <ul className="space-y-0.5">
            {recentItems.length === 0 ? (
              <li className={EMPTY_ITEM}>No recent chats.</li>
            ) : (
              recentItems.map((item) => renderRow(item))
            )}
          </ul>
        )}
      </div>
    </>
  );
}

function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="w-full text-left px-3 py-1.5 text-[13px] text-black/70 dark:text-white/70 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
    >
      {label}
    </button>
  );
}

function RenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (val: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const settledRef = useRef(false); // guards against blur firing after Enter/Esc
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const commit = (val: string) => {
    if (settledRef.current) return;
    settledRef.current = true;
    onCommit(val);
  };
  const cancel = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    onCancel();
  };
  return (
    <input
      ref={ref}
      data-testid="recent-rename-input"
      defaultValue={initial}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit((e.target as HTMLInputElement).value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
      }}
      onBlur={(e) => (e.target.value.trim() ? commit(e.target.value) : cancel())}
      className="w-full px-3 py-0.5 rounded-lg text-[13px] bg-white dark:bg-black/40 text-black dark:text-white border border-border dark:border-border-dark outline-none focus:ring-1 focus:ring-black/20 dark:focus:ring-white/20"
    />
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
