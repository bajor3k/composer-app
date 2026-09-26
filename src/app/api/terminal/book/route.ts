import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { supabase } from "@/lib/supabase";

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const limited = enforceRateLimit(req, "terminal-book", 30, 60_000);
  if (limited) return limited;

  const symbol = req.nextUrl.searchParams.get("symbol");
  if (!symbol) {
    return NextResponse.json({ error: "symbol required" }, { status: 400 });
  }

  try {
    // Fetch all holdings for this symbol across all accounts
    const { data: holdings, error: holdingsErr } = await supabase
      .from("Holding")
      .select("id, accountId, symbol, name, quantity, price, marketValue, costBasis, assetClass, updatedAt")
      .eq("symbol", symbol.toUpperCase())
      .order("marketValue", { ascending: false });

    if (holdingsErr) {
      return NextResponse.json({ error: holdingsErr.message }, { status: 500 });
    }

    if (!holdings || holdings.length === 0) {
      return NextResponse.json({
        symbol: symbol.toUpperCase(),
        totalAccounts: 0,
        totalShares: 0,
        totalMarketValue: 0,
        totalCostBasis: 0,
        totalGainLoss: 0,
        totalGainLossPct: 0,
        avgCostPerShare: 0,
        accounts: [],
      });
    }

    // Get account details for all accounts holding this symbol
    // Batch .in() calls to avoid Supabase URL length limits
    const accountIds = [...new Set(holdings.map((h: any) => h.accountId))];
    const BATCH = 100;
    const allAccounts: any[] = [];
    for (let i = 0; i < accountIds.length; i += BATCH) {
      const batch = accountIds.slice(i, i + BATCH);
      const { data } = await supabase
        .from("portfolio_accounts")
        .select("id, account_number, account_name, account_type, custodian, total_value, client_name, rep_code, household_name, model_name, fee_rate, fee_schedule")
        .in("id", batch);
      if (data) allAccounts.push(...data);
    }

    const accountMap = new Map(allAccounts.map((a: any) => [a.id, a]));

    // Build per-account details
    const accountDetails = holdings.map((h: any) => {
      const acct = accountMap.get(h.accountId) ?? {};
      const mv = Number(h.marketValue) || 0;
      const cb = Number(h.costBasis) || 0;
      const qty = Number(h.quantity) || 0;
      const gainLoss = cb > 0 ? mv - cb : 0;
      const gainLossPct = cb > 0 ? (gainLoss / cb) * 100 : 0;

      return {
        holdingId: h.id,
        accountId: h.accountId,
        accountNumber: (acct as any).account_number ?? "",
        accountName: (acct as any).account_name ?? "",
        accountType: (acct as any).account_type ?? "",
        custodian: (acct as any).custodian ?? "",
        clientName: (acct as any).client_name ?? "",
        repCode: (acct as any).rep_code ?? "",
        householdName: (acct as any).household_name ?? null,
        modelName: (acct as any).model_name ?? null,
        totalAccountValue: Number((acct as any).total_value) || 0,
        quantity: qty,
        price: Number(h.price) || 0,
        marketValue: mv,
        costBasis: cb,
        gainLoss,
        gainLossPct,
        weightInAccount: Number((acct as any).total_value) > 0 ? (mv / Number((acct as any).total_value)) * 100 : 0,
      };
    });

    // Aggregates
    const totalShares = accountDetails.reduce((s, a) => s + a.quantity, 0);
    const totalMarketValue = accountDetails.reduce((s, a) => s + a.marketValue, 0);
    const totalCostBasis = accountDetails.reduce((s, a) => s + a.costBasis, 0);
    const totalGainLoss = totalCostBasis > 0 ? totalMarketValue - totalCostBasis : 0;
    const totalGainLossPct = totalCostBasis > 0 ? (totalGainLoss / totalCostBasis) * 100 : 0;
    const avgCostPerShare = totalShares > 0 ? totalCostBasis / totalShares : 0;

    // Concentration: what % of total AUM across all these accounts does this position represent
    const totalAUM = accountDetails.reduce((s, a) => s + a.totalAccountValue, 0);
    const concentrationPct = totalAUM > 0 ? (totalMarketValue / totalAUM) * 100 : 0;

    // Account type breakdown
    const byAccountType: Record<string, { count: number; marketValue: number; shares: number }> = {};
    for (const a of accountDetails) {
      const key = a.accountType || "Other";
      if (!byAccountType[key]) byAccountType[key] = { count: 0, marketValue: 0, shares: 0 };
      byAccountType[key].count++;
      byAccountType[key].marketValue += a.marketValue;
      byAccountType[key].shares += a.quantity;
    }

    // Custodian breakdown
    const byCustodian: Record<string, { count: number; marketValue: number }> = {};
    for (const a of accountDetails) {
      const key = a.custodian || "Other";
      if (!byCustodian[key]) byCustodian[key] = { count: 0, marketValue: 0 };
      byCustodian[key].count++;
      byCustodian[key].marketValue += a.marketValue;
    }

    return NextResponse.json({
      symbol: symbol.toUpperCase(),
      totalAccounts: accountDetails.length,
      totalShares,
      totalMarketValue,
      totalCostBasis,
      totalGainLoss,
      totalGainLossPct,
      avgCostPerShare,
      concentrationPct,
      totalAUM,
      byAccountType,
      byCustodian,
      accounts: accountDetails,
    });
  } catch {
    return NextResponse.json({ error: "Failed to fetch book data" }, { status: 500 });
  }
}
