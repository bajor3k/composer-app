import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

/**
 * Identity + cron authentication.
 *
 * Composer runs in demo mode: there is no sign-in. Every request acts as one fixed
 * demo advisor, so the app opens straight into the product. All client data in the
 * database is synthetic (see prisma/seed.ts).
 *
 * This file is still the single auth seam. API routes keep calling `requireAuth` and
 * `getSession`, so putting real authentication back (e.g. Microsoft Entra ID) is a
 * change to these two functions, not to the ~45 routes that use them.
 */

export interface SessionPayload {
  userId: string;
  username: string;
  name: string;
}

/** The identity every request runs as. Written into created_by / author columns. */
export const DEMO_USER: SessionPayload = {
  userId: "user_demo",
  username: "demo",
  name: "Demo User",
};

/** Returns the current identity — always the demo advisor. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getSession(_request?: NextRequest): SessionPayload {
  return DEMO_USER;
}

/**
 * Auth guard for API routes. Returns a NextResponse to short-circuit with, or null to
 * continue. In demo mode every request is allowed. Call sites use the pattern
 * `const authError = requireAuth(request); if (authError) return authError;`.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function requireAuth(_request?: NextRequest): NextResponse | null {
  return null;
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Constant-time Bearer-token check for cron endpoints. Returns null if valid,
 * or an error NextResponse otherwise. Avoids the timing-leak of `!==` on the
 * secret and centralizes the check across all cron routes.
 */
export function requireCronAuth(request: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const header = request.headers.get("authorization") || "";
  if (!safeEqual(header, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
