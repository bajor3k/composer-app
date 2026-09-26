"use client";

import { useState } from "react";
import SearchablePicker from "./SearchablePicker";
import type { AccountOption, HouseholdOption } from "./useAccountDirectory";

// The chat's "working directory" once a message is sent: it stays right on top of the
// composer instead of moving to the header. The household (folder) chip carries a
// hover-reveal × that closes the session; the account (file) chip is a picker — click
// it to switch among the household's accounts.
interface DockedContextBarProps {
  household: HouseholdOption | null;
  account: AccountOption | null;
  householdAccounts: AccountOption[];
  onPickAccount: (a: AccountOption) => void;
  onEndSession: () => void;
}

export default function DockedContextBar({
  household,
  account,
  householdAccounts,
  onPickAccount,
  onEndSession,
}: DockedContextBarProps) {
  const [accountOpen, setAccountOpen] = useState(false);

  if (!household && !account) return null;

  return (
    <div className="flex items-center gap-1">
      {household && (
        <span
          className="group/hh relative inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] bg-[#2D9CFF]/15 shadow-sm chip-raise"
          title={`Household: ${household.name}`}
        >
          <HouseholdIcon className="w-3 h-3 text-[#1E7FE0]/70 dark:text-[#5CB0FF]/70 shrink-0" />
          <span className="font-semibold text-[#1E7FE0] dark:text-[#5CB0FF] max-w-[140px] truncate">
            {household.name}
          </span>
          {/* Corner × — revealed on hover. Closes the session: archives it to History
              and drops the chat back to its centered new-chat UI. */}
          <button
            type="button"
            aria-label="Close session"
            title="Close session — saves it to History"
            onClick={onEndSession}
            className="absolute -top-1.5 -right-1.5 hidden group-hover/hh:flex items-center justify-center w-4 h-4 rounded-full bg-[#1E7FE0] dark:bg-[#5CB0FF] text-white dark:text-black shadow-sm leading-none"
          >
            <CloseIcon className="w-2.5 h-2.5" />
          </button>
        </span>
      )}

      {/* Account # — a picker scoped to the household's accounts. */}
      {(household || account) && (
        <SearchablePicker<AccountOption>
          label="Account #"
          icon={<AccountIcon className="w-3 h-3" />}
          emptyLabel="Account"
          placeholder="Search account…"
          value={account}
          options={householdAccounts}
          getKey={(a) => a.accountNumber}
          getPrimary={(a) => a.accountNumber}
          getSecondary={(a) => a.accountName}
          matches={(a, q) => {
            const t = q.toLowerCase();
            return (
              a.accountNumber.toLowerCase().includes(t) ||
              a.accountName.toLowerCase().includes(t) ||
              a.clientName.toLowerCase().includes(t)
            );
          }}
          onSelect={onPickAccount}
          emptyHint="No accounts in this household"
          open={accountOpen}
          onOpenChange={setAccountOpen}
        />
      )}
    </div>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function AccountIcon({ className }: { className?: string }) {
  // File / document — the account record.
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
      />
    </svg>
  );
}

function HouseholdIcon({ className }: { className?: string }) {
  // Folder — the household (a "folder" of accounts).
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 12.75V12a2.25 2.25 0 012.25-2.25h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
      />
    </svg>
  );
}
