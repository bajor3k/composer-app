// Minimal quote-aware CSV parser — a direct port of the prototype's parseCSV/splitLine.
// Used to turn the embedded dataset strings (and uploaded book exports) into row objects.

import type { RawRow } from "./types";

export function parseCSV(text: string): RawRow[] {
  const lines = text.trim().split(/\r?\n/);
  const head = lines[0].split(",");
  return lines
    .slice(1)
    .filter((l) => l.trim())
    .map((line) => {
      const cells = splitLine(line);
      const o: RawRow = {};
      head.forEach((h, i) => (o[h.trim()] = (cells[i] ?? "").trim()));
      return o;
    });
}

export function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      q = !q;
      continue;
    }
    if (c === "," && !q) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}
