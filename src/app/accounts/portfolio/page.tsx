"use client";

import { Suspense, useState, useEffect, useMemo, useCallback } from "react";
import { useMarketSnapshot } from "@/lib/market/useMarketSnapshot";
import { applyAccountValues, reviveHoldings } from "@/lib/market/apply";
import MarketStatusPill from "@/components/market/MarketStatusPill";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import PortfolioHeader from "@/components/portfolio/PortfolioHeader";
import AccountDetails from "@/components/portfolio/AccountDetails";
import AccountSummary from "@/components/portfolio/AccountSummary";
import HoldingsTable from "@/components/portfolio/HoldingsTable";
import GainsTable from "@/components/portfolio/GainsTable";
import CostBasisTable from "@/components/portfolio/CostBasisTable";
import BalanceDetails from "@/components/portfolio/BalanceDetails";
import AllocationChart from "@/components/portfolio/AllocationChart";
import TransactionHistory from "@/components/portfolio/TransactionHistory";
import { type PortfolioAccount, type Holding, type AccountBalance, type SellTransaction } from "@/components/portfolio/types";

export default function PortfolioPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-full"><div className="text-muted">Loading portfolio...</div></div>}>
      <PortfolioPageContent />
    </Suspense>
  );
}

function PortfolioPageContent() {
  const searchParams = useSearchParams();
  const accountNumberParam = searchParams.get("account");

  // Raw rows as they come back from Supabase. The live values the page
  // actually renders are derived from these plus the market snapshot below.
  const [rawAccounts, setAccounts] = useState<PortfolioAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [rawHoldings, setHoldings] = useState<Holding[]>([]);
  const [rawHouseholdHoldings, setHouseholdHoldings] = useState<Holding[]>([]);
  const [balanceData, setBalanceData] = useState<AccountBalance | null>(null);
  const [sellTransactions, setSellTransactions] = useState<SellTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Account Details vs Client Details toggle
  const [detailsView, setDetailsView] = useState<"account" | "client">("account");

  // Holdings / Balance Details / Unrealized / Realized / Cost Basis toggle
  const [activeView, setActiveView] = useState<"holdings" | "balance" | "unrealized" | "realized" | "cost_basis">("holdings");

  // Asset allocation selected class (lifted from AllocationChart)
  const [selectedAssetClass, setSelectedAssetClass] = useState<string | null>(null);

  // Household view toggle (switches portfolio value / allocation to household-level)
  const [isHouseholdView, setIsHouseholdView] = useState(false);

  // Live market data. Status, quotes and per-account totals all come from the
  // server, so this page cannot disagree with /accounts/holdings, /cash,
  // /households or /billing about the same account.
  const liveAccountIds = useMemo(
    () => (selectedAccountId ? [selectedAccountId] : []),
    [selectedAccountId],
  );
  const { quotes, accounts: accountValues, status: marketStatus, asOf, degraded } =
    useMarketSnapshot({ includeAccounts: true, accountIds: liveAccountIds });

  const holdings = useMemo(() => reviveHoldings(rawHoldings, quotes), [rawHoldings, quotes]);
  const householdHoldings = useMemo(
    // The household toggle previously had no quote fetch at all and silently
    // reverted to stale snapshot values.
    () => reviveHoldings(rawHouseholdHoldings, quotes),
    [rawHouseholdHoldings, quotes],
  );
  const accounts = useMemo(
    () => applyAccountValues(rawAccounts, accountValues),
    [rawAccounts, accountValues],
  );

  // Download export handler
  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) || null;

  // Notify parent frame when account changes (for canvas/studio mode)
  const isInsideCanvas = searchParams.get("canvas") === "true";
  useEffect(() => {
    if (!isInsideCanvas || !selectedAccount) return;
    window.parent.postMessage({
      type: "composer:canvas:accountSelected",
      accountNumber: selectedAccount.account_number,
      accountId: selectedAccount.id,
      accountName: selectedAccount.account_name,
    }, "*");
  }, [isInsideCanvas, selectedAccount?.id, selectedAccount?.account_number, selectedAccount?.account_name]);

  // Get household accounts (accounts in the same household as selected account)
  const householdAccounts = selectedAccount?.household_id
    ? accounts.filter((a) => a.household_id === selectedAccount.household_id)
    : selectedAccount
    ? [selectedAccount]
    : [];

  // Holdings with a synthetic cash row appended (so cash shows in the table)
  const holdingsWithCash = useMemo(() => {
    // Filter out any DB-seeded CASH rows to avoid duplicates
    const nonCash = holdings.filter((h) => h.symbol !== "CASH");
    if (!selectedAccount || selectedAccount.cash_balance <= 0) return nonCash;
    const cashHolding: Holding = {
      id: `${selectedAccount.id}-cash`,
      account_id: selectedAccount.id,
      symbol: "CASH",
      name: "Cash & Cash Equivalents",
      quantity: selectedAccount.cash_balance,
      price: 1,
      market_value: selectedAccount.cash_balance,
      cost_basis: selectedAccount.cash_balance,
      day_change: 0,
      day_change_pct: 0,
      asset_class: "cash",
      created_at: selectedAccount.created_at,
      updated_at: selectedAccount.updated_at,
    };
    return [...nonCash, cashHolding];
  }, [holdings, selectedAccount]);

  // Aggregated household holdings — merge by symbol across all household accounts
  const householdHoldingsWithCash = useMemo(() => {
    if (householdHoldings.length === 0) return [];
    const map = new Map<string, Holding>();
    // Filter out DB-seeded CASH rows — synthetic cash is added below from account balances
    for (const h of householdHoldings.filter((h) => h.symbol !== "CASH")) {
      const existing = map.get(h.symbol);
      if (existing) {
        existing.quantity += h.quantity;
        existing.market_value += h.market_value;
        existing.cost_basis = (existing.cost_basis ?? 0) + (h.cost_basis ?? 0);
        existing.day_change += h.day_change;
      } else {
        map.set(h.symbol, { ...h, cost_basis: h.cost_basis ?? 0 });
      }
    }
    // Recalculate price (weighted avg) and day_change_pct for each merged holding
    for (const h of map.values()) {
      h.price = h.quantity > 0 ? h.market_value / h.quantity : 0;
      h.day_change_pct = h.market_value > 0 ? (h.day_change / (h.market_value - h.day_change)) * 100 : 0;
    }
    const result = [...map.values()];
    // Add household-level cash
    const totalHouseholdCash = householdAccounts.reduce((sum, a) => sum + a.cash_balance, 0);
    if (totalHouseholdCash > 0) {
      result.push({
        id: "household-cash",
        account_id: "",
        symbol: "CASH",
        name: "Cash & Cash Equivalents",
        quantity: totalHouseholdCash,
        price: 1,
        market_value: totalHouseholdCash,
        cost_basis: totalHouseholdCash,
        day_change: 0,
        day_change_pct: 0,
        asset_class: "cash",
        created_at: "",
        updated_at: "",
      });
    }
    return result;
  }, [householdHoldings, householdAccounts]);

  // Fetch accounts (paginated to avoid Supabase 1000-row limit)
  useEffect(() => {
    async function fetchAccounts() {
      const BATCH = 1000;
      const allRows: any[] = [];
      let from = 0;

      while (true) {
        const { data, error: fetchErr } = await supabase
          .from("portfolio_accounts")
          .select("*")
          .order("account_name")
          .range(from, from + BATCH - 1);

        if (fetchErr) {
          console.error("Error fetching accounts:", fetchErr.message);
          setError("Unable to connect to database. Please check your connection.");
          setLoading(false);
          return;
        }

        allRows.push(...(data ?? []));
        if (!data || data.length < BATCH) break;
        from += BATCH;
      }

      const mapped: PortfolioAccount[] = allRows.map((row) => ({
        id: row.id,
        account_number: row.account_number,
        account_name: row.account_name,
        account_type: row.account_type,
        custodian: row.custodian,
        total_value: Number(row.total_value),
        cash_balance: Number(row.cash_balance),
        day_change: Number(row.day_change),
        day_change_pct: Number(row.day_change_pct),
        model_portfolio_id: row.model_portfolio_id || null,
        model_name: row.model_name || null,
        is_managed: row.is_managed ?? true,
        rep_code: row.rep_code || null,
        created_at: row.created_at,
        updated_at: row.updated_at,
        // Extended fields (may be null if not in view)
        client_name: row.client_name || null,
        firm_name: row.firm_name || null,
        household_name: row.household_name || null,
        household_id: row.household_id || null,
        date_of_birth: row.date_of_birth || null,
        ssn: row.ssn || null,
        legal_address: row.legal_address || null,
        city: row.city || null,
        state: row.state || null,
        zip_code: row.zip_code || null,
        annual_income: row.annual_income ? Number(row.annual_income) : null,
        net_worth: row.net_worth ? Number(row.net_worth) : null,
        risk_tolerance: row.risk_tolerance || null,
        investment_objective: row.investment_objective || null,
        time_horizon: row.time_horizon || null,
        fee_schedule: row.fee_schedule || null,
        fee_rate: Number(row.fee_rate) || 0,
        billing_frequency: row.billing_frequency || null,
      }));

      setAccounts(mapped);

      // If account number is in URL, find and select that account
      if (accountNumberParam) {
        const matchingAccount = mapped.find(
          (a) => a.account_number === accountNumberParam
        );
        if (matchingAccount) {
          setSelectedAccountId(matchingAccount.id);
        } else if (mapped.length > 0 && !selectedAccountId) {
          setSelectedAccountId(mapped[0].id);
        }
      } else if (mapped.length > 0 && !selectedAccountId) {
        setSelectedAccountId(mapped[0].id);
      }
      setLoading(false);
    }

    fetchAccounts();
  }, [accountNumberParam]);

  // Fetch holdings for selected account
  useEffect(() => {
    setSelectedAssetClass(null);
    setIsHouseholdView(false);
    // Reset to holdings if switching to a non-taxable account while on a gains tab
    const account = accounts.find((a) => a.id === selectedAccountId);
    if ((activeView === "unrealized" || activeView === "realized" || activeView === "cost_basis") && account && !["individual", "joint", "trust", "ira", "roth_ira"].includes(account.account_type)) {
      setActiveView("holdings");
    }
    if (!selectedAccountId) {
      setHoldings([]);
      setSellTransactions([]);
      return;
    }

    let disposed = false;

    async function fetchHoldingsAndSells() {
      const [holdingsRes, sellsRes] = await Promise.all([
        supabase
          .from("holdings_enriched")
          .select("*")
          .eq("accountId", selectedAccountId)
          .order("marketValue", { ascending: false }),
        supabase
          .from("account_transactions")
          .select("id, date, symbol, name, quantity, price, amount")
          .eq("account_id", selectedAccountId)
          .eq("type", "sell")
          .order("date", { ascending: false }),
      ]);

      if (holdingsRes.error) {
        console.error("Error fetching holdings:", holdingsRes.error.message);
        return;
      }

      const mapped: Holding[] = (holdingsRes.data ?? []).map((row) => ({
        id: row.id,
        account_id: row.account_id || row.accountId,
        symbol: row.symbol,
        name: row.name,
        quantity: Number(row.quantity),
        price: Number(row.price),
        market_value: Number(row.market_value || row.marketValue),
        cost_basis: row.cost_basis || row.costBasis ? Number(row.cost_basis || row.costBasis) : null,
        day_change: Number(row.day_change) || 0,
        day_change_pct: Number(row.day_change_pct) || 0,
        asset_class: row.asset_class || row.assetClass,
        created_at: row.created_at || row.createdAt,
        updated_at: row.updated_at || row.updatedAt,
      }));

      setHoldings(mapped);

      // Live prices are no longer fetched here. They arrive from
      // useMarketSnapshot below and are applied via reviveHoldings, so this
      // page derives its numbers from the same server snapshot as every other
      // account surface — which is what stops /accounts/portfolio,
      // /accounts/holdings and /accounts/cash disagreeing about the same
      // account. The old inline poller also evaluated market hours once at
      // mount, so a page opened before 09:30 never started polling.

      // Build cost basis per share map from holdings
      const cbMap = new Map<string, number>();
      mapped.forEach((h) => {
        if (h.cost_basis !== null && h.cost_basis > 0 && h.quantity > 0) {
          cbMap.set(h.symbol, h.cost_basis / h.quantity);
        }
      });

      // Compute realized gains for sell transactions
      const sells: SellTransaction[] = (sellsRes.data ?? []).map((row) => {
        const qty = Number(row.quantity) || 0;
        const proceeds = Number(row.amount) || 0;
        const cbps = cbMap.get(row.symbol) ?? null;
        let realizedGain: number | null = null;
        let realizedGainPct: number | null = null;

        if (cbps !== null && qty > 0) {
          const estimatedCost = qty * cbps;
          realizedGain = +(proceeds - estimatedCost).toFixed(2);
          realizedGainPct = estimatedCost > 0 ? +((realizedGain / estimatedCost) * 100).toFixed(2) : null;
        }

        return {
          id: row.id,
          date: row.date,
          symbol: row.symbol || "",
          name: row.name || "",
          quantity: qty,
          price: Number(row.price) || 0,
          proceeds,
          cost_basis_per_share: cbps,
          realized_gain: realizedGain,
          realized_gain_pct: realizedGainPct,
        };
      });

      setSellTransactions(sells);
    }

    fetchHoldingsAndSells();

    return () => {
      disposed = true;
    };
  }, [selectedAccountId]);

  // Fetch household holdings (all accounts in same household)
  useEffect(() => {
    // Deliberately reads rawAccounts, not the live-derived accounts: the
    // latter gets a new identity on every 5s poll, which would re-run this
    // Supabase query every tick.
    const account = rawAccounts.find((a) => a.id === selectedAccountId);
    if (!account?.household_id) {
      setHouseholdHoldings([]);
      return;
    }

    const hhAccounts = rawAccounts.filter((a) => a.household_id === account.household_id);
    if (hhAccounts.length <= 1) {
      setHouseholdHoldings([]);
      return;
    }
    const hhAccountIds = hhAccounts.map((a) => a.id);

    async function fetchHouseholdHoldings() {
      const { data, error } = await supabase
        .from("holdings_enriched")
        .select("*")
        .in("accountId", hhAccountIds)
        .order("marketValue", { ascending: false });

      if (error) {
        console.error("Error fetching household holdings:", error.message);
        return;
      }

      const mapped: Holding[] = (data ?? []).map((row) => ({
        id: row.id,
        account_id: row.account_id || row.accountId,
        symbol: row.symbol,
        name: row.name,
        quantity: Number(row.quantity),
        price: Number(row.price),
        market_value: Number(row.market_value || row.marketValue),
        cost_basis: row.cost_basis || row.costBasis ? Number(row.cost_basis || row.costBasis) : null,
        day_change: Number(row.day_change) || 0,
        day_change_pct: Number(row.day_change_pct) || 0,
        asset_class: row.asset_class || row.assetClass,
        created_at: row.created_at || row.createdAt,
        updated_at: row.updated_at || row.updatedAt,
      }));

      setHouseholdHoldings(mapped);
    }

    fetchHouseholdHoldings();
  }, [selectedAccountId, rawAccounts]);

  // Fetch balance data for selected account
  useEffect(() => {
    if (!selectedAccountId) {
      setBalanceData(null);
      return;
    }

    async function fetchBalanceData() {
      const { data, error } = await supabase
        .from("account_balances")
        .select("*")
        .eq("account_id", selectedAccountId)
        .single();

      if (error) {
        // Silently fall back if table doesn't exist or no data found
        // PGRST116 = no rows returned, 42P01 = table doesn't exist
        setBalanceData(null);
        return;
      }

      if (data) {
        const mapped: AccountBalance = {
          id: data.id,
          account_id: data.account_id,
          total_equity: Number(data.total_equity),
          liquidating_equity: Number(data.liquidating_equity),
          long_market_value: Number(data.long_market_value),
          short_market_value: Number(data.short_market_value),
          cash_management_balance: Number(data.cash_management_balance),
          credit_debit_balance: Number(data.credit_debit_balance),
          total_house_requirement: Number(data.total_house_requirement),
          house_surplus: Number(data.house_surplus),
          finra_surplus: Number(data.finra_surplus),
          total_sma: Number(data.total_sma),
          today_federal_call: Number(data.today_federal_call),
          foreign_ccy_house_req: Number(data.foreign_ccy_house_req),
          funds_available_to_trade: Number(data.funds_available_to_trade),
          funds_available_to_withdraw: Number(data.funds_available_to_withdraw),
          day_trade_buying_power: Number(data.day_trade_buying_power),
          funds_unavailable: Number(data.funds_unavailable),
          funds_due: Number(data.funds_due),
          cash: Number(data.cash),
          created_at: data.created_at,
          updated_at: data.updated_at,
        };
        setBalanceData(mapped);
      }
    }

    fetchBalanceData();
  }, [selectedAccountId]);

  // Transfer submit handler
  if (loading) {
    return (
      <div className="flex flex-col h-full min-h-0 bg-background">
        <div className="flex items-center justify-center flex-1">
          <div className="text-muted">Loading portfolio...</div>
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
      <PortfolioHeader
        accounts={accounts}
        selectedAccount={selectedAccount}
        onAccountChange={setSelectedAccountId}
      />

      {/* data-live-total is the cross-page consistency probe: every surface
          that shows this account's value exposes it, so agreement can be
          checked with one querySelectorAll instead of six eyeball comparisons. */}
      <div
        className="flex items-center justify-end px-16 pt-3"
        data-live-total={selectedAccount?.total_value ?? ""}
        data-live-account={selectedAccount?.id ?? ""}
      >
        <MarketStatusPill status={marketStatus} degraded={degraded} asOf={asOf} />
      </div>

      {/* Top spacing lives on the first child (mt-8), not the scroller (py-8):
          padding-top on the scroll container offsets the sticky-thead pin point,
          leaving a strip above the pinned table headers where rows show through. */}
      <div className="flex-1 overflow-y-auto px-16 pb-8">
        {/* Account Details / Client Details toggle */}
        <div className="flex items-center gap-4 mb-4 mt-8">
          <button
            onClick={() => setDetailsView("account")}
            className={`text-xs font-semibold uppercase tracking-wider transition-colors ${
              detailsView === "account"
                ? "text-black dark:text-white"
                : "text-black/40 dark:text-white/40 hover:text-black/60 dark:hover:text-white/60"
            }`}
          >
            Account Details
          </button>
          <button
            onClick={() => setDetailsView("client")}
            className={`text-xs font-semibold uppercase tracking-wider transition-colors ${
              detailsView === "client"
                ? "text-black dark:text-white"
                : "text-black/40 dark:text-white/40 hover:text-black/60 dark:hover:text-white/60"
            }`}
          >
            Client Details
          </button>
        </div>

        {detailsView === "account" ? (
          <AccountDetails account={selectedAccount} hideHeader />
        ) : (
          <div>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-x-8 gap-y-2">
              <div>
                <div className="text-[11px] text-black/40 dark:text-white/40 uppercase tracking-wider">Name</div>
                <div className="text-sm mt-0.5">
                  {selectedAccount?.client_name ? (
                    <Link
                      href={`/communication/crm?search=${encodeURIComponent(selectedAccount.client_name)}`}
                      className="text-black dark:text-white hover:underline"
                    >
                      {selectedAccount.client_name}
                    </Link>
                  ) : "—"}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-black/40 dark:text-white/40 uppercase tracking-wider">Date of Birth</div>
                <div className="text-sm text-black dark:text-white mt-0.5">{selectedAccount?.date_of_birth ? new Date(selectedAccount.date_of_birth).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }) : "—"}</div>
              </div>
              <div>
                <div className="text-[11px] text-black/40 dark:text-white/40 uppercase tracking-wider">SSN</div>
                <div className="text-sm text-black dark:text-white mt-0.5 font-mono">{selectedAccount?.ssn ? `***-**-${selectedAccount.ssn.slice(-4)}` : "—"}</div>
              </div>
              <div>
                <div className="text-[11px] text-black/40 dark:text-white/40 uppercase tracking-wider">Income</div>
                <div className="text-sm text-black dark:text-white mt-0.5">{selectedAccount?.annual_income ? `$${Number(selectedAccount.annual_income).toLocaleString()}` : "—"}</div>
              </div>
              <div>
                <div className="text-[11px] text-black/40 dark:text-white/40 uppercase tracking-wider">Legal Address</div>
                <div className="text-sm text-black dark:text-white mt-0.5">{selectedAccount?.legal_address ? `${selectedAccount.legal_address}, ${selectedAccount.city}, ${selectedAccount.state} ${selectedAccount.zip_code}` : "—"}</div>
              </div>
              <div>
                <div className="text-[11px] text-black/40 dark:text-white/40 uppercase tracking-wider">Mailing Address</div>
                <div className="text-sm text-black dark:text-white mt-0.5">{selectedAccount?.legal_address ? `${selectedAccount.legal_address}, ${selectedAccount.city}, ${selectedAccount.state} ${selectedAccount.zip_code}` : "—"}</div>
              </div>
              <div>
                <div className="text-[11px] text-black/40 dark:text-white/40 uppercase tracking-wider">Net Worth</div>
                <div className="text-sm text-black dark:text-white mt-0.5">{selectedAccount?.net_worth ? `$${Number(selectedAccount.net_worth).toLocaleString()}` : "—"}</div>
              </div>
              <div>
                <div className="text-[11px] text-black/40 dark:text-white/40 uppercase tracking-wider">Risk Tolerance</div>
                <div className="text-sm text-black dark:text-white mt-0.5">{selectedAccount?.risk_tolerance ? selectedAccount.risk_tolerance.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()) : "—"}</div>
              </div>
              <div>
                <div className="text-[11px] text-black/40 dark:text-white/40 uppercase tracking-wider">Investment Objective</div>
                <div className="text-sm text-black dark:text-white mt-0.5">{selectedAccount?.investment_objective ? selectedAccount.investment_objective.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()) : "—"}</div>
              </div>
              <div>
                <div className="text-[11px] text-black/40 dark:text-white/40 uppercase tracking-wider">Time Horizon</div>
                <div className="text-sm text-black dark:text-white mt-0.5">{selectedAccount?.time_horizon ? selectedAccount.time_horizon.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()).replace("Less Than", "< ").replace("Over", "> ") : "—"}</div>
              </div>
            </div>
          </div>
        )}

        {/* Spacer */}
        <div className="my-[96px]" />

        {/* Portfolio Value + Asset Allocation — always side by side, never stacked */}
        <div className="grid grid-cols-2 gap-6 lg:gap-12">
          <AccountSummary account={selectedAccount} householdAccounts={householdAccounts} isHouseholdView={isHouseholdView} refreshKey={0} holdings={holdings} householdHoldings={householdHoldings} onToggleView={() => {
            setIsHouseholdView((v) => {
              const next = !v;
              if (next && activeView === "balance") setActiveView("holdings");
              return next;
            });
          }} />
          <AllocationChart holdings={isHouseholdView && householdHoldings.length > 0 ? householdHoldings : holdings} selectedClass={selectedAssetClass} onSelectClass={setSelectedAssetClass} accountId={selectedAccount?.id} account={selectedAccount} householdAccounts={householdAccounts} isHouseholdView={isHouseholdView} />
        </div>

        {/* Spacer */}
        <div className="my-16" />

        {/* Holdings / Balance Details / Gains Toggle */}
        <div className="flex items-center gap-4 mb-4">
          <button
            onClick={() => setActiveView("holdings")}
            className={`text-xs font-semibold uppercase tracking-wider transition-colors ${
              activeView === "holdings"
                ? "text-black dark:text-white"
                : "text-black/40 dark:text-white/40 hover:text-black/60 dark:hover:text-white/60"
            }`}
          >
            Holdings
          </button>
          {!isHouseholdView && (
            <button
              onClick={() => setActiveView("balance")}
              className={`text-xs font-semibold uppercase tracking-wider transition-colors ${
                activeView === "balance"
                  ? "text-black dark:text-white"
                  : "text-black/40 dark:text-white/40 hover:text-black/60 dark:hover:text-white/60"
              }`}
            >
              Balance
            </button>
          )}
          {selectedAccount && ["individual", "joint", "trust", "ira", "roth_ira"].includes(selectedAccount.account_type) && (
            <>
              <button
                onClick={() => setActiveView("unrealized")}
                className={`text-xs font-semibold uppercase tracking-wider transition-colors ${
                  activeView === "unrealized"
                    ? "text-black dark:text-white"
                    : "text-black/40 dark:text-white/40 hover:text-black/60 dark:hover:text-white/60"
                }`}
              >
                Unrealized
              </button>
              <button
                onClick={() => setActiveView("realized")}
                className={`text-xs font-semibold uppercase tracking-wider transition-colors ${
                  activeView === "realized"
                    ? "text-black dark:text-white"
                    : "text-black/40 dark:text-white/40 hover:text-black/60 dark:hover:text-white/60"
                }`}
              >
                Realized
              </button>
              <button
                onClick={() => setActiveView("cost_basis")}
                className={`text-xs font-semibold uppercase tracking-wider transition-colors ${
                  activeView === "cost_basis"
                    ? "text-black dark:text-white"
                    : "text-black/40 dark:text-white/40 hover:text-black/60 dark:hover:text-white/60"
                }`}
              >
                Cost Basis
                {isHouseholdView && (
                  <span className="ml-1.5 px-1.5 py-0.5 text-xs font-semibold rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 uppercase tracking-wider">Household</span>
                )}
              </button>
            </>
          )}
        </div>

        {/* Holdings Table, Balance Details, Unrealized Gains, or Realized Gains */}
        {activeView === "holdings" ? (
          <HoldingsTable
            holdings={isHouseholdView && householdHoldingsWithCash.length > 0 ? householdHoldingsWithCash : holdingsWithCash}
            totalValue={isHouseholdView ? householdAccounts.reduce((sum, a) => sum + a.total_value, 0) : (selectedAccount?.total_value || 0)}
            selectedAssetClass={selectedAssetClass}
            isHouseholdView={isHouseholdView}
            householdHoldings={householdHoldings}
            householdAccounts={householdAccounts}
          />
        ) : activeView === "unrealized" ? (
          <GainsTable holdings={isHouseholdView && householdHoldingsWithCash.length > 0 ? householdHoldingsWithCash : holdings} sellTransactions={sellTransactions} view="unrealized" />
        ) : activeView === "realized" ? (
          <GainsTable holdings={isHouseholdView && householdHoldingsWithCash.length > 0 ? householdHoldingsWithCash : holdings} sellTransactions={sellTransactions} view="realized" />
        ) : activeView === "cost_basis" ? (
          <CostBasisTable holdings={isHouseholdView && householdHoldingsWithCash.length > 0 ? householdHoldingsWithCash : holdings} />
        ) : (
          <BalanceDetails account={selectedAccount} balanceData={balanceData} />
        )}

        {/* Spacer */}
        <div className="my-24" />

        {/* Transaction History */}
        <TransactionHistory
          accountId={selectedAccountId}
          accountIds={isHouseholdView ? householdAccounts.map((a) => a.id) : undefined}
          accountMap={Object.fromEntries([
            ...(selectedAccount ? [[selectedAccount.id, selectedAccount.account_number]] : []),
            ...householdAccounts.map((a) => [a.id, a.account_number]),
          ])}
          refreshKey={0}
          isHouseholdView={isHouseholdView}
        />

        {/* Bottom spacer */}
        <div className="pb-16" />
      </div>


    </div>
  );
}
