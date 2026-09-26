"use client";

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Svg,
  Rect,
} from "@react-pdf/renderer";

export interface PortfolioReportData {
  accountNumber: string;
  accountName: string;
  accountType: string;
  custodian: string;
  clientName: string;
  householdName: string;
  totalValue: number;
  cashBalance: number;
  riskTolerance: string;
  investmentObjective: string;
  timeHorizon: string;
  holdings: {
    symbol: string;
    name: string;
    assetClass: string;
    quantity: number;
    price: number;
    marketValue: number;
    costBasis: number;
    gainLoss: number;
    gainPct: number;
    weight: number;
  }[];
  assetAllocation: { assetClass: string; value: number; weight: number }[];
  aiSummary: string;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

const fmtPrecise = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const fmtPct = (n: number) => `${n.toFixed(2)}%`;

const ALLOC_COLORS = ["#3b82f6", "#10B981", "#a855f7", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899", "#84cc16"];

const s = StyleSheet.create({
  page: { padding: 40, fontFamily: "Helvetica", fontSize: 10, color: "#1a1a1a" },
  header: { marginBottom: 20 },
  logo: { fontSize: 22, fontWeight: "bold", color: "#000", marginBottom: 3 },
  subtitle: { fontSize: 13, color: "#444", marginBottom: 2 },
  meta: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  metaText: { fontSize: 8, color: "#999" },
  divider: { borderBottomWidth: 1, borderBottomColor: "#e5e5e5", marginVertical: 14 },
  dividerThick: { borderBottomWidth: 2, borderBottomColor: "#000", marginVertical: 14 },
  sectionTitle: { fontSize: 11, fontWeight: "bold", marginBottom: 10, color: "#000", textTransform: "uppercase", letterSpacing: 0.5 },

  // Summary cards
  summaryRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  card: { flex: 1, padding: 12, borderRadius: 4, backgroundColor: "#f9f9f9" },
  cardHighlight: { flex: 1, padding: 12, borderRadius: 4, backgroundColor: "#f0fdf4", borderWidth: 1, borderColor: "#bbf7d0" },
  cardLabel: { fontSize: 7, color: "#666", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 },
  cardValue: { fontSize: 15, fontWeight: "bold", color: "#000" },
  cardSub: { fontSize: 7, color: "#999", marginTop: 2 },

  // Table
  tableHeader: { flexDirection: "row", backgroundColor: "#f5f5f5", borderBottomWidth: 1, borderBottomColor: "#e5e5e5", paddingVertical: 6, paddingHorizontal: 6 },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#f0f0f0", paddingVertical: 5, paddingHorizontal: 6 },
  tableRowAlt: { backgroundColor: "#fafafa" },
  th: { fontSize: 7, fontWeight: "bold", color: "#666", textTransform: "uppercase", letterSpacing: 0.3 },
  td: { fontSize: 8 },
  tdBold: { fontSize: 8, fontWeight: "bold" },
  totalsRow: { flexDirection: "row", backgroundColor: "#f0f0f0", paddingVertical: 7, paddingHorizontal: 6, marginTop: 2 },

  // Allocation
  allocRow: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  allocLabel: { width: "25%", fontSize: 8, color: "#555" },
  allocBarBg: { flex: 1, height: 8, backgroundColor: "#f0f0f0", borderRadius: 4, marginHorizontal: 8 },
  allocValue: { width: "18%", fontSize: 8, textAlign: "right", color: "#333" },

  // Columns
  colSymbol: { width: "8%" },
  colName: { width: "20%" },
  colClass: { width: "12%" },
  colShares: { width: "10%", textAlign: "right" },
  colPrice: { width: "10%", textAlign: "right" },
  colValue: { width: "12%", textAlign: "right" },
  colCost: { width: "10%", textAlign: "right" },
  colGain: { width: "10%", textAlign: "right" },
  colWeight: { width: "8%", textAlign: "right" },

  // AI Summary
  aiBox: { padding: 14, backgroundColor: "#fafafa", borderRadius: 4, borderWidth: 1, borderColor: "#e5e5e5", marginBottom: 16 },
  aiText: { fontSize: 9, lineHeight: 1.5, color: "#333" },

  // Info grid
  infoGrid: { flexDirection: "row", gap: 20, marginBottom: 16 },
  infoCol: { flex: 1 },
  infoRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  infoLabel: { fontSize: 8, color: "#666" },
  infoValue: { fontSize: 8, fontWeight: "bold", color: "#333" },

  green: { color: "#10B981" },
  red: { color: "#dc2626" },

  footer: { position: "absolute", bottom: 30, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: "#e5e5e5", paddingTop: 10 },
  footerText: { fontSize: 7, color: "#999" },
});

export default function PortfolioReportPDF({ data }: { data: PortfolioReportData }) {
  const holdingsValue = data.holdings.reduce((sum, h) => sum + h.marketValue, 0);
  const totalCost = data.holdings.reduce((sum, h) => sum + h.costBasis, 0);
  const totalGain = holdingsValue - totalCost;
  const totalGainPct = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  return (
    <Document>
      {/* Page 1: Summary + AI Analysis */}
      <Page size="LETTER" style={s.page}>
        <View style={s.header}>
          <Text style={s.logo}>Composer</Text>
          <Text style={s.subtitle}>Portfolio Analysis Report</Text>
          <View style={s.meta}>
            <Text style={s.metaText}>Account: {data.accountNumber} — {data.accountName}</Text>
            <Text style={s.metaText}>Generated: {today}</Text>
          </View>
        </View>

        <View style={s.dividerThick} />

        {/* Account Info */}
        <Text style={s.sectionTitle}>Account Overview</Text>
        <View style={s.infoGrid}>
          <View style={s.infoCol}>
            <View style={s.infoRow}><Text style={s.infoLabel}>Client</Text><Text style={s.infoValue}>{data.clientName}</Text></View>
            <View style={s.infoRow}><Text style={s.infoLabel}>Household</Text><Text style={s.infoValue}>{data.householdName}</Text></View>
            <View style={s.infoRow}><Text style={s.infoLabel}>Account Type</Text><Text style={s.infoValue}>{data.accountType.replace(/_/g, " ")}</Text></View>
            <View style={s.infoRow}><Text style={s.infoLabel}>Custodian</Text><Text style={s.infoValue}>{data.custodian}</Text></View>
          </View>
          <View style={s.infoCol}>
            <View style={s.infoRow}><Text style={s.infoLabel}>Risk Tolerance</Text><Text style={s.infoValue}>{data.riskTolerance || "N/A"}</Text></View>
            <View style={s.infoRow}><Text style={s.infoLabel}>Investment Objective</Text><Text style={s.infoValue}>{data.investmentObjective || "N/A"}</Text></View>
            <View style={s.infoRow}><Text style={s.infoLabel}>Time Horizon</Text><Text style={s.infoValue}>{data.timeHorizon || "N/A"}</Text></View>
          </View>
        </View>

        {/* Summary Cards */}
        <View style={s.summaryRow}>
          <View style={s.cardHighlight}>
            <Text style={s.cardLabel}>Total Value</Text>
            <Text style={s.cardValue}>{fmt(data.totalValue)}</Text>
            <Text style={s.cardSub}>{data.holdings.length} positions</Text>
          </View>
          <View style={s.card}>
            <Text style={s.cardLabel}>Cash Balance</Text>
            <Text style={s.cardValue}>{fmt(data.cashBalance)}</Text>
            <Text style={s.cardSub}>{data.totalValue > 0 ? fmtPct((data.cashBalance / data.totalValue) * 100) : "0%"} of portfolio</Text>
          </View>
          <View style={s.card}>
            <Text style={s.cardLabel}>Total Gain/Loss</Text>
            <Text style={[s.cardValue, totalGain >= 0 ? s.green : s.red]}>{fmt(totalGain)}</Text>
            <Text style={s.cardSub}>{fmtPct(totalGainPct)} return on cost</Text>
          </View>
        </View>

        <View style={s.divider} />

        {/* AI Analysis */}
        <Text style={s.sectionTitle}>Analysis</Text>
        <View style={s.aiBox}>
          <Text style={s.aiText}>{data.aiSummary}</Text>
        </View>

        <View style={s.divider} />

        {/* Asset Allocation */}
        <Text style={s.sectionTitle}>Asset Allocation</Text>
        {data.assetAllocation.map((a, i) => (
          <View key={a.assetClass} style={s.allocRow}>
            <Text style={s.allocLabel}>{a.assetClass}</Text>
            <View style={s.allocBarBg}>
              <Svg width={`${Math.min(a.weight, 100)}%`} height="8">
                <Rect width="100%" height="8" rx="4" fill={ALLOC_COLORS[i % ALLOC_COLORS.length]} />
              </Svg>
            </View>
            <Text style={s.allocValue}>{fmt(a.value)} ({fmtPct(a.weight)})</Text>
          </View>
        ))}

        <View style={s.footer}>
          <Text style={s.footerText}>Composer Wealth Management Platform</Text>
          <Text style={s.footerText}>Confidential — Page 1</Text>
        </View>
      </Page>

      {/* Page 2: Holdings Detail */}
      <Page size="LETTER" style={s.page}>
        <View style={s.header}>
          <Text style={s.logo}>Composer</Text>
          <Text style={{ fontSize: 10, color: "#666" }}>Holdings Detail — {data.accountNumber}</Text>
        </View>

        <View style={s.dividerThick} />

        <Text style={s.sectionTitle}>Holdings ({data.holdings.length} positions)</Text>

        {/* Table header */}
        <View style={s.tableHeader}>
          <Text style={[s.th, s.colSymbol]}>Ticker</Text>
          <Text style={[s.th, s.colName]}>Name</Text>
          <Text style={[s.th, s.colClass]}>Class</Text>
          <Text style={[s.th, s.colShares]}>Shares</Text>
          <Text style={[s.th, s.colPrice]}>Price</Text>
          <Text style={[s.th, s.colValue]}>Value</Text>
          <Text style={[s.th, s.colCost]}>Cost</Text>
          <Text style={[s.th, s.colGain]}>Gain/Loss</Text>
          <Text style={[s.th, s.colWeight]}>Weight</Text>
        </View>

        {/* Table rows */}
        {data.holdings.slice(0, 40).map((h, i) => (
          <View key={h.symbol} style={[s.tableRow, i % 2 === 1 ? s.tableRowAlt : {}]}>
            <Text style={[s.tdBold, s.colSymbol]}>{h.symbol}</Text>
            <Text style={[s.td, s.colName]}>{h.name}</Text>
            <Text style={[s.td, s.colClass]}>{h.assetClass}</Text>
            <Text style={[s.td, s.colShares]}>{h.quantity.toLocaleString()}</Text>
            <Text style={[s.td, s.colPrice]}>{fmtPrecise(h.price)}</Text>
            <Text style={[s.td, s.colValue]}>{fmt(h.marketValue)}</Text>
            <Text style={[s.td, s.colCost]}>{fmt(h.costBasis)}</Text>
            <Text style={[s.td, s.colGain, h.gainLoss >= 0 ? s.green : s.red]}>{fmt(h.gainLoss)}</Text>
            <Text style={[s.td, s.colWeight]}>{fmtPct(h.weight)}</Text>
          </View>
        ))}

        {/* Totals */}
        <View style={s.totalsRow}>
          <Text style={[s.tdBold, s.colSymbol]}>Total</Text>
          <Text style={[s.td, s.colName]}></Text>
          <Text style={[s.td, s.colClass]}></Text>
          <Text style={[s.td, s.colShares]}></Text>
          <Text style={[s.td, s.colPrice]}></Text>
          <Text style={[s.tdBold, s.colValue]}>{fmt(holdingsValue)}</Text>
          <Text style={[s.tdBold, s.colCost]}>{fmt(totalCost)}</Text>
          <Text style={[s.tdBold, s.colGain, totalGain >= 0 ? s.green : s.red]}>{fmt(totalGain)}</Text>
          <Text style={[s.tdBold, s.colWeight]}>100%</Text>
        </View>

        <View style={s.footer}>
          <Text style={s.footerText}>Composer Wealth Management Platform</Text>
          <Text style={s.footerText}>Confidential — Page 2</Text>
        </View>
      </Page>
    </Document>
  );
}
