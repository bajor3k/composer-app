/**
 * Shared input-sanitization helpers.
 *
 * Used anywhere untrusted text is interpolated into HTML or into a PostgREST
 * filter string. Keep these dependency-free so they can run on both the server
 * (API routes) and the client (rich-text editor).
 */

/** Escape a string for safe interpolation into an HTML text or attribute context. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Returns a safe href or null if the protocol is disallowed.
 * Allows http(s), mailto, and site-/protocol-relative links. Blocks
 * javascript:, data:, vbscript:, and anything else that can execute.
 */
export function safeHref(url: string): string | null {
  const trimmed = url.trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
  if (/^(\/\/|\/|#)/.test(trimmed)) return trimmed; // protocol-relative / site-relative / anchor
  return null;
}

/**
 * Returns a safe image src or null. Allows http(s) and base64 raster data URIs.
 * Blocks data:image/svg+xml (SVG can carry inline scripts) and all other schemes.
 */
export function safeImageSrc(url: string): string | null {
  const trimmed = url.trim();
  if (/^https?:/i.test(trimmed)) return trimmed;
  if (/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(trimmed)) return trimmed;
  return null;
}

/**
 * Strip the characters that have structural meaning inside a PostgREST `.or()`
 * filter string ( , ( ) * \ % " ) so a user-supplied search term can be safely
 * interpolated into an `ilike` value without breaking out of its condition.
 * Normal text, email (. @), and hyphen/underscore searches are preserved.
 */
export function sanitizePostgrestSearch(term: string): string {
  return term.replace(/[,()*\\%"]/g, "").trim();
}
