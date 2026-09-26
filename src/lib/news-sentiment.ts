/**
 * Headline sentiment for the Terminal's news filter chips.
 *
 * Deliberately local rather than a model call. This runs on every symbol page load,
 * and an LLM round trip per load is latency and cost for a decoration — the badges
 * filter a list, they do not drive a decision. Headlines are short and formulaic,
 * which is exactly where a lexicon holds up.
 *
 * Unknown or balanced headlines fall through to "neutral", matching the previous
 * behaviour when the model call failed.
 */

export type Sentiment = "positive" | "negative" | "neutral";

const POSITIVE = [
  "beat", "beats", "tops", "surge", "surges", "soar", "soars", "rally", "rallies",
  "jump", "jumps", "climb", "climbs", "gain", "gains", "rise", "rises", "record",
  "upgrade", "upgraded", "outperform", "buy rating", "raises guidance", "raised guidance",
  "strong", "growth", "profit", "profits", "beat estimates", "above estimates",
  "expands", "expansion", "partnership", "approval", "approved", "wins", "awarded",
  "dividend increase", "buyback", "bullish", "optimistic", "milestone", "breakthrough",
];

const NEGATIVE = [
  "miss", "misses", "missed", "plunge", "plunges", "tumble", "tumbles", "slump",
  "slumps", "fall", "falls", "drop", "drops", "decline", "declines", "sink", "sinks",
  "downgrade", "downgraded", "underperform", "sell rating", "cuts guidance", "cut guidance",
  "weak", "loss", "losses", "below estimates", "misses estimates", "warns", "warning",
  "lawsuit", "sued", "probe", "investigation", "recall", "layoffs", "cuts jobs",
  "bankruptcy", "delisting", "fraud", "halt", "halted", "bearish", "concerns", "risk",
  "slowdown", "shortfall", "resigns", "steps down", "subpoena", "fine", "penalty",
];

/** Longest-first so "raises guidance" wins over "raises" and "cuts guidance" over "cuts". */
const byLength = (a: string, b: string) => b.length - a.length;
const POSITIVE_SORTED = [...POSITIVE].sort(byLength);
const NEGATIVE_SORTED = [...NEGATIVE].sort(byLength);

function score(headline: string, terms: string[]): number {
  const text = ` ${headline.toLowerCase()} `;
  let hits = 0;
  for (const term of terms) {
    // Word-boundary match so "gain" doesn't fire on "bargain".
    if (new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text)) hits++;
  }
  return hits;
}

export function classifySentiment(headline: string): Sentiment {
  if (!headline) return "neutral";
  const positive = score(headline, POSITIVE_SORTED);
  const negative = score(headline, NEGATIVE_SORTED);
  if (positive > negative) return "positive";
  if (negative > positive) return "negative";
  return "neutral";
}
