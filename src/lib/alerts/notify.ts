/**
 * Alert delivery seam.
 *
 * In-app delivery is NOT handled here — the `alert_events` row *is* the in-app
 * delivery, and it is committed before this ever runs. This module only adds
 * channels on top, and it must never throw: an email outage cannot be allowed to
 * fail a cron sweep or roll back events the user needs to see.
 *
 * Email is deliberately unwired for now. When it is turned on, the intended shape
 * is a single plain `fetch` to the provider's REST endpoint rather than an SDK —
 * that keeps package.json untouched and keeps this swappable for Azure
 * Communication Services, which is the stated deployment end-goal. Note that
 * CLAUDE.md currently claims "Email: Resend" but no email dependency is installed;
 * that line is aspirational until the env vars below exist.
 *
 *   RESEND_API_KEY=
 *   ALERTS_FROM_EMAIL=alerts@yourdomain.com
 *
 * One digest per recipient per run — never one email per event.
 */

export interface DeliveryResult {
  channel: "in-app" | "in-app+email";
  emailed: number;
  skipped: number;
}

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.ALERTS_FROM_EMAIL);
}

/**
 * @param eventCount how many events the sweep just wrote (already in-app).
 */
export async function deliverEvents(eventCount: number): Promise<DeliveryResult> {
  if (eventCount === 0) return { channel: "in-app", emailed: 0, skipped: 0 };

  if (!emailConfigured()) {
    console.info(
      `[alerts] email not configured — ${eventCount} event(s) delivered in-app only`,
    );
    return { channel: "in-app", emailed: 0, skipped: eventCount };
  }

  // Intentionally not implemented yet: turning this on is a one-function change
  // plus the two env vars above. Until then the honest answer is "in-app only".
  console.info(`[alerts] email configured but not yet wired — ${eventCount} event(s) in-app only`);
  return { channel: "in-app", emailed: 0, skipped: eventCount };
}
