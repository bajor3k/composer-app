"use client";

import { useState } from "react";

interface ProfileData {
  longBusinessSummary: string | null;
  sector: string | null;
  industry: string | null;
  fullTimeEmployees: number | null;
  website: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
}

export default function CompanyProfile({ profile }: { profile: ProfileData | null }) {
  if (!profile) {
    return <div className="text-sm text-black/30 dark:text-white/30 py-8 text-center">No company data available</div>;
  }

  return (
    <div className="space-y-5">
      {/* Description */}
      {profile.longBusinessSummary && (
        <AboutSection text={profile.longBusinessSummary} />
      )}

      {/* Details Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        {profile.sector && (
          <div>
            <span className="text-[10px] font-medium text-black/30 dark:text-white/30 uppercase tracking-wider">Sector</span>
            <p className="text-sm text-black/70 dark:text-white/70 mt-0.5">{profile.sector}</p>
          </div>
        )}
        {profile.industry && (
          <div>
            <span className="text-[10px] font-medium text-black/30 dark:text-white/30 uppercase tracking-wider">Industry</span>
            <p className="text-sm text-black/70 dark:text-white/70 mt-0.5">{profile.industry}</p>
          </div>
        )}
        {profile.fullTimeEmployees && (
          <div>
            <span className="text-[10px] font-medium text-black/30 dark:text-white/30 uppercase tracking-wider">Employees</span>
            <p className="text-sm text-black/70 dark:text-white/70 mt-0.5 tabular-nums">{profile.fullTimeEmployees.toLocaleString()}</p>
          </div>
        )}
        {(profile.city || profile.state) && (
          <div>
            <span className="text-[10px] font-medium text-black/30 dark:text-white/30 uppercase tracking-wider">Headquarters</span>
            <p className="text-sm text-black/70 dark:text-white/70 mt-0.5">
              {[profile.city, profile.state, profile.country].filter(Boolean).join(", ")}
            </p>
          </div>
        )}
        {profile.website && (
          <div>
            <span className="text-[10px] font-medium text-black/30 dark:text-white/30 uppercase tracking-wider">Website</span>
            <a
              href={profile.website}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-black/70 dark:text-white/70 mt-0.5 block hover:underline rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/15 dark:focus-visible:ring-white/15"
            >
              {profile.website.replace(/^https?:\/\/(www\.)?/, "")}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function AboutSection({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const words = text.split(/\s+/);
  const isLong = words.length > 75;
  const truncated = isLong ? words.slice(0, 75).join(" ") + "..." : text;

  return (
    <div>
      <h4 className="text-xs font-semibold text-black dark:text-white uppercase tracking-wider mb-2">About</h4>
      <p className="text-sm text-black/60 dark:text-white/60 leading-relaxed">
        {expanded ? text : truncated}
      </p>
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-black/40 dark:text-white/40 hover:text-black/70 dark:hover:text-white/70 mt-1.5 transition-colors rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/15 dark:focus-visible:ring-white/15"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
