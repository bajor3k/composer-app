// CRM client data.
//
// NOTE ON SOURCE: the Supabase view named `crm_contacts` is NOT client data — it is a
// view over User + Advisor (the firm's advisor roster), and three of its columns call
// random() inside the view definition, so they change on every read. Real client CRM
// data lives in the "Client" table, which is what this module reads.

import { supabase } from "@/lib/supabase";
import { paginateQuery } from "@/lib/supabase-paginate";

export interface CrmAccount {
  id: string;
  accountNumber: string;
  accountType: string;
  custodian: string;
  balance: number;
}

export interface CrmClient {
  id: string;
  fullName: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  secondaryPhone: string | null;
  dateOfBirth: string | null;
  citizenshipCountry: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  employmentStatus: string | null;
  occupation: string | null;
  employer: string | null;
  annualIncome: number | null;
  netWorth: number | null;
  liquidNetWorth: number | null;
  sourceOfFunds: string | null;
  riskTolerance: string | null;
  investmentObjective: string | null;
  timeHorizon: string | null;
  liquidityNeeds: string | null;
  investmentExperience: string | null;
  trustedContactName: string | null;
  trustedContactPhone: string | null;
  trustedContactRelationship: string | null;
  onboardingStatus: string | null;
  notes: string | null;
  householdId: string | null;
  householdName: string;
  advisorName: string;
  accounts: CrmAccount[];
  accountCount: number;
  totalAum: number;
}

/**
 * Explicit column list — `ssn`, `idNumber`, `idType`, `idIssuingState` and
 * `idExpirationDate` are deliberately NEVER selected, so that PII is not shipped to the
 * browser and merely hidden client-side. `userId` and the four `wealthbox*` columns are
 * empty on every row, so they are skipped too.
 */
const CLIENT_COLUMNS =
  "id, firstName, middleName, lastName, suffix, email, phone, secondaryPhone, dateOfBirth, citizenshipCountry, address, city, state, zipCode, employmentStatus, occupation, employer, annualIncome, netWorth, liquidNetWorth, sourceOfFunds, riskTolerance, investmentObjective, timeHorizon, liquidityNeeds, investmentExperience, trustedContactName, trustedContactPhone, trustedContactRelationship, onboardingStatus, notes, householdId, advisorId";

interface DbClient {
  id: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  suffix: string | null;
  email: string | null;
  phone: string | null;
  secondaryPhone: string | null;
  dateOfBirth: string | null;
  citizenshipCountry: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  employmentStatus: string | null;
  occupation: string | null;
  employer: string | null;
  annualIncome: string | number | null;
  netWorth: string | number | null;
  liquidNetWorth: string | number | null;
  sourceOfFunds: string | null;
  riskTolerance: string | null;
  investmentObjective: string | null;
  timeHorizon: string | null;
  liquidityNeeds: string | null;
  investmentExperience: string | null;
  trustedContactName: string | null;
  trustedContactPhone: string | null;
  trustedContactRelationship: string | null;
  onboardingStatus: string | null;
  notes: string | null;
  householdId: string | null;
  advisorId: string | null;
}

interface DbAccount {
  id: string;
  clientId: string | null;
  accountNumber: string | null;
  accountType: string | null;
  custodialPlatform: string | null;
  balance: string | number | null;
}

const num = (v: string | number | null): number | null =>
  v === null || v === undefined || v === "" ? null : Number(v);

/** Advisor id → advisor name. Non-fatal: falls back to an empty map on failure. */
async function fetchAdvisorNames(): Promise<Map<string, string>> {
  try {
    const { data, error } = await supabase.from("Advisor").select("id, user:User(name)");
    if (error || !data) return new Map();
    // PostgREST types embeds as arrays (they can be one-to-many); Advisor→User is
    // many-to-one and returns a single object. Handle either shape.
    type Embedded = { name: string | null } | { name: string | null }[] | null;
    const map = new Map<string, string>();
    for (const row of data as unknown as { id: string; user: Embedded }[]) {
      const user = Array.isArray(row.user) ? row.user[0] : row.user;
      if (row.id && user?.name) map.set(row.id, user.name);
    }
    return map;
  } catch {
    return new Map();
  }
}

/** Every client with household, advisor, and their accounts rolled up. */
export async function fetchClients(): Promise<CrmClient[]> {
  const [clients, households, advisorNames, accounts] = await Promise.all([
    paginateQuery<DbClient>((from, to) =>
      supabase.from("Client").select(CLIENT_COLUMNS).range(from, to),
    ),
    paginateQuery<{ id: string; name: string | null }>((from, to) =>
      supabase.from("Household").select("id, name").range(from, to),
    ),
    fetchAdvisorNames(),
    paginateQuery<DbAccount>((from, to) =>
      supabase
        .from("Account")
        .select("id, clientId, accountNumber, accountType, custodialPlatform, balance")
        .range(from, to),
    ),
  ]);

  const householdNames = new Map(households.map((h) => [h.id, h.name ?? ""]));

  const accountsByClient = new Map<string, CrmAccount[]>();
  for (const a of accounts) {
    if (!a.clientId) continue;
    const list = accountsByClient.get(a.clientId) ?? [];
    list.push({
      id: a.id,
      accountNumber: a.accountNumber ?? "",
      accountType: a.accountType ?? "",
      custodian: a.custodialPlatform ?? "",
      balance: num(a.balance) ?? 0,
    });
    accountsByClient.set(a.clientId, list);
  }

  return clients.map((c) => {
    const clientAccounts = (accountsByClient.get(c.id) ?? []).sort(
      (a, b) => b.balance - a.balance,
    );
    const fullName = [c.firstName, c.middleName, c.lastName, c.suffix]
      .filter(Boolean)
      .join(" ");
    return {
      id: c.id,
      fullName,
      firstName: c.firstName,
      lastName: c.lastName,
      email: c.email,
      phone: c.phone,
      secondaryPhone: c.secondaryPhone,
      dateOfBirth: c.dateOfBirth,
      citizenshipCountry: c.citizenshipCountry,
      address: c.address,
      city: c.city,
      state: c.state,
      zipCode: c.zipCode,
      employmentStatus: c.employmentStatus,
      occupation: c.occupation,
      employer: c.employer,
      annualIncome: num(c.annualIncome),
      netWorth: num(c.netWorth),
      liquidNetWorth: num(c.liquidNetWorth),
      sourceOfFunds: c.sourceOfFunds,
      riskTolerance: c.riskTolerance,
      investmentObjective: c.investmentObjective,
      timeHorizon: c.timeHorizon,
      liquidityNeeds: c.liquidityNeeds,
      investmentExperience: c.investmentExperience,
      trustedContactName: c.trustedContactName,
      trustedContactPhone: c.trustedContactPhone,
      trustedContactRelationship: c.trustedContactRelationship,
      onboardingStatus: c.onboardingStatus,
      notes: c.notes,
      householdId: c.householdId,
      householdName: c.householdId ? (householdNames.get(c.householdId) ?? "") : "",
      advisorName: c.advisorId ? (advisorNames.get(c.advisorId) ?? "") : "",
      accounts: clientAccounts,
      accountCount: clientAccounts.length,
      totalAum: clientAccounts.reduce((s, a) => s + a.balance, 0),
    };
  });
}
