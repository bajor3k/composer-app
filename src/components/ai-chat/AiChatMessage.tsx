"use client";

import { useState } from "react";
import { type ChatMessage } from "./types";
import { formatCurrency, formatValue, formatKey, csvCell, exportToCsv } from "@/lib/format-utils";
import { exportToExcel } from "@/lib/report-export";
import MessageMeta from "@/components/ui/MessageMeta";
import { renderMarkdownContent } from "./markdown";
import AgentThinking from "./AgentThinking";

interface AiChatMessageProps {
  message: ChatMessage;
}

export default function AiChatMessage({ message }: AiChatMessageProps) {
  const isUser = message.role === "user";

  // exportToCsv is now imported from @/lib/format-utils

  const renderAttachments = () => {
    if (!message.attachments || message.attachments.length === 0) return null;

    const getFileIcon = (type: string) => {
      if (type === "application/pdf") return "PDF";
      if (type.startsWith("image/")) return "IMG";
      if (type.includes("spreadsheet") || type === "text/csv") return "XLS";
      if (type.includes("word")) return "DOC";
      return "TXT";
    };

    return (
      <div className="mt-2 flex flex-wrap gap-1.5">
        {message.attachments.map((file, index) => (
          <div
            key={index}
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs ${
              isUser
                ? "bg-white/20 text-white"
                : "bg-black/10 dark:bg-white/10 text-black/70 dark:text-white/70"
            }`}
          >
            <span className="font-medium">{getFileIcon(file.type)}</span>
            <span className="max-w-[100px] truncate">{file.name}</span>
          </div>
        ))}
      </div>
    );
  };

  const renderAgentBadge = () => {
    if (!message.agent) return null;
    return (
      <div className="mb-1.5 text-xs text-accent font-medium">
        @{message.agent}
      </div>
    );
  };

  const renderData = () => {
    if (!message.data) return null;
    return <ReportDataRenderer data={message.data} maxRows={20} />;
  };


  return (
    <div className={`group flex flex-col ${isUser ? "items-end" : "items-start"} mb-4`}>
      <div
        className={`max-w-[85%] px-4 py-2.5 ${
          isUser
            ? "bg-[#f4f4f4] dark:bg-[#0a0a0a] text-black dark:text-white/60 rounded-2xl rounded-br-md"
            : "bg-transparent dark:bg-transparent text-black dark:text-white/85 rounded-2xl rounded-bl-md"
        }`}
      >
        {!isUser && renderAgentBadge()}
        {(() => {
          const cleaned = (message.content || "").replace(/\n?\[Agent @?\w+[^\]]*\]/g, "").replace(/^\[step-by-step\]\s*/i, "").trim();
          return renderMarkdownContent(cleaned);
        })()}
        {isUser && renderAttachments()}
        {!isUser && renderData()}
        {!isUser && message.pdfReport && <PdfDownloadButton pdfReport={message.pdfReport} />}
      </div>
      <MessageMeta text={message.content || ""} time={message.timestamp} align={isUser ? "right" : "left"} />
    </div>
  );
}

// Reusable data renderer for both inline messages and the report panel
export function ReportDataRenderer({
  data,
  showExport = true,
  maxRows,
  columnLabels,
}: {
  data: Record<string, unknown>[] | Record<string, unknown> | null;
  showExport?: boolean;
  maxRows?: number;
  columnLabels?: Record<string, string>;
}) {
  if (!data) return null;

  // Single object (detail view)
  if (!Array.isArray(data)) {
    const scalarEntries: [string, unknown][] = [];
    const tableEntries: [string, Record<string, unknown>[]][] = [];

    Object.entries(data).forEach(([key, value]) => {
      if (key.toLowerCase().includes("id") && key !== "account_number") return;
      if (
        Array.isArray(value) &&
        value.length > 0 &&
        typeof value[0] === "object" &&
        value[0] !== null
      ) {
        tableEntries.push([key, value as Record<string, unknown>[]]);
      } else {
        scalarEntries.push([key, value]);
      }
    });

    const exportCombinedCsv = () => {
      const lines: string[] = [];
      if (scalarEntries.length > 0) {
        lines.push(csvCell("Summary"));
        scalarEntries.forEach(([key, value]) => {
          lines.push(`${csvCell(formatKey(key))},${csvCell(formatValue(key, value))}`);
        });
      }
      tableEntries.forEach(([key, rows]) => {
        const cols = Object.keys(rows[0]).filter(
          (col) => !col.toLowerCase().endsWith("_id") && col !== "id" &&
            !(Array.isArray(rows[0][col]) && typeof (rows[0][col] as unknown[])[0] === "object")
        );
        lines.push("");
        lines.push(csvCell(formatKey(key)));
        lines.push(cols.map((c) => csvCell(formatKey(c))).join(","));
        rows.forEach((row) => {
          lines.push(cols.map((c) => csvCell(formatValue(c, row[c]))).join(","));
        });
      });
      const csv = "\uFEFF" + lines.join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `composer-agent-export-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    };

    return (
      <div className="mt-3 space-y-3">
        {scalarEntries.length > 0 && (
          <div className="bg-black/5 dark:bg-white/5 rounded-lg p-3 text-xs space-y-1.5">
            {scalarEntries.map(([key, value]) => (
              <div key={key} className="flex justify-between">
                <span className="text-black/50 dark:text-white/50">{formatKey(key)}</span>
                <span className="text-black dark:text-white font-medium">{formatValue(key, value)}</span>
              </div>
            ))}
          </div>
        )}
        {tableEntries.map(([key, rows]) => {
          const tableCols = Object.keys(rows[0]).filter(
            (col) => !col.toLowerCase().endsWith("_id") && col !== "id" &&
              !(Array.isArray(rows[0][col]) && typeof (rows[0][col] as unknown[])[0] === "object")
          );
          return (
            <div key={key} className="overflow-x-auto">
              <div className="text-xs font-medium text-black/50 dark:text-white/50 mb-1">{formatKey(key)}</div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-black/10 dark:border-white/10">
                    {tableCols.map((col) => (
                      <th key={col} className="text-left px-2 py-1.5 text-black/50 dark:text-white/50 font-medium whitespace-nowrap">
                        {formatKey(col)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(maxRows ? rows.slice(0, maxRows) : rows).map((row, i) => (
                    <tr key={i} className="border-b border-black/5 dark:border-white/5">
                      {tableCols.map((col) => (
                        <td key={col} className="px-2 py-1.5 text-black dark:text-white whitespace-nowrap">
                          {formatValue(col, row[col])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {maxRows && rows.length > maxRows && (
                <div className="flex items-center justify-center mt-2">
                  <span className="text-xs text-black/40 dark:text-white/40">
                    Showing {maxRows} of {rows.length} results
                  </span>
                </div>
              )}
            </div>
          );
        })}
        {showExport && (
          <div className="flex items-center justify-center mt-2">
            <button
              onClick={exportCombinedCsv}
              className="inline-flex items-center gap-1 text-xs text-accent hover:text-accent/80 font-medium transition-colors"
            >
              <DownloadIcon className="w-3 h-3" />
              Download CSV
            </button>
          </div>
        )}
      </div>
    );
  }

  // Array (list view)
  if (data.length === 0) {
    return (
      <div className="mt-3 text-xs text-black/50 dark:text-white/50 italic">
        No results found
      </div>
    );
  }

  const columns = Object.keys(data[0]).filter(
    (key) => !key.toLowerCase().endsWith("_id") && key !== "id"
  );

  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-black/10 dark:border-white/10">
            {columns.map((col) => (
              <th
                key={col}
                className="text-left px-2 py-1.5 text-black/50 dark:text-white/50 font-medium whitespace-nowrap"
              >
                {columnLabels?.[col] ?? formatKey(col)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(maxRows ? data.slice(0, maxRows) : data).map((row, i) => (
            <tr key={i} className="border-b border-black/5 dark:border-white/5">
              {columns.map((col) => (
                <td
                  key={col}
                  className="px-2 py-1.5 text-black dark:text-white whitespace-nowrap"
                >
                  {formatValue(col, row[col])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center justify-center gap-3 mt-2">
        {maxRows && data.length > maxRows && (
          <span className="text-xs text-black/40 dark:text-white/40">
            Showing {maxRows} of {data.length} results
          </span>
        )}
        {showExport && (
          <>
            <button
              onClick={() => exportToCsv(data, columns)}
              className="inline-flex items-center gap-1 text-xs text-accent hover:text-accent/80 font-medium transition-colors"
            >
              <DownloadIcon className="w-3 h-3" />
              CSV
            </button>
            <button
              onClick={() => exportToExcel(data, "Composer Export", columns)}
              className="inline-flex items-center gap-1 text-xs text-accent hover:text-accent/80 font-medium transition-colors"
            >
              <DownloadIcon className="w-3 h-3" />
              Excel
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function PdfDownloadButton({ pdfReport }: { pdfReport: Record<string, unknown> }) {
  const [generating, setGenerating] = useState(false);

  const handleDownload = async () => {
    setGenerating(true);
    try {
      const { pdf } = await import("@react-pdf/renderer");
      const { default: PortfolioReportPDF } = await import("@/components/portfolio/PortfolioReportPDF");
      const blob = await pdf(<PortfolioReportPDF data={pdfReport as any} />).toBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `portfolio-report-${pdfReport.accountNumber || "account"}_${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("PDF generation failed:", err);
    } finally {
      setGenerating(false);
    }
  };

  const title = `Portfolio Report — ${pdfReport.accountNumber || "Account"}`;

  return (
    <div className="mt-3">
      <button
        onClick={handleDownload}
        disabled={generating}
        className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-50 max-w-[280px]"
      >
        <span className="flex-shrink-0 text-[11px] font-bold text-red-500 bg-red-500/10 px-1.5 py-0.5 rounded">
          PDF
        </span>
        <div className="text-left min-w-0">
          <div className="text-xs font-medium text-black dark:text-white truncate">
            {generating ? "Generating..." : title}
          </div>
          <div className="text-[10px] text-black/40 dark:text-white/40">PDF</div>
        </div>
      </button>
    </div>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
  );
}

/** Canvas-mode thinking bubble. Same rotating status + elapsed clock as the rest of
 *  the app (AgentThinking), kept in the canvas panel's iMessage bubble shape. */
export function TypingIndicator({ label }: { label?: string | null }) {
  return (
    <AgentThinking
      label={label}
      className="flex items-start mb-4"
      bubbleClassName="bg-[#E5E5EA] dark:bg-[#3A3A3C] px-4 py-3 rounded-2xl rounded-bl-md"
    />
  );
}
