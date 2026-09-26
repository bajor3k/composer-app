import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireAuth, getSession } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { supabase } from "@/lib/supabase";
import { upsertParticipant, type CaseRow } from "@/lib/cases";

/** List all cases — open visibility: every signed-in user sees the whole team's cases. */
export async function GET(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  const { data, error } = await supabase
    .from("cases")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("Cases list error:", error.message);
    return NextResponse.json({ error: "Failed to load cases" }, { status: 500 });
  }
  return NextResponse.json({ data: (data ?? []) as CaseRow[] });
}

interface CreateCaseBody {
  name?: string;
  accountNumber?: string;
  householdName?: string;
}

export async function POST(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;
  const limited = enforceRateLimit(request, "cases-create", 20, 60_000);
  if (limited) return limited;

  const session = getSession(request)!;
  const body = (await request.json().catch(() => ({}))) as CreateCaseBody;

  // Length-capped: these render in every client's header/sidebar, ride the shared
  // realtime channel, and (account number) feed agent queries.
  const accountNumber = typeof body.accountNumber === "string" ? body.accountNumber.trim().slice(0, 32) : "";
  const householdName = typeof body.householdName === "string" ? body.householdName.trim().slice(0, 120) : "";
  const name =
    (typeof body.name === "string" && body.name.trim().slice(0, 120)) ||
    accountNumber ||
    householdName ||
    "New Case";

  const row = {
    id: randomUUID(),
    name,
    account_number: accountNumber || null,
    household_name: householdName || null,
    created_by: session.userId,
    created_by_name: session.name,
  };

  const { data, error } = await supabase.from("cases").insert(row).select().single();
  if (error || !data) {
    console.error("Case create error:", error?.message);
    return NextResponse.json({ error: "Failed to create case" }, { status: 500 });
  }

  await upsertParticipant(data.id, { userId: session.userId, name: session.name });

  return NextResponse.json({ data: data as CaseRow });
}
