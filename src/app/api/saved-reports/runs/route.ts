import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import type { ReportRunRow } from "@/lib/reports/types";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

export async function GET(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const rawLimit = Number(searchParams.get("limit"));
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), MAX_LIMIT)
      : DEFAULT_LIMIT;

  let query = supabase
    .from("report_runs")
    .select("*")
    .order("ran_at", { ascending: false })
    .limit(limit);

  const savedId = searchParams.get("savedReportId");
  if (savedId) query = query.eq("saved_report_id", savedId);

  const status = searchParams.get("status");
  if (status === "success" || status === "error") query = query.eq("status", status);

  const { data, error } = await query;
  if (error) {
    console.error("Report runs list error:", error.message);
    return NextResponse.json({ error: "Failed to load run history" }, { status: 500 });
  }
  return NextResponse.json({ data: (data ?? []) as ReportRunRow[] });
}
