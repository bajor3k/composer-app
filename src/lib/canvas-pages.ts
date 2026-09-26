export interface CanvasPageConfig {
  href: string;
  name: string;
  description: string;
}

export const CANVAS_PAGES: CanvasPageConfig[] = [
  {
    href: "/communication/crm",
    name: "CRM",
    description:
      "Client directory: every client with their household, advisor, email, account count, total AUM, and onboarding status (active, in progress, prospect). Expanding a client reveals contact details and address, profile (age, citizenship, employment), financial profile (annual income, net worth, liquid net worth, source of funds), suitability (risk tolerance, investment objective, time horizon, liquidity needs, experience), trusted contact, and their linked accounts. Searchable by client name, email, phone, household, or advisor.",
  },
  {
    href: "/accounts/portfolio",
    name: "Portfolio",
    description:
      "Portfolio page showing all managed accounts with holdings, allocation charts, market values, gains/losses, and account-level details. Users can search and filter accounts by rep code, account type, and custodian.",
  },
  {
    href: "/accounts/trading",
    name: "Trade Blotter",
    description:
      "Trade blotter showing recent buy/sell orders with security names, quantities, prices, status, settlement dates, and execution details.",
  },
  {
    href: "/accounts/cash",
    name: "Cash",
    description:
      "Cash management view showing cash positions across accounts, money market balances, and available cash for trading.",
  },
  {
    href: "/accounts/households",
    name: "Households",
    description:
      "Household groupings showing aggregated account data by family/household with total AUM, account counts, and member details.",
  },
  {
    href: "/accounts/transfers",
    name: "Transfers",
    description:
      "Transfer tracking showing pending and completed account transfers, ACAT transfers, and journal entries between accounts.",
  },
  {
    href: "/accounts/retirement",
    name: "Retirement Data",
    description:
      "Retirement account data showing IRA contributions, RMD calculations, beneficiary designations, and retirement plan details.",
  },
  {
    href: "/accounts/share-class",
    name: "Share Class Analysis",
    description:
      "Lowest-cost share-class review. For each client holding it prices every eligible share class of the same fund all-in (expense ratio plus per-trade ticket charges plus asset-based platform fees) and recommends conversions, flagging tax reviews, data gaps, and ineligible positions. Two datasets: a synthetic demo and real fund data extracted from SEC EDGAR 485BPOS prospectus filings.",
  },
  {
    href: "/accounts/performance",
    name: "Performance",
    description:
      "Performance reporting showing time-weighted and money-weighted returns across accounts and benchmarks over various time periods.",
  },
  {
    href: "/accounts/billing",
    name: "Billing",
    description:
      "Billing management showing fee schedules, billing groups, revenue calculations, and invoice generation for advisory fees.",
  },
];

export function getCanvasPageDescription(href: string): string | null {
  return CANVAS_PAGES.find((p) => p.href === href)?.description ?? null;
}
