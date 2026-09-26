"use client";

import { Suspense, useState, useMemo, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { paginateQuery } from "@/lib/supabase-paginate";
import { useMarketSnapshot } from "@/lib/market/useMarketSnapshot";
import MarketStatusPill from "@/components/market/MarketStatusPill";
import { exportToCsv, formatCurrency } from "@/lib/format-utils";
import AdvisoryFeesTable from "@/components/billing/AdvisoryFeesTable";
import CommissionsTable from "@/components/billing/CommissionsTable";
import SalesCreditsTable from "@/components/billing/SalesCreditsTable";
import OutsideBusinessTable from "@/components/billing/OutsideBusinessTable";
import RevenueBreakdownChart from "@/components/billing/RevenueBreakdownChart";
import MonthlyTrendChart from "@/components/billing/MonthlyTrendChart";
import { DownloadIcon } from "@/components/billing/icons";
import type {
  AdvisoryFeeRow,
  CommissionRow,
  SalesCreditRow,
  OutsideBusinessRow,
  RevenueSlice,
  MonthBucket,
  BillingTab,
} from "@/components/billing/types";

type BillingPeriod = "mtd" | "qtd" | "ytd" | "t12";

type ManagedAccount = Omit<AdvisoryFeeRow, "fee_amount">;

type ExpenseRow = {
  category: string;
  amount: number;
  period_month: number;
  period_year: number;
};

const PERIOD_LABELS: Record<BillingPeriod, string> = {
  mtd: "MTD",
  qtd: "QTD",
  ytd: "YTD",
  t12: "T-12",
};

const TAB_LABELS: Record<BillingTab, string> = {
  advisory: "Advisory Fees",
  commissions: "Commissions",
  credits: "Sales Credits",
  outside: "Outside Business",
};

// Local date formatting — toISOString() shifts to UTC and can roll the day.
function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export default function BillingPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-full"><div className="text-muted">Loading billing...</div></div>}>
      <BillingContent />
    </Suspense>
  );
}

function BillingContent() {
  const [rawManaged, setManaged] = useState<ManagedAccount[]>([]);
  const [commissions, setCommissions] = useState<CommissionRow[]>([]);
  const [credits, setCredits] = useState<SalesCreditRow[]>([]);
  const [outside, setOutside] = useState<OutsideBusinessRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<BillingPeriod>("qtd");
  const [activeTab, setActiveTab] = useState<BillingTab>("advisory");

  // AUM only. Commissions, sales credits and outside business are historical
  // booked revenue for a closed period — those are facts and must not tick.
  const { accounts: accountValues, status: marketStatus, asOf, degraded } =
    useMarketSnapshot({ includeAccounts: true });

  const managed = useMemo(
    () =>
      rawManaged.map((m) => {
        const v = accountValues[m.id];
        return v ? { ...m, aum: v.totalValue } : m;
      }),
    [rawManaged, accountValues],
  );

  // Sorted rows registered by the active table so Export CSV matches what's on screen
  const advisoryExportRef = useRef<AdvisoryFeeRow[]>([]);
  const commissionsExportRef = useRef<CommissionRow[]>([]);
  const creditsExportRef = useRef<SalesCreditRow[]>([]);
  const outsideExportRef = useRef<OutsideBusinessRow[]>([]);

  useEffect(() => {
    async function fetchBillingData() {
      const now = new Date();
      // Covers both the 12-month trend window and the T-12 period filter
      const fetchStart = toIsoDate(new Date(now.getFullYear() - 1, now.getMonth(), 1));

      const [managedRows, commissionRows, creditsRes, outsideRes, expensesRes] = await Promise.all([
        paginateQuery<Record<string, unknown>>((from, to) =>
          supabase
            .from("portfolio_accounts")
            .select("id, account_number, account_name, household_id, household_name, rep_code, custodian, total_value, cash_balance, fee_rate")
            .eq("is_managed", true)
            .gt("fee_rate", 0)
            .order("total_value", { ascending: false })
            .order("id", { ascending: true })
            .range(from, to)
        ),
        paginateQuery<Record<string, unknown>>((from, to) =>
          supabase
            .from("commissions")
            .select("id, trade_date, account_number, account_name, symbol, security_name, side, quantity, price, gross_amount, total_commission")
            .gte("trade_date", fetchStart)
            .order("trade_date", { ascending: false })
            .order("id", { ascending: true })
            .range(from, to)
        ),
        supabase.from("sales_credits").select("*").order("period_start", { ascending: false }),
        supabase.from("outside_business_activities").select("*").order("date_received", { ascending: false }),
        supabase.from("house_account_expenses").select("category, amount, period_month, period_year"),
      ]);

      // paginateQuery swallows errors (returns []), so the error branch is driven
      // by the three plain queries — enough to catch a dead connection.
      const fetchError = creditsRes.error || outsideRes.error || expensesRes.error;
      if (fetchError) {
        console.error("Error fetching billing data:", fetchError.message);
        setError("Unable to connect to database. Please check your connection.");
        setLoading(false);
        return;
      }

      setManaged(
        managedRows.map((row) => ({
          id: row.id as string,
          account_number: (row.account_number as string) ?? "",
          account_name: (row.account_name as string) ?? "",
          household_id: (row.household_id as string) ?? null,
          household_name: (row.household_name as string) ?? "—",
          rep_code: (row.rep_code as string) ?? "—",
          custodian: (row.custodian as string) ?? "—",
          cash_balance: Number(row.cash_balance) || 0,
          aum: Number(row.total_value) || 0,
          fee_rate: Number(row.fee_rate) || 0,
        }))
      );
      setCommissions(
        commissionRows.map((row) => ({
          id: String(row.id),
          account_number: (row.account_number as string) ?? "",
          account_name: (row.account_name as string) ?? "",
          symbol: (row.symbol as string) ?? "",
          security_name: (row.security_name as string) ?? "",
          side: (row.side as string) ?? "",
          quantity: Number(row.quantity) || 0,
          price: Number(row.price) || 0,
          gross_amount: Number(row.gross_amount) || 0,
          total_commission: Number(row.total_commission) || 0,
          trade_date: ((row.trade_date as string) ?? "").slice(0, 10),
        }))
      );
      setCredits(
        (creditsRes.data ?? []).map((row) => ({
          id: row.id as string,
          account_number: (row.account_number as string) ?? "",
          credit_type: (row.credit_type as string) ?? "",
          source: (row.source as string) ?? "",
          fund_symbol: (row.fund_symbol as string) ?? null,
          period: (row.period as string) ?? "",
          period_start: ((row.period_start as string) ?? "").slice(0, 10),
          period_end: ((row.period_end as string) ?? "").slice(0, 10),
          assets_basis: Number(row.assets_basis) || 0,
          credit_rate: Number(row.credit_rate) || 0,
          credit_amount: Number(row.credit_amount) || 0,
          status: (row.status as string) ?? "pending",
        }))
      );
      setOutside(
        (outsideRes.data ?? []).map((row) => ({
          id: row.id as string,
          activity_type: (row.activity_type as string) ?? "",
          description: (row.description as string) ?? "",
          client_name: (row.client_name as string) ?? null,
          income_type: (row.income_type as string) ?? "",
          gross_income: Number(row.gross_income) || 0,
          expenses: Number(row.expenses) || 0,
          net_income: Number(row.net_income) || 0,
          date_received: ((row.date_received as string) ?? "").slice(0, 10),
          approval_status: (row.approval_status as string) ?? "pending",
        }))
      );
      setExpenses(
        (expensesRes.data ?? []).map((row) => ({
          category: (row.category as string) ?? "",
          amount: Number(row.amount) || 0,
          period_month: Number(row.period_month) || 0,
          period_year: Number(row.period_year) || 0,
        }))
      );
      setLoading(false);
    }

    fetchBillingData();
  }, []);

  // Period window: start date + fraction of a year elapsed (in months) used to
  // prorate annual advisory fees (fee = aum × rate × months / 12).
  const periodDates = useMemo(() => {
    const now = new Date();
    let start: Date;
    let months: number;

    if (period === "mtd") {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      months = now.getDate() / daysInMonth;
    } else if (period === "qtd") {
      const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
      start = new Date(now.getFullYear(), quarterStartMonth, 1);
      const quarterEnd = new Date(now.getFullYear(), quarterStartMonth + 3, 0);
      const totalDays = Math.round((quarterEnd.getTime() - start.getTime()) / 86400000) + 1;
      const elapsedDays = Math.floor((now.getTime() - start.getTime()) / 86400000) + 1;
      months = 3 * (elapsedDays / totalDays);
    } else if (period === "ytd") {
      start = new Date(now.getFullYear(), 0, 1);
      const yearEnd = new Date(now.getFullYear(), 11, 31);
      const daysInYear = Math.round((yearEnd.getTime() - start.getTime()) / 86400000) + 1;
      const dayOfYear = Math.floor((now.getTime() - start.getTime()) / 86400000) + 1;
      months = 12 * (dayOfYear / daysInYear);
    } else {
      start = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
      months = 12;
    }

    return { startIso: toIsoDate(start), todayIso: toIsoDate(now), months };
  }, [period]);

  const advisoryRows: AdvisoryFeeRow[] = useMemo(
    () =>
      managed.map((m) => ({
        ...m,
        fee_amount: (m.aum * m.fee_rate * periodDates.months) / 12,
      })),
    [managed, periodDates]
  );

  // Upper bound matters: some seeded transactions carry future dates
  const filteredCommissions = useMemo(
    () => commissions.filter((c) => c.trade_date >= periodDates.startIso && c.trade_date <= periodDates.todayIso),
    [commissions, periodDates]
  );

  // A credit belongs to the period when its accrual window overlaps it
  const filteredCredits = useMemo(
    () => credits.filter((c) => c.period_end >= periodDates.startIso && c.period_start <= periodDates.todayIso),
    [credits, periodDates]
  );

  const filteredOutside = useMemo(
    () => outside.filter((o) => o.date_received >= periodDates.startIso && o.date_received <= periodDates.todayIso),
    [outside, periodDates]
  );

  const stats = useMemo(() => {
    const totalAUM = managed.reduce((sum, m) => sum + m.aum, 0);
    const advisoryTotal = advisoryRows.reduce((sum, r) => sum + r.fee_amount, 0);
    const commissionsTotal = filteredCommissions.reduce((sum, c) => sum + c.total_commission, 0);
    const creditsTotal = filteredCredits
      .filter((c) => c.status === "received")
      .reduce((sum, c) => sum + c.credit_amount, 0);
    const outsideTotal = filteredOutside.reduce((sum, o) => sum + o.net_income, 0);
    const households = new Set(managed.map((m) => m.household_id).filter(Boolean)).size;
    return {
      totalAUM,
      advisoryTotal,
      commissionsTotal,
      creditsTotal,
      outsideTotal,
      revenue: advisoryTotal + commissionsTotal + creditsTotal + outsideTotal,
      households,
    };
  }, [managed, advisoryRows, filteredCommissions, filteredCredits, filteredOutside]);

  const revenueSlices: RevenueSlice[] = useMemo(
    () => [
      { key: "advisory", label: "Advisory Fees", value: stats.advisoryTotal, color: "#3B82F6" },
      { key: "commissions", label: "Commissions", value: stats.commissionsTotal, color: "#10B981" },
      { key: "credits", label: "Sales Credits", value: stats.creditsTotal, color: "#F59E0B" },
      { key: "outside", label: "Outside Business", value: stats.outsideTotal, color: "#6B7280" },
    ],
    [stats]
  );

  // Trailing 12 calendar months of stored data (independent of the period toggle)
  const monthBuckets: MonthBucket[] = useMemo(() => {
    const now = new Date();
    const todayIso = toIsoDate(now);
    const buckets: MonthBucket[] = [];
    const byKey = new Map<string, MonthBucket>();
    for (let back = 11; back >= 0; back--) {
      const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
      const bucket: MonthBucket = {
        key: monthKey(d.getFullYear(), d.getMonth() + 1),
        label: d.toLocaleDateString("en-US", { month: "short" }),
        year: d.getFullYear(),
        commissions: 0,
        salesCredits: 0,
        expenses: 0,
        net: 0,
        partial: back === 0,
      };
      buckets.push(bucket);
      byKey.set(bucket.key, bucket);
    }

    for (const c of commissions) {
      // Skip future-dated seed trades so the current-month bar matches the MTD stats
      if (c.trade_date > todayIso) continue;
      const bucket = byKey.get(c.trade_date.slice(0, 7));
      if (bucket) bucket.commissions += c.total_commission;
    }

    // Spread each received credit evenly across the calendar months of its period
    for (const cr of credits) {
      if (cr.status !== "received" || !cr.period_start || !cr.period_end) continue;
      const start = new Date(`${cr.period_start}T00:00:00`);
      const end = new Date(`${cr.period_end}T00:00:00`);
      const keys: string[] = [];
      const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
      while (cursor <= end) {
        keys.push(monthKey(cursor.getFullYear(), cursor.getMonth() + 1));
        cursor.setMonth(cursor.getMonth() + 1);
      }
      const perMonth = cr.credit_amount / Math.max(1, keys.length);
      for (const key of keys) {
        const bucket = byKey.get(key);
        if (bucket) bucket.salesCredits += perMonth;
      }
    }

    for (const e of expenses) {
      const bucket = byKey.get(monthKey(e.period_year, e.period_month));
      if (bucket) bucket.expenses += e.amount;
    }

    for (const bucket of buckets) {
      bucket.net = bucket.commissions + bucket.salesCredits - bucket.expenses;
    }
    return buckets;
  }, [commissions, credits, expenses]);

  const handleExport = () => {
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `billing-${activeTab}-${period}-${dateStr}.csv`;

    // Keys are chosen so formatValue()'s heuristics apply the right formatting
    // (…_balance/…_value/…_amount → currency, …_pct → percent, …date… → date).
    if (activeTab === "advisory") {
      exportToCsv(
        advisoryExportRef.current.map((r) => ({
          account_number: r.account_number,
          household: r.household_name,
          rep_code: r.rep_code,
          custodian: r.custodian,
          cash_balance: r.cash_balance,
          aum_value: r.aum,
          fee_rate_pct: r.fee_rate * 100,
          fee_amount: r.fee_amount,
        })),
        ["account_number", "household", "rep_code", "custodian", "cash_balance", "aum_value", "fee_rate_pct", "fee_amount"],
        filename
      );
    } else if (activeTab === "commissions") {
      exportToCsv(
        commissionsExportRef.current.map((r) => ({
          account_number: r.account_number,
          symbol: r.symbol,
          security_name: r.security_name,
          side: r.side,
          quantity: r.quantity,
          price: r.price,
          gross_amount: r.gross_amount,
          commission_amount: r.total_commission,
          trade_date: r.trade_date,
        })),
        ["account_number", "symbol", "security_name", "side", "quantity", "price", "gross_amount", "commission_amount", "trade_date"],
        filename
      );
    } else if (activeTab === "credits") {
      exportToCsv(
        creditsExportRef.current.map((r) => ({
          account_number: r.account_number,
          credit_type: r.credit_type,
          source: r.source,
          fund_symbol: r.fund_symbol ?? "",
          period: r.period,
          basis_amount: r.assets_basis,
          credit_rate_bps: Math.round(r.credit_rate * 10000),
          credit_amount: r.credit_amount,
          status: r.status,
        })),
        ["account_number", "credit_type", "source", "fund_symbol", "period", "basis_amount", "credit_rate_bps", "credit_amount", "status"],
        filename
      );
    } else {
      exportToCsv(
        outsideExportRef.current.map((r) => ({
          activity_type: r.activity_type,
          description: r.description,
          client_name: r.client_name ?? "",
          income_type: r.income_type,
          gross_amount: r.gross_income,
          expenses_amount: r.expenses,
          net_amount: r.net_income,
          date_received: r.date_received,
          approval_status: r.approval_status,
        })),
        ["activity_type", "description", "client_name", "income_type", "gross_amount", "expenses_amount", "net_amount", "date_received", "approval_status"],
        filename
      );
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col h-full min-h-0 bg-background">
        <div className="flex items-center justify-center flex-1">
          <div className="text-muted">Loading billing data...</div>
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

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {/* Header — static block above the scroll container */}
      <div className="px-16 pt-12 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6 pl-6">
            <h1 className="text-lg font-semibold text-black dark:text-white">Billing</h1>
            <MarketStatusPill status={marketStatus} degraded={degraded} asOf={asOf} />
            <div className="flex items-center gap-6 text-sm">
              <div>
                <span className="text-black/50 dark:text-white/50">Total AUM:</span>{" "}
                <span className="font-semibold text-black dark:text-white">{formatCurrency(stats.totalAUM)}</span>
              </div>
              <div>
                <span className="text-black/50 dark:text-white/50">Revenue ({PERIOD_LABELS[period]}):</span>{" "}
                <span className="font-semibold text-black dark:text-white">{formatCurrency(stats.revenue)}</span>
              </div>
              <div>
                <span className="text-black/50 dark:text-white/50">Accounts:</span>{" "}
                <span className="font-semibold text-black dark:text-white">{advisoryRows.length.toLocaleString()}</span>
              </div>
              <div>
                <span className="text-black/50 dark:text-white/50">Households:</span>{" "}
                <span className="font-semibold text-black dark:text-white">{stats.households.toLocaleString()}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-0.5 bg-black/5 dark:bg-white/5 rounded-lg p-1 mr-6">
            {(["mtd", "qtd", "ytd", "t12"] as BillingPeriod[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  period === p
                    ? "bg-white dark:bg-black medium:bg-[#e4e4e4] text-black dark:text-white shadow-sm"
                    : "text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white"
                }`}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Top spacing lives on the first child (mt-8), not the scroller (py-8):
          padding-top on the scroll container offsets the sticky-thead pin point,
          leaving a strip above the pinned table headers where rows show through. */}
      <div className="flex-1 overflow-y-auto px-16 pb-8">
        <div className="mt-8 grid grid-cols-2 gap-8">
          <div className="rounded-xl border border-black/5 dark:border-white/5 p-6 overflow-hidden">
            <div className="text-xs font-semibold text-black dark:text-white uppercase tracking-wider mb-4">
              Revenue Breakdown ({PERIOD_LABELS[period]})
            </div>
            <RevenueBreakdownChart slices={revenueSlices} />
          </div>
          <div className="rounded-xl border border-black/5 dark:border-white/5 p-6">
            <div className="text-xs font-semibold text-black dark:text-white uppercase tracking-wider mb-4">
              Monthly Revenue Trend
            </div>
            <MonthlyTrendChart months={monthBuckets} />
          </div>
        </div>

        <div className="mt-10 px-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {(Object.keys(TAB_LABELS) as BillingTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`text-xs font-semibold uppercase tracking-wider transition-colors ${
                  activeTab === tab
                    ? "text-black dark:text-white"
                    : "text-black/40 dark:text-white/40 hover:text-black/60 dark:hover:text-white/60"
                }`}
              >
                {TAB_LABELS[tab]}
              </button>
            ))}
          </div>
          <button
            onClick={handleExport}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white transition-colors"
          >
            <DownloadIcon className="w-3.5 h-3.5" />
            Export CSV
          </button>
        </div>

        {activeTab === "advisory" && <AdvisoryFeesTable rows={advisoryRows} exportRef={advisoryExportRef} />}
        {activeTab === "commissions" && <CommissionsTable rows={filteredCommissions} exportRef={commissionsExportRef} />}
        {activeTab === "credits" && <SalesCreditsTable rows={filteredCredits} exportRef={creditsExportRef} />}
        {activeTab === "outside" && <OutsideBusinessTable rows={filteredOutside} exportRef={outsideExportRef} />}
      </div>
    </div>
  );
}
