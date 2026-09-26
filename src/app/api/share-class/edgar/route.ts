import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";

// Live SEC EDGAR provenance for mutual-fund share classes. EDGAR is public and
// unauthenticated — it only requires a descriptive User-Agent with contact info
// (set SEC_USER_AGENT; the fallback identifies this app). We resolve each ticker to
// its CIK / series / class via the mutual-fund ticker file, then pull the latest
// 485BPOS (annual prospectus) accession + filing date so the tool's "as-of" provenance
// stays current. Fee numbers are NOT parsed here — prospectus text is fragile to parse
// at runtime; those come from the verified dataset.

const SEC_USER_AGENT =
  process.env.SEC_USER_AGENT ?? "Composer Demo contact@example.com";
const MF_TICKERS_URL = "https://www.sec.gov/files/company_tickers_mf.json";

const secHeaders = {
  "User-Agent": SEC_USER_AGENT,
  Accept: "application/json",
  "Accept-Encoding": "gzip, deflate",
};

interface MfRow {
  cik: number;
  seriesId: string;
  classId: string;
  symbol: string;
}

// The mutual-fund ticker map is ~2MB and changes rarely — cache it for a day so a
// refresh doesn't re-download it, and so we stay well inside SEC's fair-access limits.
async function loadMfTickers(): Promise<Map<string, MfRow>> {
  const res = await fetch(MF_TICKERS_URL, {
    headers: secHeaders,
    signal: AbortSignal.timeout(30000),
    next: { revalidate: 86400 },
  });
  if (!res.ok) throw new Error(`SEC mutual-fund ticker file returned ${res.status}`);
  const json = (await res.json()) as { fields: string[]; data: (string | number)[][] };
  const ci = json.fields.indexOf("cik");
  const si = json.fields.indexOf("seriesId");
  const cli = json.fields.indexOf("classId");
  const sy = json.fields.indexOf("symbol");
  const map = new Map<string, MfRow>();
  for (const row of json.data) {
    const symbol = String(row[sy] ?? "").toUpperCase();
    if (!symbol) continue;
    map.set(symbol, {
      cik: Number(row[ci]),
      seriesId: String(row[si] ?? ""),
      classId: String(row[cli] ?? ""),
      symbol,
    });
  }
  return map;
}

interface LatestFiling {
  form: string;
  accession: string;
  filingDate: string;
  primaryDocument: string;
  url: string;
}

async function latest485BPOS(cik: number): Promise<LatestFiling | null> {
  const padded = String(cik).padStart(10, "0");
  const res = await fetch(`https://data.sec.gov/submissions/CIK${padded}.json`, {
    headers: secHeaders,
    signal: AbortSignal.timeout(30000),
    next: { revalidate: 3600 },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    filings?: {
      recent?: {
        accessionNumber: string[];
        form: string[];
        filingDate: string[];
        primaryDocument: string[];
      };
    };
  };
  const recent = json.filings?.recent;
  if (!recent) return null;
  // `recent` arrays are newest-first, so the first 485BPOS is the latest one.
  for (let i = 0; i < recent.form.length; i++) {
    if (recent.form[i] === "485BPOS") {
      const acc = recent.accessionNumber[i];
      const primaryDocument = recent.primaryDocument[i] ?? "";
      return {
        form: recent.form[i],
        accession: acc,
        filingDate: recent.filingDate[i],
        primaryDocument,
        url: `https://www.sec.gov/Archives/edgar/data/${cik}/${acc.replace(/-/g, "")}/${primaryDocument}`,
      };
    }
  }
  return null;
}

// Bounded concurrency so a batch refresh stays polite to SEC (fair-access ~10 req/s).
async function mapPooled<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function GET(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const raw =
    req.nextUrl.searchParams.get("tickers") ?? req.nextUrl.searchParams.get("ticker");
  if (!raw) {
    return NextResponse.json({ error: "ticker(s) required" }, { status: 400 });
  }
  const tickers = [
    ...new Set(
      raw
        .split(",")
        .map((t) => t.trim().toUpperCase())
        .filter(Boolean),
    ),
  ].slice(0, 30);

  try {
    const mf = await loadMfTickers();
    const data = await mapPooled(tickers, 5, async (ticker) => {
      const row = mf.get(ticker);
      if (!row) return { ticker, found: false as const };
      const latestFiling = await latest485BPOS(row.cik);
      return {
        ticker,
        found: true as const,
        cik: row.cik,
        seriesId: row.seriesId,
        classId: row.classId,
        latestFiling,
      };
    });
    return NextResponse.json({ data, source: "SEC EDGAR" });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "SEC EDGAR request failed" },
      { status: 502 },
    );
  }
}
