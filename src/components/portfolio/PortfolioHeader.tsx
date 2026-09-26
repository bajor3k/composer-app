"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { type PortfolioAccount } from "./types";

export default function PortfolioHeader({
  accounts,
  selectedAccount,
  onAccountChange,
}: {
  accounts: PortfolioAccount[];
  selectedAccount: PortfolioAccount | null;
  onAccountChange: (accountId: string) => void;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Household account dropdown
  const [householdDropdownOpen, setHouseholdDropdownOpen] = useState(false);
  const householdRef = useRef<HTMLDivElement>(null);

  // Get accounts in the same household as the selected account
  const householdAccounts = selectedAccount?.household_id
    ? accounts.filter((a) => a.household_id === selectedAccount.household_id)
    : [];

  // Filter accounts based on search
  const filteredAccounts = accounts.filter((account) => {
    const query = searchQuery.toLowerCase();
    return (
      account.account_name.toLowerCase().includes(query) ||
      account.account_number.toLowerCase().includes(query) ||
      account.custodian.toLowerCase().includes(query)
    );
  }).slice(0, 50);

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setSearchOpen(false);
      }
      if (householdRef.current && !householdRef.current.contains(event.target as Node)) {
        setHouseholdDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Focus input when opening
  useEffect(() => {
    if (searchOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [searchOpen]);

  const handleSelectAccount = (accountId: string) => {
    onAccountChange(accountId);
    setSearchOpen(false);
    setSearchQuery("");
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  return (
    <div className="px-16 pt-12 pb-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-6">
          <h1 className="text-lg font-semibold text-black dark:text-white">Portfolio</h1>
          {/* Account Selector - Searchable */}
          <div ref={searchRef} className="relative">
            <button
              onClick={() => setSearchOpen(!searchOpen)}
              className="flex items-center gap-2 px-4 py-2 bg-surface dark:bg-surface-dark medium:bg-background border border-border dark:border-border-dark rounded-lg text-sm font-medium text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors min-w-[280px] text-left"
            >
              <SearchIcon className="w-4 h-4 text-muted" />
              <span className="flex-1 truncate">
                {selectedAccount ? `${selectedAccount.account_name}` : "Search accounts..."}
              </span>
              <ChevronDownIcon className="w-4 h-4 text-muted" />
            </button>

            {searchOpen && (
              <div className="absolute top-full left-0 mt-1 w-[420px] bg-white dark:bg-black medium:bg-[#c8c8c8] rounded-lg shadow-xl border border-black/10 dark:border-white/10 z-50 overflow-hidden">
                {/* Search Input */}
                <div className="p-2 border-b border-black/5 dark:border-white/5">
                  <input
                    ref={inputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by name, account #, or custodian..."
                    className="w-full px-3 py-2 bg-black/5 dark:bg-white/5 rounded-md text-sm text-black dark:text-white placeholder-black/40 dark:placeholder-white/40 outline-none"
                  />
                </div>

                {/* Results */}
                <div className="max-h-[300px] overflow-y-auto">
                  {filteredAccounts.length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm text-black/50 dark:text-white/50">
                      No accounts found
                    </div>
                  ) : (
                    filteredAccounts.map((account) => (
                      <button
                        key={account.id}
                        onClick={() => handleSelectAccount(account.id)}
                        className={`w-full px-4 py-3 text-left hover:bg-black/5 dark:hover:bg-white/5 transition-colors ${
                          selectedAccount?.id === account.id ? "bg-black/[0.07] dark:bg-white/[0.07]" : ""
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-black dark:text-white truncate">
                              {account.account_name}
                            </div>
                            <div className="text-xs text-black/50 dark:text-white/50 flex items-center gap-2 mt-0.5">
                              <span>{account.account_number}</span>
                              <span>•</span>
                              <span>{account.custodian}</span>
                            </div>
                          </div>
                          <div className="text-right ml-4">
                            <div className="text-sm font-medium text-black dark:text-white">
                              {formatCurrency(account.total_value)}
                            </div>
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                  {filteredAccounts.length === 50 && (
                    <div className="px-4 py-2 text-xs text-black/40 dark:text-white/40 text-center border-t border-black/5 dark:border-white/5">
                      Showing first 50 results. Type to narrow search.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Account Number — household dropdown when multiple accounts share a household */}
          {selectedAccount?.account_number && (
            householdAccounts.length > 1 ? (
              <div ref={householdRef} className="relative">
                <button
                  onClick={() => setHouseholdDropdownOpen(!householdDropdownOpen)}
                  className="flex items-center gap-1.5 text-base text-black dark:text-white transition-colors"
                >
                  <span>{selectedAccount.account_number}</span>
                  <ChevronDownIcon className="w-3.5 h-3.5 text-muted" />
                </button>

                {householdDropdownOpen && (
                  <div className="absolute top-full left-0 mt-1 w-[340px] bg-white dark:bg-black medium:bg-[#c8c8c8] rounded-lg shadow-xl border border-black/10 dark:border-white/10 z-50 overflow-hidden">
                    <div className="px-4 py-2.5 border-b border-black/5 dark:border-white/5">
                      <div className="text-xs font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">
                        {selectedAccount.household_name || "Household"} Accounts
                      </div>
                    </div>
                    <div className="max-h-[260px] overflow-y-auto">
                      {householdAccounts.map((account) => (
                        <button
                          key={account.id}
                          onClick={() => {
                            onAccountChange(account.id);
                            setHouseholdDropdownOpen(false);
                          }}
                          className={`w-full px-4 py-2.5 text-left hover:bg-black/5 dark:hover:bg-white/5 transition-colors ${
                            selectedAccount.id === account.id ? "bg-black/[0.07] dark:bg-white/[0.07]" : ""
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-black dark:text-white truncate">
                                {account.account_name}
                              </div>
                              <div className="text-xs text-black/50 dark:text-white/50 mt-0.5">
                                {account.account_number}
                              </div>
                            </div>
                            <div className="text-sm text-black/70 dark:text-white/70 ml-4">
                              {formatCurrency(account.total_value)}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <span className="text-base text-black dark:text-white">
                {selectedAccount.account_number}
              </span>
            )
          )}
        </div>
      </div>
    </div>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
    </svg>
  );
}

