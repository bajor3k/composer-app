import { NextRequest, NextResponse } from "next/server";

/**
 * Minimal fixed-window in-memory rate limiter.
 *
 * NOTE: on serverless this counts per-instance. With Fluid Compute (instances
 * are reused across concurrent requests) it still provides meaningful brute-force
 * / cost protection, but for hard, global guarantees use a durable store
 * (e.g. Upstash Redis) or the Vercel WAF/firewall.
 */
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const MAX_TRACKED_KEYS = 10_000;

function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    if (buckets.size > MAX_TRACKED_KEYS) {
      // Opportunistic prune of expired buckets to bound memory.
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  b.count++;
  if (b.count > limit) {
    return { ok: false, retryAfter: Math.ceil((b.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfter: 0 };
}

/** Best-effort client IP from proxy headers. */
export function clientIp(request: NextRequest): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") || "unknown";
}

/**
 * Enforce a per-IP rate limit. Returns a 429 NextResponse if exceeded, else null.
 * Usage:  const limited = enforceRateLimit(req, "login", 10, 60_000); if (limited) return limited;
 */
export function enforceRateLimit(
  request: NextRequest,
  name: string,
  limit: number,
  windowMs: number
): NextResponse | null {
  const { ok, retryAfter } = rateLimit(`${name}:${clientIp(request)}`, limit, windowMs);
  if (!ok) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }
  return null;
}
