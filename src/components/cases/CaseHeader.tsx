"use client";

import type { CaseRow } from "@/lib/cases";

// Case workspace meta bar: account + household context chips.
interface CaseHeaderProps {
  caseRow: CaseRow;
}

export default function CaseHeader({ caseRow }: CaseHeaderProps) {
  return (
    <div className="py-3 flex items-center gap-3 min-w-0 flex-wrap">
      {caseRow.account_number && (
        <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] shadow-sm bg-[#2D9CFF]/15 shrink-0">
          <span className="font-semibold font-mono max-w-[160px] truncate text-[#1E7FE0] dark:text-[#5CB0FF]">
            {caseRow.account_number}
          </span>
        </span>
      )}
      {caseRow.household_name && (
        <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] shadow-sm bg-[#2D9CFF]/15 shrink-0">
          <FolderIcon className="w-3 h-3 text-[#1E7FE0]/70 dark:text-[#5CB0FF]/70" />
          <span className="font-semibold max-w-[160px] truncate text-[#1E7FE0] dark:text-[#5CB0FF]">
            {caseRow.household_name}
          </span>
        </span>
      )}
    </div>
  );
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12a2.25 2.25 0 012.25-2.25h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
    </svg>
  );
}
