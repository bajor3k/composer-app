import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

/** The current identity, for client components that need to know "who am I". */
export async function GET() {
  const session = getSession();
  return NextResponse.json({ id: session.userId, name: session.name });
}
