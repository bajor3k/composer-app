import { DefaultAzureCredential } from "@azure/identity";

/**
 * Low-level transport for the Azure AI Foundry data plane.
 *
 * The Foundry data plane rejects api-key auth (403) — only Entra bearer tokens are
 * accepted. Locally that means `az login`; in Azure it resolves to the app's managed
 * identity. DefaultAzureCredential covers both without a code change, which is the
 * same seam `src/lib/auth.ts` will use when app auth moves to Entra ID.
 *
 * This lives apart from azure-agent.ts on purpose. `scripts/sync-foundry-agents.ts`
 * needs the transport but not the run loop, and azure-agent pulls in agent-tools →
 * @/lib/supabase, whose createClient throws at module load without env — the script
 * would die on import before it could parse a flag.
 */

const TOKEN_SCOPE = "https://ai.azure.com/.default";
const API_VERSION = "v1";

/** Refresh this far ahead of expiry so a request never races the token going stale. */
const TOKEN_LEEWAY_MS = 5 * 60_000;

let credential: DefaultAzureCredential | null = null;
let cachedToken: { token: string; expiresAt: number } | null = null;

export function projectEndpoint(): string {
  const endpoint = process.env.AZURE_AI_PROJECT_ENDPOINT;
  if (!endpoint) {
    throw new Error("AZURE_AI_PROJECT_ENDPOINT is not set");
  }
  return endpoint.replace(/\/+$/, "");
}

export async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - Date.now() > TOKEN_LEEWAY_MS) {
    return cachedToken.token;
  }
  credential ??= new DefaultAzureCredential();
  const result = await credential.getToken(TOKEN_SCOPE);
  if (!result) {
    throw new Error(
      "Azure AI token request returned no token — run `az login` locally, or assign a managed identity in Azure."
    );
  }
  cachedToken = { token: result.token, expiresAt: result.expiresOnTimestamp };
  return result.token;
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${projectEndpoint()}${path}?api-version=${API_VERSION}`, {
    method,
    headers: {
      Authorization: `Bearer ${await getToken()}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(`Azure AI ${method} ${path} failed (${response.status}): ${detail}`);
  }
  return (await response.json()) as T;
}
