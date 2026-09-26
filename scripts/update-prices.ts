import "dotenv/config";
import { Pool } from "pg";
// @ts-ignore
import YahooFinance from "yahoo-finance2";

const CASH_SYMBOLS = new Set(["CASH", "VMFXX", "SPAXX", "SWVXX"]);

// Yahoo Finance uses hyphens where DB uses dots (e.g. BRK.B → BRK-B)
function toYahooSymbol(sym: string): string {
  return sym.replace(".", "-");
}
function fromYahooSymbol(sym: string): string {
  return sym.replace("-", ".");
}

async function main() {
  const dbUrl = (process.env.DATABASE_URL || "").replace(":5432/", ":6543/");
  if (!dbUrl) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: dbUrl,
    max: 1,
    connectionTimeoutMillis: 30000,
  });

  const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

  // Step 1: Get all unique symbols from Security table
  const { rows: secRows } = await pool.query(
    `SELECT symbol FROM "Security" ORDER BY symbol`
  );
  const allSymbols = secRows.map((r: { symbol: string }) => r.symbol);
  const tradeable = allSymbols.filter((s: string) => !CASH_SYMBOLS.has(s));

  console.log(`Found ${allSymbols.length} securities (${tradeable.length} tradeable, ${allSymbols.length - tradeable.length} cash/MMF)`);

  // Step 2: Fetch quotes from Yahoo Finance in batches
  const BATCH_SIZE = 20;
  const priceMap = new Map<string, { price: number; previousClose: number }>();
  let fetchErrors: string[] = [];

  for (let i = 0; i < tradeable.length; i += BATCH_SIZE) {
    const batch = tradeable.slice(i, i + BATCH_SIZE);
    const yahooSymbols = batch.map(toYahooSymbol);

    try {
      const quotes = await yf.quote(yahooSymbols);
      for (const q of quotes) {
        if (q.regularMarketPrice && q.regularMarketPreviousClose) {
          const dbSymbol = fromYahooSymbol(q.symbol);
          priceMap.set(dbSymbol, {
            price: q.regularMarketPrice,
            previousClose: q.regularMarketPreviousClose,
          });
        }
      }
    } catch (e: any) {
      // Try individually on batch failure
      for (const sym of batch) {
        try {
          const q = await yf.quote(toYahooSymbol(sym));
          if (q.regularMarketPrice && q.regularMarketPreviousClose) {
            priceMap.set(sym, {
              price: q.regularMarketPrice,
              previousClose: q.regularMarketPreviousClose,
            });
          }
        } catch {
          fetchErrors.push(sym);
        }
      }
    }

    if (i + BATCH_SIZE < tradeable.length) {
      // Small delay between batches to be respectful
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  console.log(`Fetched prices for ${priceMap.size}/${tradeable.length} symbols`);
  if (fetchErrors.length > 0) {
    console.warn(`Failed to fetch: ${fetchErrors.join(", ")}`);
  }

  // Step 3: Update Security table
  let secUpdated = 0;
  for (const [symbol, data] of priceMap) {
    await pool.query(
      `UPDATE "Security" SET price = $1, "previousClose" = $2, "priceDate" = NOW(), "updatedAt" = NOW() WHERE symbol = $3`,
      [data.price, data.previousClose, symbol]
    );
    secUpdated++;
  }
  console.log(`Updated ${secUpdated} Security rows`);

  // Step 4: Update Holding prices and marketValue
  let holdingsUpdated = 0;
  for (const [symbol, data] of priceMap) {
    const result = await pool.query(
      `UPDATE "Holding" SET price = $1, "marketValue" = quantity * $1, "updatedAt" = NOW() WHERE symbol = $2`,
      [data.price, symbol]
    );
    holdingsUpdated += result.rowCount || 0;
  }
  console.log(`Updated ${holdingsUpdated} Holding rows`);

  // Step 4b: Sync CASH holdings with Account.cashBalance
  const { rowCount: cashFixed } = await pool.query(`
    UPDATE "Holding" h
    SET quantity = a."cashBalance",
        "marketValue" = a."cashBalance",
        "costBasis" = a."cashBalance",
        "updatedAt" = NOW()
    FROM "Account" a
    WHERE h."accountId" = a.id
      AND h.symbol = 'CASH'
      AND h."marketValue" != a."cashBalance"
  `);
  if (cashFixed && cashFixed > 0) {
    console.log(`Synced ${cashFixed} CASH holdings with Account.cashBalance`);
  }

  // Step 5: Recalculate Account balances from holdings
  const { rowCount: accountsUpdated } = await pool.query(`
    UPDATE "Account" a
    SET balance = sub.total, "updatedAt" = NOW()
    FROM (
      SELECT "accountId", SUM("marketValue") AS total
      FROM "Holding"
      GROUP BY "accountId"
    ) sub
    WHERE a.id = sub."accountId"
  `);
  console.log(`Recalculated ${accountsUpdated} Account balances`);

  // Summary
  console.log("\n--- Price Update Complete ---");
  console.log(`Securities: ${secUpdated} updated`);
  console.log(`Holdings: ${holdingsUpdated} updated`);
  console.log(`Accounts: ${accountsUpdated} recalculated`);

  // Show a few sample prices
  console.log("\nSample prices:");
  const samples = ["AAPL", "MSFT", "GOOGL", "NVDA", "BND"];
  for (const sym of samples) {
    const data = priceMap.get(sym);
    if (data) {
      const change = data.price - data.previousClose;
      const changePct = (change / data.previousClose) * 100;
      console.log(
        `  ${sym}: $${data.price.toFixed(2)} (${change >= 0 ? "+" : ""}${change.toFixed(2)}, ${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%)`
      );
    }
  }

  await pool.end();
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
