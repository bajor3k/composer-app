"use client";

import { useState, useEffect } from "react";

type Sentiment = "positive" | "neutral" | "negative";
type SentimentFilter = "all" | Sentiment;

interface Article {
  uuid: string;
  title: string;
  publisher: string;
  link: string;
  publishedAt: string | null;
  thumbnail: string | null;
  sentiment: Sentiment;
}

interface NewsTabProps {
  symbol: string;
}

const FILTERS: { key: SentimentFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "positive", label: "Positive" },
  { key: "neutral", label: "Neutral" },
  { key: "negative", label: "Negative" },
];

const SENTIMENT_STYLES: Record<Sentiment, string> = {
  positive: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-500",
  neutral: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-500",
  negative: "bg-[#FF2D2D]/10 text-[#FF2D2D]",
};

function formatDate(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const d = new Date(dateStr);
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
}

export default function NewsTab({ symbol }: NewsTabProps) {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<SentimentFilter>("all");

  useEffect(() => {
    async function fetchNews() {
      setLoading(true);
      setFilter("all");
      try {
        const res = await fetch(`/api/terminal/news?symbol=${encodeURIComponent(symbol)}`);
        if (res.ok) {
          const data = await res.json();
          setArticles(data.articles ?? []);
        }
      } catch { /* ignore */ }
      setLoading(false);
    }
    fetchNews();
  }, [symbol]);

  if (loading) {
    return (
      <div className="space-y-4" aria-hidden="true">
        <div className="flex items-center gap-1.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-6 w-16 rounded-md bg-black/[0.03] dark:bg-white/[0.03] animate-pulse" />
          ))}
        </div>
        <div className="space-y-px">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 py-3">
              <div className="h-3 flex-1 rounded bg-black/[0.03] dark:bg-white/[0.03] animate-pulse" />
              <div className="h-3 w-20 shrink-0 rounded bg-black/[0.03] dark:bg-white/[0.03] animate-pulse" />
              <div className="h-4 w-16 shrink-0 rounded bg-black/[0.03] dark:bg-white/[0.03] animate-pulse" />
              <div className="h-3 w-14 shrink-0 rounded bg-black/[0.03] dark:bg-white/[0.03] animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (articles.length === 0) {
    return <div className="text-sm text-black/30 dark:text-white/30 py-8 text-center">No recent news found</div>;
  }

  const filtered = filter === "all" ? articles : articles.filter((a) => a.sentiment === filter);

  const counts = {
    all: articles.length,
    positive: articles.filter((a) => a.sentiment === "positive").length,
    neutral: articles.filter((a) => a.sentiment === "neutral").length,
    negative: articles.filter((a) => a.sentiment === "negative").length,
  };

  return (
    <div className="space-y-4">
      {/* Sentiment Filter */}
      <div className="flex items-center gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-md text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/15 dark:focus-visible:ring-white/15 ${
              filter === f.key
                ? "font-semibold text-black dark:text-white bg-black/[0.06] dark:bg-white/[0.06]"
                : "font-medium text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white bg-black/[0.03] dark:bg-white/[0.03]"
            }`}
          >
            {f.label}
            <span className="ml-1.5 tabular-nums">{counts[f.key]}</span>
          </button>
        ))}
      </div>

      {/* Articles */}
      {filtered.length === 0 ? (
        <div className="text-sm text-black/30 dark:text-white/30 py-8 text-center">
          No {filter} articles found
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-black/5 dark:border-white/5">
                <th className="text-left px-6 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider bg-[#f2f2f2] dark:bg-[#0a0a0a] medium:bg-[#bcbcbc]">Headline</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider bg-[#f2f2f2] dark:bg-[#0a0a0a] medium:bg-[#bcbcbc]">Source</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider bg-[#f2f2f2] dark:bg-[#0a0a0a] medium:bg-[#bcbcbc]">Sentiment</th>
                <th className="text-right px-6 py-3 text-xs font-medium text-black dark:text-white uppercase tracking-wider bg-[#f2f2f2] dark:bg-[#0a0a0a] medium:bg-[#bcbcbc]">Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((article) => (
                <tr
                  key={article.uuid}
                  onClick={() => window.open(article.link, "_blank", "noopener,noreferrer")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      window.open(article.link, "_blank", "noopener,noreferrer");
                    }
                  }}
                  tabIndex={0}
                  role="link"
                  className="border-b border-black/[0.03] dark:border-white/[0.03] last:border-0 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/15 dark:focus-visible:ring-white/15"
                >
                  <td className="px-6 py-3 text-sm text-black/80 dark:text-white/80 group-hover:text-black dark:group-hover:text-white transition-colors">
                    <span className="block">{article.title}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-black/50 dark:text-white/50 whitespace-nowrap">{article.publisher}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`px-2 py-0.5 text-[10px] font-semibold uppercase rounded ${SENTIMENT_STYLES[article.sentiment]}`}>
                      {article.sentiment}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-xs text-black/40 dark:text-white/40 text-right whitespace-nowrap">
                    {article.publishedAt ? formatDate(article.publishedAt) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
