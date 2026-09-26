// Shared formatting utilities for data display and export

export function formatCurrency(value: unknown): string {
  if (typeof value !== "number") return String(value);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return "\u2014";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    const lk = key.toLowerCase();
    const isCount =
      lk.includes("total_accounts") ||
      lk.includes("accounts_with") ||
      lk.includes("accounts_needing") ||
      lk.startsWith("count") ||
      lk.endsWith("_count");
    if (
      !isCount &&
      (lk.includes("value") ||
        lk.includes("balance") ||
        lk.includes("amount") ||
        lk.includes("price") ||
        lk.includes("cost"))
    ) {
      return formatCurrency(value);
    }
    if (lk.includes("pct") || lk.includes("percent")) {
      return `${value.toFixed(2)}%`;
    }
    if (lk.includes("year")) {
      return String(value);
    }
    return value.toLocaleString();
  }
  if (typeof value === "string") {
    if (
      key.toLowerCase().includes("date") ||
      key.toLowerCase().includes("created") ||
      key.toLowerCase().includes("updated")
    ) {
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      }
    }
    return value;
  }
  if (Array.isArray(value)) {
    const primitives = value.filter((v) => typeof v !== "object" || v === null);
    if (primitives.length === value.length) return primitives.join(", ");
    return `${value.length} items`;
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

export function formatKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function formatDate(value: string | null): string {
  if (!value) return "–";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "–";
  return d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
}

export function maskSsn(ssn: string | null): string {
  if (!ssn) return "–";
  const digits = ssn.replace(/\D/g, "");
  if (digits.length >= 4) return `***-**-${digits.slice(-4)}`;
  return "***-**-****";
}

export function formatAge(dob: string | null): string {
  if (!dob) return "–";
  const birth = new Date(dob);
  if (isNaN(birth.getTime())) return "–";
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return String(age);
}

export function formatLabel(value: string | null): string {
  if (!value) return "–";
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatAddress(addr: string | null, city: string | null, state: string | null, zip: string | null): string {
  const cityState = [city, state].filter(Boolean).join(", ");
  const line = [addr, cityState, zip].filter(Boolean).join(", ");
  return line || "–";
}

export function formatTimeAgo(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "Never";
  const now = new Date();
  const minutes = (now.getTime() - d.getTime()) / 1000 / 60;
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
}

export function formatMarketCap(val: number): string {
  if (val >= 1e12) return `${(val / 1e12).toFixed(2)}T`;
  if (val >= 1e9) return `${(val / 1e9).toFixed(2)}B`;
  if (val >= 1e6) return `${(val / 1e6).toFixed(2)}M`;
  return val.toLocaleString();
}

export function formatVolume(val: number): string {
  if (val >= 1e9) return `${(val / 1e9).toFixed(2)}B`;
  if (val >= 1e6) return `${(val / 1e6).toFixed(1)}M`;
  if (val >= 1e3) return `${(val / 1e3).toFixed(0)}K`;
  return val.toLocaleString();
}

export function exportToCsv(data: Record<string, unknown>[], columns: string[], filename?: string) {
  const header = columns.map((col) => csvCell(formatKey(col))).join(",");
  const rows = data.map((row) =>
    columns.map((col) => csvCell(formatValue(col, row[col]))).join(",")
  );
  const csv = "\uFEFF" + [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename ?? `composer-agent-export-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Force spreadsheets to treat a CSV cell as literal text.
export function csvCell(val: string): string {
  const escaped = val.replace(/"/g, '""');
  if (/^[A-Za-z].*-/.test(val) || /^[+=@]/.test(val)) {
    return `"=""${escaped}"""`;
  }
  return `"${escaped}"`;
}
