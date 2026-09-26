"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import type { CrmClient } from "@/lib/crm/clients";
import { formatAddress, formatAge, formatCurrency, formatLabel } from "@/lib/format-utils";

type SortKey =
  | "fullName"
  | "householdName"
  | "advisorName"
  | "accountCount"
  | "totalAum"
  | "onboardingStatus";
type SortDirection = "asc" | "desc";

// Shared cell padding — tight so the columns fit the drawer card, loosening as it widens.
const PAD = "px-2 lg:px-3";
const PAD_L = "pl-3 lg:pl-4 pr-2";
const PAD_R = "pr-3 lg:pr-4 pl-2";

const COLUMN_COUNT = 7;

// Compact money keeps the AUM column narrow inside the drawer; exact figure on hover.
const moneyCompact = (value: number) =>
  new Intl.NumberFormat("en-US", {
    notation: "compact",
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 1,
  }).format(value);

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  individual: "Individual",
  joint: "Joint",
  ira: "Traditional IRA",
  roth_ira: "Roth IRA",
  sep_ira: "SEP IRA",
  simple_ira: "SIMPLE IRA",
  trust: "Trust",
  k401: "401(k)",
  k403b: "403(b)",
};
const accountTypeLabel = (t: string) =>
  ACCOUNT_TYPE_LABELS[t.toLowerCase()] ?? formatLabel(t.toLowerCase());
const custodianLabel = (c: string) =>
  c ? c.charAt(0).toUpperCase() + c.slice(1).toLowerCase() : "–";

function statusClass(status: string | null) {
  switch ((status ?? "").toLowerCase()) {
    case "active":
      return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-500";
    case "in_progress":
      return "bg-[#F59E0B]/10 text-[#B45309] dark:text-[#F59E0B]";
    case "prospect":
      return "bg-blue-500/10 text-blue-600 dark:text-blue-400";
    default:
      return "bg-black/5 dark:bg-white/10 text-black/50 dark:text-white/50";
  }
}

export default function ClientsTable({
  rows,
  canvasHref,
}: {
  rows: CrmClient[];
  canvasHref: (href: string) => string;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("fullName");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const sortedRows = useMemo(() => {
    const dir = sortDirection === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av ?? "").localeCompare(String(bv ?? "")) * dir;
    });
  }, [rows, sortKey, sortDirection]);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection(key === "totalAum" || key === "accountCount" ? "desc" : "asc");
    }
  }

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (column !== sortKey) return null;
    return sortDirection === "asc" ? (
      <ChevronUpIcon className="w-3 h-3 inline ml-0.5" />
    ) : (
      <ChevronDownIcon className="w-3 h-3 inline ml-0.5" />
    );
  };

  if (sortedRows.length === 0) {
    return (
      <div className="py-12 text-center text-black/40 dark:text-white/40 text-sm">
        No clients found
      </div>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 z-10">
        <tr className="border-b border-black/5 dark:border-white/5 bg-[#f2f2f2] dark:bg-[#0a0a0a] medium:bg-[#bcbcbc]">
          <Th onClick={() => handleSort("fullName")} className={`text-left ${PAD_L}`}>
            Client <SortIcon column="fullName" />
          </Th>
          <Th
            onClick={() => handleSort("householdName")}
            className={`text-left ${PAD} hidden md:table-cell`}
          >
            Household <SortIcon column="householdName" />
          </Th>
          <Th
            onClick={() => handleSort("advisorName")}
            className={`text-left ${PAD} hidden xl:table-cell`}
          >
            Advisor <SortIcon column="advisorName" />
          </Th>
          <Th className={`text-left ${PAD} hidden lg:table-cell`}>Email</Th>
          <Th
            onClick={() => handleSort("accountCount")}
            className={`text-right ${PAD} hidden sm:table-cell`}
          >
            Accts <SortIcon column="accountCount" />
          </Th>
          <Th onClick={() => handleSort("totalAum")} className={`text-right ${PAD}`}>
            Total AUM <SortIcon column="totalAum" />
          </Th>
          <Th
            onClick={() => handleSort("onboardingStatus")}
            className={`text-center ${PAD_R}`}
          >
            Status <SortIcon column="onboardingStatus" />
          </Th>
        </tr>
      </thead>
      <tbody>
        {sortedRows.map((c) => {
          const isExpanded = expandedId === c.id;
          return (
            <Fragment key={c.id}>
              <tr
                onClick={() => setExpandedId(isExpanded ? null : c.id)}
                className="border-b border-black/5 dark:border-white/5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors cursor-pointer"
              >
                <td className={`${PAD_L} py-3.5`}>
                  <span className="inline-flex items-center gap-1.5">
                    <ChevronRightIcon
                      className={`w-3 h-3 shrink-0 text-black/30 dark:text-white/30 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                    />
                    <span className="font-semibold text-black dark:text-white truncate max-w-[150px] lg:max-w-[240px]">
                      {c.fullName}
                    </span>
                  </span>
                </td>
                <td
                  className={`${PAD} py-3.5 text-black/50 dark:text-white/50 hidden md:table-cell max-w-[160px] truncate`}
                >
                  {c.householdName || <Dash />}
                </td>
                <td
                  className={`${PAD} py-3.5 text-black/50 dark:text-white/50 hidden xl:table-cell whitespace-nowrap`}
                >
                  {c.advisorName || <Dash />}
                </td>
                <td
                  className={`${PAD} py-3.5 text-black/50 dark:text-white/50 hidden lg:table-cell max-w-[200px] truncate`}
                >
                  {c.email || <Dash />}
                </td>
                <td
                  className={`${PAD} py-3.5 text-right text-black/50 dark:text-white/50 hidden sm:table-cell tabular-nums`}
                >
                  {c.accountCount}
                </td>
                <td
                  className={`${PAD} py-3.5 text-right font-medium text-black dark:text-white tabular-nums`}
                  title={formatCurrency(c.totalAum)}
                >
                  {moneyCompact(c.totalAum)}
                </td>
                <td className={`${PAD_R} py-3.5 text-center whitespace-nowrap`}>
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusClass(c.onboardingStatus)}`}
                  >
                    {formatLabel(c.onboardingStatus)}
                  </span>
                </td>
              </tr>

              {isExpanded && (
                <tr className="border-b border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.02]">
                  <td colSpan={COLUMN_COUNT} className="p-0">
                    <div className="px-4 lg:px-6 py-4 space-y-5">
                      <Section title="Contact">
                        <Field label="Email" value={c.email} />
                        <Field label="Phone" value={c.phone} />
                        <Field label="Secondary phone" value={c.secondaryPhone} />
                        <Field
                          label="Address"
                          value={formatAddress(c.address, c.city, c.state, c.zipCode)}
                        />
                      </Section>

                      <Section title="Profile">
                        <Field label="Age" value={formatAge(c.dateOfBirth)} />
                        <Field label="Citizenship" value={c.citizenshipCountry} />
                        <Field
                          label="Employment"
                          value={c.employmentStatus ? formatLabel(c.employmentStatus) : null}
                        />
                        <Field label="Occupation" value={c.occupation} />
                        <Field label="Employer" value={c.employer} />
                      </Section>

                      <Section title="Financial">
                        <Field
                          label="Annual income"
                          value={c.annualIncome === null ? null : formatCurrency(c.annualIncome)}
                        />
                        <Field
                          label="Net worth"
                          value={c.netWorth === null ? null : formatCurrency(c.netWorth)}
                        />
                        <Field
                          label="Liquid net worth"
                          value={
                            c.liquidNetWorth === null ? null : formatCurrency(c.liquidNetWorth)
                          }
                        />
                        <Field
                          label="Source of funds"
                          value={c.sourceOfFunds ? formatLabel(c.sourceOfFunds) : null}
                        />
                      </Section>

                      <Section title="Suitability">
                        <Field
                          label="Risk tolerance"
                          value={c.riskTolerance ? formatLabel(c.riskTolerance) : null}
                        />
                        <Field
                          label="Objective"
                          value={
                            c.investmentObjective ? formatLabel(c.investmentObjective) : null
                          }
                        />
                        <Field
                          label="Time horizon"
                          value={c.timeHorizon ? formatLabel(c.timeHorizon) : null}
                        />
                        <Field
                          label="Liquidity needs"
                          value={c.liquidityNeeds ? formatLabel(c.liquidityNeeds) : null}
                        />
                        <Field
                          label="Experience"
                          value={
                            c.investmentExperience ? formatLabel(c.investmentExperience) : null
                          }
                        />
                      </Section>

                      <Section title="Trusted contact">
                        <Field label="Name" value={c.trustedContactName} />
                        <Field label="Phone" value={c.trustedContactPhone} />
                        <Field
                          label="Relationship"
                          value={
                            c.trustedContactRelationship
                              ? formatLabel(c.trustedContactRelationship)
                              : null
                          }
                        />
                      </Section>

                      {c.accounts.length > 0 && (
                        <div>
                          <SectionTitle>Accounts ({c.accounts.length})</SectionTitle>
                          <div className="space-y-1.5">
                            {c.accounts.map((a) => (
                              <div
                                key={a.id}
                                className="flex items-center justify-between gap-4 text-[12.5px]"
                              >
                                <span className="flex items-center gap-2 min-w-0">
                                  <Link
                                    href={canvasHref(
                                      `/accounts/portfolio?account=${a.accountNumber}`,
                                    )}
                                    onClick={(e) => e.stopPropagation()}
                                    className="font-mono text-black/70 dark:text-white/70 hover:text-black dark:hover:text-white hover:underline shrink-0"
                                  >
                                    {a.accountNumber}
                                  </Link>
                                  <span className="text-black/50 dark:text-white/50 truncate">
                                    {accountTypeLabel(a.accountType)}
                                  </span>
                                  <span className="text-black/30 dark:text-white/30 hidden sm:inline">
                                    {custodianLabel(a.custodian)}
                                  </span>
                                </span>
                                <span className="tabular-nums text-black/70 dark:text-white/70 shrink-0">
                                  {formatCurrency(a.balance)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {c.notes && (
                        <div>
                          <SectionTitle>Notes</SectionTitle>
                          <p className="text-[12.5px] text-black/70 dark:text-white/70 leading-snug max-w-3xl">
                            {c.notes}
                          </p>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function Th({
  children,
  className = "",
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <th
      onClick={onClick}
      className={`py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider whitespace-nowrap ${onClick ? "cursor-pointer select-none" : ""} ${className}`}
    >
      {children}
    </th>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-[10.5px] uppercase tracking-wider text-black/40 dark:text-white/40 mb-2 pb-1 border-b border-black/5 dark:border-white/5">
      {children}
    </h4>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <SectionTitle>{title}</SectionTitle>
      <dl className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-x-6 gap-y-3">
        {children}
      </dl>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  const empty = value === null || value === undefined || value === "" || value === "–";
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wider text-black/40 dark:text-white/40">
        {label}
      </dt>
      <dd
        className={`text-[12.5px] mt-0.5 break-words ${
          empty ? "text-black/25 dark:text-white/25" : "text-black/80 dark:text-white/80"
        }`}
      >
        {empty ? "—" : value}
      </dd>
    </div>
  );
}

function Dash() {
  return <span className="text-black/25 dark:text-white/25">—</span>;
}

function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

function ChevronUpIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}
