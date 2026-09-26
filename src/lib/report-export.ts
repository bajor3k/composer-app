// Generic report export — Excel (branded) and CSV

import { formatKey, formatValue, csvCell } from "./format-utils";

// ── ARGB colors matching portfolio-export.ts ──────────────────
const COLORS = {
  headerBg: "FF1A1A1A",
  headerFont: "FFFFFFFF",
  altRow: "FFFAFAFA",
  white: "FFFFFFFF",
  black: "FF000000",
  muted: "FF737373",
  sectionBg: "FFF5F5F5",
  sectionBorder: "FFE0E0E0",
  accent: "FF3B82F6",      // blue accent
  accentLight: "FFDBEAFE",  // light blue
  accentMuted: "FF93C5FD",  // mid blue
  green: "FF16A34A",
  red: "FFEF4444",
};

const CURRENCY_FMT = "$#,##0.00";

function isCurrencyColumn(key: string): boolean {
  const lk = key.toLowerCase();
  if (lk.startsWith("count") || lk.endsWith("_count") || lk.includes("total_accounts") || lk.includes("accounts_with") || lk.includes("accounts_needing")) return false;
  return lk.includes("value") || lk.includes("balance") || lk.includes("amount") || lk.includes("price") || lk.includes("cost") || lk.includes("fee");
}

// ── Excel Export ──────────────────────────────────────────────

export async function exportToExcel(
  data: Record<string, unknown>[],
  reportTitle: string,
  columns: string[]
) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Composer";
  workbook.created = new Date();

  const ws = workbook.addWorksheet(reportTitle, {
    views: [{ showGridLines: false }],
  });

  const colCount = columns.length;

  // Auto-size columns based on header and first 20 rows
  ws.columns = columns.map((col) => {
    let maxLen = formatKey(col).length;
    for (let i = 0; i < Math.min(data.length, 20); i++) {
      const val = formatValue(col, data[i][col]);
      if (val.length > maxLen) maxLen = val.length;
    }
    return { width: Math.min(Math.max(maxLen + 4, 12), 40) };
  });

  let row = 1;

  // ─── Accent stripe (thin blue bar at top) ───────────────────
  ws.mergeCells(row, 1, row, colCount);
  fillRow(ws, row, colCount, COLORS.accent);
  ws.getRow(row).height = 6;
  row++;

  // ─── Title row ──────────────────────────────────────────────
  ws.mergeCells(row, 1, row, colCount);
  const titleCell = ws.getCell(row, 1);
  titleCell.value = reportTitle;
  titleCell.font = { size: 18, bold: true, color: { argb: COLORS.headerFont } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.headerBg } };
  titleCell.alignment = { vertical: "middle" };
  ws.getRow(row).height = 40;
  fillRow(ws, row, colCount, COLORS.headerBg);
  row++;

  // ─── Subtitle row ──────────────────────────────────────────
  ws.mergeCells(row, 1, row, colCount);
  const subtitleCell = ws.getCell(row, 1);
  subtitleCell.value = `Generated ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}  •  ${data.length} rows  •  PROJECT X`;
  subtitleCell.font = { size: 10, color: { argb: COLORS.accentMuted } };
  subtitleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.headerBg } };
  subtitleCell.alignment = { vertical: "middle" };
  ws.getRow(row).height = 22;
  fillRow(ws, row, colCount, COLORS.headerBg);
  row++;

  // ─── Accent stripe (bottom of header) ──────────────────────
  ws.mergeCells(row, 1, row, colCount);
  fillRow(ws, row, colCount, COLORS.accent);
  ws.getRow(row).height = 4;
  row++;

  row++; // spacer

  // ─── Column headers ─────────────────────────────────────────
  const headerRow = row;
  for (let c = 0; c < columns.length; c++) {
    const cell = ws.getCell(row, c + 1);
    cell.value = formatKey(columns[c]);
    cell.font = { size: 9, bold: true, color: { argb: COLORS.accent } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.accentLight } };
    cell.alignment = { horizontal: isCurrencyColumn(columns[c]) ? "right" : "left", vertical: "middle" };
    cell.border = { bottom: { style: "medium", color: { argb: COLORS.accent } } };
  }
  ws.getRow(row).height = 28;
  row++;

  // ─── Data rows ──────────────────────────────────────────────
  for (let i = 0; i < data.length; i++) {
    const bg = i % 2 === 1 ? COLORS.altRow : COLORS.white;
    for (let c = 0; c < columns.length; c++) {
      const key = columns[c];
      const rawVal = data[i][key];
      const cell = ws.getCell(row, c + 1);

      if (typeof rawVal === "number" && isCurrencyColumn(key)) {
        cell.value = rawVal;
        cell.numFmt = CURRENCY_FMT;
        cell.font = { size: 10, color: { argb: COLORS.black } };
        cell.alignment = { horizontal: "right", vertical: "middle" };
      } else if (typeof rawVal === "number") {
        cell.value = rawVal;
        cell.font = { size: 10, color: { argb: COLORS.black } };
        cell.alignment = { horizontal: "right", vertical: "middle" };
      } else {
        cell.value = formatValue(key, rawVal);
        cell.font = { size: 10, color: { argb: COLORS.black } };
        cell.alignment = { horizontal: "left", vertical: "middle" };
      }

      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
    }
    row++;
  }

  // Freeze at header row
  ws.views = [{ state: "frozen", ySplit: headerRow, showGridLines: false }];

  // Generate and download
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${reportTitle.replace(/\s+/g, "-").toLowerCase()}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── CSV Export ────────────────────────────────────────────────

export function exportToCsv(
  data: Record<string, unknown>[],
  reportTitle: string,
  columns: string[]
) {
  const header = columns.map((col) => csvCell(formatKey(col))).join(",");
  const rows = data.map((row) =>
    columns.map((col) => csvCell(formatValue(col, row[col]))).join(",")
  );
  const csv = "\uFEFF" + [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${reportTitle.replace(/\s+/g, "-").toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Helpers ──────────────────────────────────────────────────

function fillRow(ws: import("exceljs").Worksheet, row: number, colCount: number, color: string) {
  for (let c = 1; c <= colCount; c++) {
    const cell = ws.getCell(row, c);
    if (!cell.fill || !(cell.fill as { fgColor?: unknown }).fgColor) {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
    }
  }
}
