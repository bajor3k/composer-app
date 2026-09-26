"use client";

/**
 * A number that flashes when it changes.
 *
 * Two details do most of the work in making a table read as a live trading
 * screen rather than a page that happens to refresh:
 *
 *   - `tabular-nums`, so digits keep a fixed width. Without it every tick
 *     reflows the column and the whole table jitters, which instantly reads
 *     as fake.
 *   - A brief background flash on change, tinted by direction.
 *
 * The flash is driven by a `data-flash` attribute rather than a Tailwind class
 * so it introduces no new class tokens — see the note in globals.css about the
 * mocha theme's literal-token coupling.
 */

import { useEffect, useRef, useState } from "react";

const FLASH_MS = 700;

export default function LiveValue({
  value,
  format,
  className = "",
  flash = true,
  showArrow = false,
}: {
  value: number;
  format: (n: number) => string;
  className?: string;
  flash?: boolean;
  showArrow?: boolean;
}) {
  const prev = useRef<number | null>(null);
  const [dir, setDir] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    const before = prev.current;
    prev.current = value;

    // No flash on first paint — every value would light up at once.
    if (before === null || before === value || !flash) return;

    setDir(value > before ? "up" : "down");
    const t = setTimeout(() => setDir(null), FLASH_MS);
    return () => clearTimeout(t);
  }, [value, flash]);

  return (
    <span
      {...(dir ? { "data-flash": dir } : {})}
      className={`tabular-nums ${className}`}
    >
      {showArrow && value !== 0 ? (value > 0 ? "▲ " : "▼ ") : null}
      {format(value)}
    </span>
  );
}
