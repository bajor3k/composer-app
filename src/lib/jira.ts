import { JIRA_TEAM } from "./jira-fields";

/**
 * Jira Cloud REST v3 client. Server-side only — never import from a client component.
 *
 * The API token is a full-account credential (it can reach every project the user
 * can see), so it must not enter a browser bundle: the browser talks to
 * `/api/jira/ticket`, which talks to Atlassian. The field vocabulary the modal
 * needs lives in `lib/jira-fields.ts` precisely so nothing client-side has a
 * reason to import this file.
 *
 * Config lives in .env.local:
 *   ATLASSIAN_SITE_URL   https://<site>.atlassian.net   (no trailing /wiki)
 *   ATLASSIAN_EMAIL      the Atlassian account email
 *   ATLASSIAN_API_TOKEN  from id.atlassian.com/manage-profile/security/api-tokens
 *   JIRA_PROJECT_KEY     defaults to OPS
 */

// Composer's vocabulary → Jira's default priority scheme.
const PRIORITY_MAP: Record<string, string> = {
  Urgent: "Highest",
  High: "High",
  Medium: "Medium",
  Low: "Low",
};

export interface JiraConfig {
  site: string;
  email: string;
  token: string;
  projectKey: string;
}

export function getJiraConfig(): JiraConfig | null {
  const site = process.env.ATLASSIAN_SITE_URL?.trim().replace(/\/+$/, "");
  const email = process.env.ATLASSIAN_EMAIL?.trim();
  const token = process.env.ATLASSIAN_API_TOKEN?.trim();
  if (!site || !email || !token) return null;
  return { site, email, token, projectKey: process.env.JIRA_PROJECT_KEY?.trim() || JIRA_TEAM.key };
}

function authHeader(c: JiraConfig): string {
  return `Basic ${Buffer.from(`${c.email}:${c.token}`).toString("base64")}`;
}

/** Atlassian Document Format paragraph. */
function para(text: string) {
  return { type: "paragraph", content: text ? [{ type: "text", text }] : [] };
}

/** Bold "Label: value" line. */
function field(label: string, value: string) {
  return {
    type: "paragraph",
    content: [
      { type: "text", text: `${label}: `, marks: [{ type: "strong" }] },
      { type: "text", text: value },
    ],
  };
}

export interface TicketInput {
  accountNumber: string;
  summary: string;
  description: string;
  requestType: string;
  priority: string;
  custodian?: string;
  clientName?: string;
  comment?: string;
  /** Who filed it, from the Composer session — recorded in the issue body. */
  reporter?: string;
}

export interface JiraError {
  status: number;
  message: string;
}

/**
 * Jira surfaces validation problems as `errors` (per-field) and `errorMessages`
 * (general). Flatten both so the modal can show something actionable instead of
 * a bare 400.
 */
function readJiraError(status: number, body: unknown): JiraError {
  const b = body as { errorMessages?: string[]; errors?: Record<string, string> } | null;
  const parts = [...(b?.errorMessages ?? []), ...Object.values(b?.errors ?? {})].filter(Boolean);
  if (parts.length) return { status, message: parts.join(" · ") };
  if (status === 401 || status === 403) {
    return { status, message: "Atlassian rejected the credentials. The API token may be expired or revoked." };
  }
  return { status, message: `Jira returned ${status}.` };
}

async function call(
  c: JiraConfig,
  path: string,
  init: { method: string; body?: unknown }
): Promise<{ ok: true; data: unknown } | { ok: false; error: JiraError }> {
  let res: Response;
  try {
    res = await fetch(`${c.site}${path}`, {
      method: init.method,
      headers: {
        Authorization: authHeader(c),
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
    });
  } catch (e) {
    return { ok: false, error: { status: 502, message: `Could not reach Jira: ${(e as Error).message}` } };
  }

  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) return { ok: false, error: readJiraError(res.status, data) };
  return { ok: true, data };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 400) };
  }
}

export interface CreatedTicket {
  key: string;
  url: string;
  commentFailed?: boolean;
}

/**
 * Create the issue, then post the optional comment as a second call (Jira has no
 * create-with-comment on this endpoint). A failed comment does NOT fail the whole
 * operation — the ticket already exists by then, and reporting failure would invite
 * a duplicate-creating retry. It's flagged on the result instead.
 */
export async function createTicket(
  input: TicketInput
): Promise<{ ok: true; ticket: CreatedTicket } | { ok: false; error: JiraError }> {
  const config = getJiraConfig();
  if (!config) {
    return {
      ok: false,
      error: {
        status: 503,
        message:
          "Jira isn't configured. Set ATLASSIAN_SITE_URL, ATLASSIAN_EMAIL and ATLASSIAN_API_TOKEN in .env.local.",
      },
    };
  }

  const body: Record<string, unknown>[] = [
    field("Account", input.accountNumber),
    ...(input.clientName ? [field("Client", input.clientName)] : []),
    ...(input.custodian ? [field("Custodian", input.custodian)] : []),
    field("Request type", input.requestType),
    ...(input.reporter ? [field("Filed by", `${input.reporter} (via Composer)`)] : []),
    para(""),
    para(input.description),
  ];

  const created = await call(config, "/rest/api/3/issue", {
    method: "POST",
    body: {
      fields: {
        project: { key: config.projectKey },
        issuetype: { name: "Task" },
        summary: input.summary,
        description: { type: "doc", version: 1, content: body },
        priority: { name: PRIORITY_MAP[input.priority] ?? "Medium" },
        // Labels, not components: components must be pre-created on the project,
        // and a missing one fails the whole create. Labels are free-form and
        // remain filterable (`labels = "team-OPS"`).
        labels: [
          "composer",
          `team-${config.projectKey}`,
          `account-${input.accountNumber.replace(/[^A-Za-z0-9_-]/g, "")}`,
        ],
      },
    },
  });

  if (!created.ok) return { ok: false, error: created.error };

  const key = (created.data as { key?: string })?.key;
  if (!key) {
    return { ok: false, error: { status: 502, message: "Jira accepted the ticket but returned no issue key." } };
  }

  const ticket: CreatedTicket = { key, url: `${config.site}/browse/${key}` };

  const note = input.comment?.trim();
  if (note) {
    const commented = await call(config, `/rest/api/3/issue/${key}/comment`, {
      method: "POST",
      body: { body: { type: "doc", version: 1, content: [para(note)] } },
    });
    if (!commented.ok) ticket.commentFailed = true;
  }

  return { ok: true, ticket };
}
