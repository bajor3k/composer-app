// Number helpers shared by the engine and the UI. Kept identical to the prototype so
// reasoning strings and on-screen figures match exactly.

/** Parse to a finite number, defaulting to 0 (used for cells that may be blank). */
export const num = (v: string | number | undefined | null): number => {
  const n = parseFloat(String(v ?? ""));
  return isNaN(n) ? 0 : n;
};

/** Whole-dollar currency, e.g. $84,960. */
export const fmt$ = (n: number): string =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

/** Cents currency, e.g. $1,234.56. */
export const fmt$2 = (n: number): string =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
