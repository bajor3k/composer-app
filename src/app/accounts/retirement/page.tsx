"use client";

import { Suspense, useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useCanvasHref } from "@/lib/useCanvasHref";

export default function RetirementDataPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full">
          <div className="text-muted">Loading retirement data...</div>
        </div>
      }
    >
      <RetirementDataContent />
    </Suspense>
  );
}

const ITEMS_PER_PAGE = 50;
const CURRENT_YEAR = 2026;

// IRS Uniform Lifetime Table (SECURE Act 2.0)
const UNIFORM_LIFETIME_TABLE: Record<number, number> = {
  72: 27.4, 73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7, 77: 22.9,
  78: 22.0, 79: 21.1, 80: 20.2, 81: 19.4, 82: 18.5, 83: 17.7,
  84: 16.8, 85: 16.0, 86: 15.2, 87: 14.4, 88: 13.7, 89: 12.9,
  90: 12.2, 91: 11.5, 92: 10.8, 93: 10.1, 94: 9.5, 95: 8.9,
  96: 8.4, 97: 7.8, 98: 7.3, 99: 6.8, 100: 6.4, 101: 6.0,
  102: 5.6, 103: 5.2, 104: 4.9, 105: 4.6, 106: 4.3, 107: 4.1,
  108: 3.9, 109: 3.7, 110: 3.5, 111: 3.4, 112: 3.3, 113: 3.1,
  114: 3.0, 115: 2.9, 116: 2.8, 117: 2.7, 118: 2.5, 119: 2.3, 120: 2.0,
};

type ActiveTab = "contributions" | "rmds";

type ContributionRow = {
  account_id: string;
  account_number: string;
  account_name: string;
  account_type: string;
  custodian: string;
  client_name: string;
  date_of_birth: string;
  household_name: string | null;
  household_id: string | null;
  ytd_contributions: number;
  contribution_count: number;
  age: number;
  contribution_limit: number;
  remaining_allowance: number;
  status: "On Track" | "Maxed" | "Over Limit";
};

type RmdRow = {
  account_id: string;
  account_number: string;
  account_name: string;
  account_type: string;
  custodian: string;
  client_name: string;
  date_of_birth: string;
  household_name: string | null;
  household_id: string | null;
  prior_year_end_balance: number;
  ytd_distributions: number;
  age: number;
  distribution_period: number;
  rmd_amount: number;
  remaining_rmd: number;
  status: "Complete" | "Pending" | "Overdue";
};

type ContribSortColumn = "account_number" | "account_name" | "account_type" | "client_name" | "age" | "custodian" | "ytd_contributions" | "contribution_limit" | "remaining_allowance" | "status" | "household_name";
type RmdSortColumn = "account_number" | "client_name" | "age" | "custodian" | "prior_year_end_balance" | "distribution_period" | "rmd_amount" | "ytd_distributions" | "remaining_rmd" | "status";
type SortDirection = "asc" | "desc";

function calculateAge(dob: Date, asOf: Date): number {
  let age = asOf.getFullYear() - dob.getFullYear();
  const m = asOf.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && asOf.getDate() < dob.getDate())) age--;
  return age;
}

function getContributionLimit(accountType: string, age: number): number {
  if (accountType === "ira" || accountType === "roth_ira") return age >= 50 ? 8500 : 7500;
  if (accountType === "sep_ira") return 70000;
  if (accountType === "simple_ira") return age >= 50 ? 20000 : 16500;
  return 7500;
}

function getDistributionPeriod(age: number): number {
  if (age < 72) return 0;
  if (age > 120) return 2.0;
  return UNIFORM_LIFETIME_TABLE[age] ?? 2.0;
}

const TEXT_SORT_COLUMNS = new Set(["account_number", "account_name", "account_type", "client_name", "custodian", "household_name", "status"]);

function RetirementDataContent() {
  // Keep canvas mode when navigating to another page from inside the drawer iframe.
  const canvasHref = useCanvasHref();
  const [activeTab, setActiveTab] = useState<ActiveTab>("contributions");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contributionData, setContributionData] = useState<ContributionRow[]>([]);
  const [rmdData, setRmdData] = useState<RmdRow[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  // Sort state — separate per tab
  const [contribSortColumn, setContribSortColumn] = useState<ContribSortColumn>("ytd_contributions");
  const [contribSortDirection, setContribSortDirection] = useState<SortDirection>("desc");
  const [rmdSortColumn, setRmdSortColumn] = useState<RmdSortColumn>("rmd_amount");
  const [rmdSortDirection, setRmdSortDirection] = useState<SortDirection>("desc");

  // Reset page when search/sort/tab changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, activeTab, contribSortColumn, contribSortDirection, rmdSortColumn, rmdSortDirection]);

  const handleContribSort = (column: ContribSortColumn) => {
    if (contribSortColumn === column) {
      const defaultDir = TEXT_SORT_COLUMNS.has(column) ? "asc" : "desc";
      if (contribSortDirection !== defaultDir) {
        setContribSortColumn("ytd_contributions");
        setContribSortDirection("desc");
      } else {
        setContribSortDirection(defaultDir === "asc" ? "desc" : "asc");
      }
    } else {
      setContribSortColumn(column);
      setContribSortDirection(TEXT_SORT_COLUMNS.has(column) ? "asc" : "desc");
    }
  };

  const handleRmdSort = (column: RmdSortColumn) => {
    if (rmdSortColumn === column) {
      const defaultDir = TEXT_SORT_COLUMNS.has(column) ? "asc" : "desc";
      if (rmdSortDirection !== defaultDir) {
        setRmdSortColumn("rmd_amount");
        setRmdSortDirection("desc");
      } else {
        setRmdSortDirection(defaultDir === "asc" ? "desc" : "asc");
      }
    } else {
      setRmdSortColumn(column);
      setRmdSortDirection(TEXT_SORT_COLUMNS.has(column) ? "asc" : "desc");
    }
  };

  // Fetch data
  useEffect(() => {
    async function fetchData() {
      const BATCH = 1000;

      // Fetch contributions
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allContrib: any[] = [];
      let cFrom = 0;
      while (true) {
        const { data, error: cErr } = await supabase
          .from("retirement_contributions_view")
          .select("*")
          .range(cFrom, cFrom + BATCH - 1);
        if (cErr) {
          console.error("Error fetching contributions:", cErr.message);
          setError("Unable to connect to database. Please check your connection.");
          setLoading(false);
          return;
        }
        if (!data || data.length === 0) break;
        allContrib.push(...data);
        if (data.length < BATCH) break;
        cFrom += BATCH;
      }

      const asOfDate = new Date(CURRENT_YEAR, 11, 31);
      const enrichedContrib: ContributionRow[] = allContrib.map((row) => {
        const age = row.date_of_birth ? calculateAge(new Date(row.date_of_birth), asOfDate) : 0;
        const limit = getContributionLimit(row.account_type, age);
        const ytd = Number(row.ytd_contributions) || 0;
        const remaining = Math.max(0, limit - ytd);
        const status: ContributionRow["status"] = ytd > limit ? "Over Limit" : ytd >= limit ? "Maxed" : "On Track";
        return {
          account_id: row.account_id,
          account_number: row.account_number,
          account_name: row.account_name,
          account_type: row.account_type,
          custodian: row.custodian,
          client_name: row.client_name,
          date_of_birth: row.date_of_birth,
          household_name: row.household_name,
          household_id: row.household_id,
          ytd_contributions: ytd,
          contribution_count: Number(row.contribution_count) || 0,
          age,
          contribution_limit: limit,
          remaining_allowance: remaining,
          status,
        };
      });
      setContributionData(enrichedContrib);

      // Fetch RMDs
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allRmd: any[] = [];
      let rFrom = 0;
      while (true) {
        const { data, error: rErr } = await supabase
          .from("retirement_rmd_view")
          .select("*")
          .range(rFrom, rFrom + BATCH - 1);
        if (rErr) {
          console.error("Error fetching RMDs:", rErr.message);
          // Don't block — contributions still loaded
          break;
        }
        if (!data || data.length === 0) break;
        allRmd.push(...data);
        if (data.length < BATCH) break;
        rFrom += BATCH;
      }

      const enrichedRmd: RmdRow[] = allRmd.map((row) => {
        const age = row.date_of_birth ? calculateAge(new Date(row.date_of_birth), asOfDate) : 0;
        const period = getDistributionPeriod(age);
        const balance = Number(row.prior_year_end_balance) || 0;
        const rmdAmount = period > 0 ? Math.round(balance / period * 100) / 100 : 0;
        const ytdDist = Number(row.ytd_distributions) || 0;
        const remainingRmd = Math.max(0, rmdAmount - ytdDist);
        const status: RmdRow["status"] = remainingRmd <= 0 ? "Complete" : "Pending";
        return {
          account_id: row.account_id,
          account_number: row.account_number,
          account_name: row.account_name,
          account_type: row.account_type,
          custodian: row.custodian,
          client_name: row.client_name,
          date_of_birth: row.date_of_birth,
          household_name: row.household_name,
          household_id: row.household_id,
          prior_year_end_balance: balance,
          ytd_distributions: ytdDist,
          age,
          distribution_period: period,
          rmd_amount: rmdAmount,
          remaining_rmd: remainingRmd,
          status,
        };
      });
      setRmdData(enrichedRmd);
      setLoading(false);
    }

    fetchData();
  }, []);

  // Filter + sort contributions
  const filteredContributions = useMemo(() => {
    const q = searchQuery.toLowerCase();
    const filtered = contributionData.filter((r) =>
      r.account_number.toLowerCase().includes(q) ||
      (r.account_name && r.account_name.toLowerCase().includes(q)) ||
      (r.client_name && r.client_name.toLowerCase().includes(q)) ||
      (r.household_name && r.household_name.toLowerCase().includes(q))
    );
    return [...filtered].sort((a, b) => {
      const aVal = a[contribSortColumn];
      const bVal = b[contribSortColumn];
      if (typeof aVal === "string" && typeof bVal === "string") {
        const cmp = (aVal || "").localeCompare(bVal || "");
        return contribSortDirection === "asc" ? cmp : -cmp;
      }
      const diff = (Number(aVal) || 0) - (Number(bVal) || 0);
      return contribSortDirection === "asc" ? diff : -diff;
    });
  }, [contributionData, searchQuery, contribSortColumn, contribSortDirection]);

  // Filter + sort RMDs
  const filteredRmds = useMemo(() => {
    const q = searchQuery.toLowerCase();
    const filtered = rmdData.filter((r) =>
      r.account_number.toLowerCase().includes(q) ||
      (r.account_name && r.account_name.toLowerCase().includes(q)) ||
      (r.client_name && r.client_name.toLowerCase().includes(q)) ||
      (r.household_name && r.household_name.toLowerCase().includes(q))
    );
    return [...filtered].sort((a, b) => {
      const aVal = a[rmdSortColumn];
      const bVal = b[rmdSortColumn];
      if (typeof aVal === "string" && typeof bVal === "string") {
        const cmp = (aVal || "").localeCompare(bVal || "");
        return rmdSortDirection === "asc" ? cmp : -cmp;
      }
      const diff = (Number(aVal) || 0) - (Number(bVal) || 0);
      return rmdSortDirection === "asc" ? diff : -diff;
    });
  }, [rmdData, searchQuery, rmdSortColumn, rmdSortDirection]);

  const activeData = activeTab === "contributions" ? filteredContributions : filteredRmds;
  const totalPages = Math.max(1, Math.ceil(activeData.length / ITEMS_PER_PAGE));
  const paginatedData = useMemo(
    () => activeData.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE),
    [activeData, currentPage]
  );

  // Summary stats — contributions (from ALL data, not filtered)
  const totalContribAccounts = contributionData.length;
  const totalYtdContrib = contributionData.reduce((s, r) => s + r.ytd_contributions, 0);
  const maxedCount = contributionData.filter((r) => r.status === "Maxed" || r.status === "Over Limit").length;

  // Summary stats — RMDs (from ALL data)
  const totalRmdAccounts = rmdData.length;
  const totalRmdRequired = rmdData.reduce((s, r) => s + r.rmd_amount, 0);
  const totalDistributed = rmdData.reduce((s, r) => s + r.ytd_distributions, 0);
  const completionRate = totalRmdRequired > 0 ? Math.round((totalDistributed / totalRmdRequired) * 100) : 0;

  // Formatting helpers
  const formatCurrency = (value: number) => {
    if (value >= 1000000000) return `$${(value / 1000000000).toFixed(2)}B`;
    if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
    if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
  };

  const formatCurrencyFull = (value: number) => {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
  };

  const formatAccountType = (type: string) => {
    const types: Record<string, string> = {
      ira: "Traditional IRA", roth_ira: "Roth IRA", sep_ira: "SEP IRA",
      simple_ira: "SIMPLE IRA", k401: "401(k)", k403b: "403(b)", pension: "Pension",
    };
    return types[type] || type;
  };

  // Status badge styling
  const contribStatusClass = (status: ContributionRow["status"]) => {
    if (status === "On Track") return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-500";
    if (status === "Maxed") return "bg-blue-500/10 text-blue-600 dark:text-blue-400";
    return "bg-[#FF2D2D]/10 text-[#FF2D2D]";
  };

  const rmdStatusClass = (status: RmdRow["status"]) => {
    if (status === "Complete") return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-500";
    if (status === "Pending") return "bg-[#F59E0B]/10 text-[#F59E0B]";
    return "bg-[#FF2D2D]/10 text-[#FF2D2D]";
  };

  if (loading) {
    return (
      <div className="flex flex-col h-full min-h-0 bg-background">
        <div className="flex items-center justify-center flex-1">
          <div className="text-muted">Loading retirement data...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col h-full min-h-0 bg-background">
        <div className="flex items-center justify-center flex-1">
          <div className="text-center">
            <div className="text-red-500 dark:text-red-400 mb-2">Connection Error</div>
            <div className="text-sm text-muted max-w-md">{error}</div>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 px-4 py-2 text-sm bg-black dark:bg-white text-white dark:text-black rounded-lg hover:opacity-80 transition-opacity"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (contributionData.length === 0 && rmdData.length === 0) {
    return (
      <div className="flex flex-col h-full min-h-0 bg-background">
        <div className="flex items-center justify-center flex-1">
          <div className="text-center">
            <div className="text-muted mb-2">No retirement accounts found</div>
            <div className="text-sm text-black/40 dark:text-white/40">
              Run the retirement migration to create sample data
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Column definitions
  const contribColumns: { key: ContribSortColumn; label: string; align: string; px: string }[] = [
    { key: "account_number", label: "Account #", align: "left", px: "px-6" },
    { key: "account_name", label: "Account Name", align: "left", px: "px-4" },
    { key: "account_type", label: "Type", align: "left", px: "px-4" },
    { key: "client_name", label: "Client", align: "left", px: "px-4" },
    { key: "age", label: "Age", align: "right", px: "px-4" },
    { key: "custodian", label: "Custodian", align: "left", px: "px-4" },
    { key: "household_name", label: "Household", align: "left", px: "px-4" },
    { key: "ytd_contributions", label: "YTD Contributions", align: "right", px: "px-4" },
    { key: "contribution_limit", label: "Limit", align: "right", px: "px-4" },
    { key: "remaining_allowance", label: "Remaining", align: "right", px: "px-4" },
    { key: "status", label: "Status", align: "center", px: "px-4" },
  ];

  const rmdColumns: { key: RmdSortColumn; label: string; align: string; px: string }[] = [
    { key: "account_number", label: "Account #", align: "left", px: "px-6" },
    { key: "client_name", label: "Client", align: "left", px: "px-4" },
    { key: "age", label: "Age", align: "right", px: "px-4" },
    { key: "custodian", label: "Custodian", align: "left", px: "px-4" },
    { key: "prior_year_end_balance", label: "Prior Year-End Bal", align: "right", px: "px-4" },
    { key: "distribution_period", label: "Dist. Period", align: "right", px: "px-4" },
    { key: "rmd_amount", label: "RMD Amount", align: "right", px: "px-4" },
    { key: "ytd_distributions", label: "YTD Distributed", align: "right", px: "px-4" },
    { key: "remaining_rmd", label: "Remaining", align: "right", px: "px-4" },
    { key: "status", label: "Status", align: "center", px: "px-4" },
  ];

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {/* Header — static block above the scroll container. pt-12 clears the drawer's floating control band. */}
      <div className="px-16 pt-12 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6 pl-6">
            <h1 className="text-lg font-semibold text-black dark:text-white">Retirement Data</h1>
            {/* Search */}
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black/40 dark:text-white/40" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search"
                className="pl-9 pr-4 py-2 bg-black/5 dark:bg-white/5 rounded-lg text-sm text-black dark:text-white placeholder-black/40 dark:placeholder-white/40 outline-none w-64"
              />
            </div>
            {/* Tab toggle */}
            <div className="flex items-center gap-0.5 bg-black/5 dark:bg-white/5 rounded-lg p-1">
              <button
                onClick={() => setActiveTab("contributions")}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  activeTab === "contributions"
                    ? "bg-white dark:bg-black medium:bg-[#e4e4e4] text-black dark:text-white shadow-sm"
                    : "text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white"
                }`}
              >
                Contributions
              </button>
              <button
                onClick={() => setActiveTab("rmds")}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  activeTab === "rmds"
                    ? "bg-white dark:bg-black medium:bg-[#e4e4e4] text-black dark:text-white shadow-sm"
                    : "text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white"
                }`}
              >
                RMDs
              </button>
            </div>
            {/* Summary stats */}
            <div className="flex items-center gap-6 text-sm">
              {activeTab === "contributions" ? (
                <>
                  <div>
                    <span className="text-black/50 dark:text-white/50">Total Accounts:</span>{" "}
                    <span className="font-semibold text-black dark:text-white">{totalContribAccounts}</span>
                  </div>
                  <div>
                    <span className="text-black/50 dark:text-white/50">YTD Contributions:</span>{" "}
                    <span className="font-semibold text-black dark:text-white">{formatCurrency(totalYtdContrib)}</span>
                  </div>
                  <div>
                    <span className="text-black/50 dark:text-white/50">Maxed Out:</span>{" "}
                    <span className="font-semibold text-black dark:text-white">{maxedCount}</span>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <span className="text-black/50 dark:text-white/50">RMD Accounts:</span>{" "}
                    <span className="font-semibold text-black dark:text-white">{totalRmdAccounts}</span>
                  </div>
                  <div>
                    <span className="text-black/50 dark:text-white/50">Total Required:</span>{" "}
                    <span className="font-semibold text-black dark:text-white">{formatCurrency(totalRmdRequired)}</span>
                  </div>
                  <div>
                    <span className="text-black/50 dark:text-white/50">Total Distributed:</span>{" "}
                    <span className="font-semibold text-black dark:text-white">{formatCurrency(totalDistributed)}</span>
                  </div>
                  <div>
                    <span className="text-black/50 dark:text-white/50">Completion:</span>{" "}
                    <span className="font-semibold text-black dark:text-white">{completionRate}%</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Scroll container — table only. Top spacing on the table (mt-8), not the scroller,
          so the sticky thead pins just below the header. */}
      <div className="flex-1 overflow-y-auto px-16 pb-8">
        <div className="mt-8">
          {activeTab === "contributions" ? (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-black/5 dark:border-white/5 bg-white dark:bg-[#0a0a0a] medium:bg-[#bcbcbc]">
                  {contribColumns.map((col) => (
                    <th
                      key={col.key}
                      onClick={(e) => { e.stopPropagation(); handleContribSort(col.key); }}
                      className={`text-${col.align} ${col.px} py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer select-none hover:text-black dark:hover:text-white transition-colors whitespace-nowrap`}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(paginatedData as ContributionRow[]).map((row) => (
                  <tr
                    key={row.account_id}
                    className="border-b border-black/5 dark:border-white/5 transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
                  >
                    <td className="px-6 py-4">
                      <Link href={canvasHref(`/accounts/portfolio?account=${row.account_number}`)} className="font-semibold text-black dark:text-white cursor-pointer">{row.account_number}</Link>
                    </td>
                    <td className="px-4 py-4 text-black/50 dark:text-white/50 whitespace-nowrap">{row.account_name || "—"}</td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <span className="font-medium text-black dark:text-white">
                        {formatAccountType(row.account_type)}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-black/50 dark:text-white/50 whitespace-nowrap">{row.client_name}</td>
                    <td className="px-4 py-4 text-right text-black/50 dark:text-white/50">{row.age}</td>
                    <td className="px-4 py-4 text-black/50 dark:text-white/50">{row.custodian}</td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      {row.household_id ? (
                        <Link href={canvasHref(`/accounts/households?household=${row.household_id}`)} className="text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white hover:underline transition-colors">
                          {row.household_name}
                        </Link>
                      ) : (
                        <span className="text-black/50 dark:text-white/50">—</span>
                      )}
                    </td>
                    <td className="px-4 py-4 text-right font-medium text-black dark:text-white">{formatCurrencyFull(row.ytd_contributions)}</td>
                    <td className="px-4 py-4 text-right text-black/50 dark:text-white/50">{formatCurrencyFull(row.contribution_limit)}</td>
                    <td className="px-4 py-4 text-right text-black/50 dark:text-white/50">{formatCurrencyFull(row.remaining_allowance)}</td>
                    <td className="px-4 py-4 text-center whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${contribStatusClass(row.status)}`}>
                        {row.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-black/5 dark:border-white/5 bg-white dark:bg-[#0a0a0a] medium:bg-[#bcbcbc]">
                  {rmdColumns.map((col) => (
                    <th
                      key={col.key}
                      onClick={(e) => { e.stopPropagation(); handleRmdSort(col.key); }}
                      className={`text-${col.align} ${col.px} py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider cursor-pointer select-none hover:text-black dark:hover:text-white transition-colors whitespace-nowrap`}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(paginatedData as RmdRow[]).map((row) => (
                  <tr
                    key={row.account_id}
                    className="border-b border-black/5 dark:border-white/5 transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
                  >
                    <td className="px-6 py-4">
                      <Link href={canvasHref(`/accounts/portfolio?account=${row.account_number}`)} className="font-semibold text-black dark:text-white cursor-pointer">{row.account_number}</Link>
                    </td>
                    <td className="px-4 py-4 text-black/50 dark:text-white/50 whitespace-nowrap">{row.client_name}</td>
                    <td className="px-4 py-4 text-right text-black/50 dark:text-white/50">{row.age}</td>
                    <td className="px-4 py-4 text-black/50 dark:text-white/50">{row.custodian}</td>
                    <td className="px-4 py-4 text-right font-medium text-black dark:text-white">{formatCurrencyFull(row.prior_year_end_balance)}</td>
                    <td className="px-4 py-4 text-right text-black/50 dark:text-white/50">{row.distribution_period.toFixed(1)}</td>
                    <td className="px-4 py-4 text-right font-medium text-black dark:text-white">{formatCurrencyFull(row.rmd_amount)}</td>
                    <td className="px-4 py-4 text-right text-black/50 dark:text-white/50">{formatCurrencyFull(row.ytd_distributions)}</td>
                    <td className="px-4 py-4 text-right text-black/50 dark:text-white/50">{formatCurrencyFull(row.remaining_rmd)}</td>
                    <td className="px-4 py-4 text-center whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${rmdStatusClass(row.status)}`}>
                        {row.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {activeData.length === 0 && (
            <div className="py-12 text-center text-black/40 dark:text-white/40 text-sm">
              {searchQuery ? "No accounts match your search" : `No ${activeTab === "contributions" ? "contribution" : "RMD"} accounts found`}
            </div>
          )}

          {/* Pagination */}
          {activeData.length > ITEMS_PER_PAGE && totalPages > 1 && (() => {
            const VISIBLE = 5;
            let windowStart = Math.max(1, currentPage - Math.floor(VISIBLE / 2));
            const windowEnd = Math.min(totalPages, windowStart + VISIBLE - 1);
            if (windowEnd - windowStart + 1 < VISIBLE) {
              windowStart = Math.max(1, windowEnd - VISIBLE + 1);
            }
            const visiblePages = Array.from({ length: windowEnd - windowStart + 1 }, (_, i) => windowStart + i);

            return (
              <div className="flex items-center justify-between mt-8 pt-6 border-t border-black/5 dark:border-white/5">
                <span className="text-xs text-black/40 dark:text-white/40 tabular-nums">
                  {((currentPage - 1) * ITEMS_PER_PAGE) + 1}–{Math.min(currentPage * ITEMS_PER_PAGE, activeData.length)} of {activeData.length}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="px-2 py-1 rounded-md text-xs text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
                  </button>
                  <div className="flex items-center gap-1 overflow-hidden">
                    {visiblePages.map((page) => (
                      <button
                        key={page}
                        onClick={() => setCurrentPage(page)}
                        className={`w-7 h-7 rounded-md text-xs font-medium transition-all duration-200 ${
                          currentPage === page
                            ? "bg-black/[0.07] dark:bg-white/[0.07] text-black dark:text-white"
                            : "text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white"
                        }`}
                      >
                        {page}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="px-2 py-1 rounded-md text-xs text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

// Icons
function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
    </svg>
  );
}
