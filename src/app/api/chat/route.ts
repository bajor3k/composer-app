import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import type { AgentTurn as ChatMessage } from "@/lib/ai/azure-agent";
import { parseAgentMessage } from "@/lib/ai/agents/registry";
import { runAgent } from "@/lib/ai/azure-agent";
import { AGENTS_ENABLED, AGENTS_DISABLED_MESSAGE } from "@/lib/ai/foundry-client";
import type { ChatReference } from "@/components/ai-chat/types";
import { getCanvasPageDescription } from "@/lib/canvas-pages";
import { buildPortfolioCanvasContext } from "@/lib/ai/canvas-portfolio-context";
import { buildTradingCanvasContext } from "@/lib/ai/canvas-trading-context";
import { supabase } from "@/lib/supabase";


interface ChatAttachment {
  name: string;
  type: string;
  size: number;
  content: string; // base64 encoded
}

interface ChatRequest {
  message: string;
  attachments?: ChatAttachment[];
  references?: ChatReference[];
  history: ChatMessage[];
  canvasPage?: string;
  canvasPageName?: string;
  canvasAccountNumber?: string;
  accountHolder?: string; // picker-bar pre-selection (plain chat)
  accountHousehold?: string; // picker-bar household (plain chat)
  custodianHint?: string; // picker-bar custodian (color/hint only)
}

// Extract text content from base64 encoded files
function extractTextFromAttachment(attachment: ChatAttachment): string {
  // For text-based files, decode the base64 content
  if (
    attachment.type === "text/plain" ||
    attachment.type === "text/csv" ||
    attachment.type.includes("json")
  ) {
    try {
      // Cap the base64 input before decoding to bound memory use, then cap the text.
      const decoded = Buffer.from(attachment.content.slice(0, 70000), "base64").toString("utf-8");
      return `\n\n--- Content of ${attachment.name} ---\n${decoded.slice(0, 50000)}\n--- End of ${attachment.name} ---\n`;
    } catch {
      return `\n\n[Unable to read content of ${attachment.name}]\n`;
    }
  }

  // For PDFs and other documents, we'll describe them (full parsing would need additional libraries)
  if (attachment.type === "application/pdf") {
    return `\n\n[PDF Document: ${attachment.name} (${(attachment.size / 1024).toFixed(1)} KB) - PDF content extraction not yet implemented. Please describe what you'd like to know about this document.]\n`;
  }

  // For images
  if (attachment.type.startsWith("image/")) {
    return `\n\n[Image: ${attachment.name} (${(attachment.size / 1024).toFixed(1)} KB) - Image analysis not yet implemented.]\n`;
  }

  // For Office documents
  if (attachment.type.includes("spreadsheet") || attachment.type.includes("word")) {
    return `\n\n[Document: ${attachment.name} (${(attachment.size / 1024).toFixed(1)} KB) - Office document parsing not yet implemented. Please describe what you'd like to know about this document.]\n`;
  }

  return `\n\n[File: ${attachment.name} - Unable to process this file type]\n`;
}

// Render the element picker's "smart references" into a prompt block so the Composer agent
// treats the question as being about what the user pointed at on screen.
function buildReferenceContext(references: ChatReference[]): string {
  const lines = references.slice(0, 5).map((r, i) => {
    const parts = [
      `Element ${i + 1}: ${r.elementRole || r.tagName} "${r.label}"`,
      r.context ? `(${r.context})` : "",
      `on the ${r.pageName} page`,
      r.accountNumber ? `for account ${r.accountNumber}${r.accountName ? ` — ${r.accountName}` : ""}` : "",
      r.text && r.text !== r.label ? `Visible text: "${r.text.slice(0, 160)}"` : "",
    ].filter(Boolean);
    return `- ${parts.join(" ")}`;
  });
  return `[SELECTED ELEMENT CONTEXT: The user pointed at the on-screen element(s) below to reference them in this question — treat the question as being about these. You CANNOT see the page; fetch the real underlying values (via a database query or the account data provided) before answering, and never fabricate.\n${lines.join("\n")}]`;
}

/**
 * Mention aliases kept from the old per-specialty agents. One agent covers all three
 * reviews, so the mention only steers which lens it leads with. Mirrors FOCUS_HINTS in
 * the case messages route.
 */
const AGENT_FOCUS: Record<string, string> = {
  audit: "Give a full account review.",
  margin: "Lead with margin, balances, and call status.",
  costbasis: "Lead with cost basis integrity.",
};

/** Chat history in the agent's turn shape. */
function toAgentHistory(history: ChatMessage[]) {
  return history.map((m) => ({
    role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
    content: m.content,
  }));
}

/**
 * The subject the workspace is scoped to — whatever is in the household/account chips
 * above the composer.
 *
 * Rides as run CONTEXT rather than being glued onto the user's message: the runner
 * joins the two, so the user's words stay verbatim and the model isn't reading a
 * bracketed directive as something the advisor typed.
 *
 * An account carries its household when both are set, because "the household" in a
 * follow-up should still resolve when only an account chip was picked.
 */
function buildPickerContext(picked: {
  accountNumber?: string;
  accountHolder?: string;
  household?: string;
  custodian?: string;
}): string | undefined {
  if (!picked.accountNumber && !picked.household) return undefined;

  const holder = picked.accountHolder ? ` (holder ${picked.accountHolder})` : "";
  const custodian = picked.custodian ? `, custodian ${picked.custodian}` : "";
  const subject = picked.accountNumber
    ? `account ${picked.accountNumber}${holder}${picked.household ? `, in the ${picked.household} household` : ""}${custodian}`
    : `the ${picked.household} household${custodian}`;

  return (
    `The advisor is working in ${subject}. That is the DEFAULT subject of this ` +
    `conversation: when they say "this household", "this account", "the client", or ask ` +
    `something that names no subject at all, they mean this one. Never ask them to ` +
    `identify it — look it up with your tools and answer with real figures.\n\n` +
    `It is a default, not a restriction. If they name a different account, household, ` +
    `client or symbol, just answer about that one. Do not object, do not point out that ` +
    `the workspace is set to something else, and do not suggest opening a case or ` +
    `switching workspaces — this is an ordinary chat, not a case.`
  );
}

/**
 * Agent runs poll for up to RUN_TIMEOUT_MS (180s) in azure-agent.ts. Without a
 * matching platform ceiling a slow run gets killed with a generic platform error
 * instead of the handled timeout message.
 */
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const authError = requireAuth(request);
    if (authError) return authError;

    // Throttle the (expensive, agent-backed) chat endpoint per IP.
    const limited = enforceRateLimit(request, "chat", 30, 60_000);
    if (limited) return limited;

    // Every AI agent is switched off in this public copy (see foundry-client.ts).
    if (!AGENTS_ENABLED) {
      return NextResponse.json({ error: AGENTS_DISABLED_MESSAGE }, { status: 503 });
    }

    const body = (await request.json()) as ChatRequest;
    const { message, attachments, references, history = [], canvasPage, canvasPageName, canvasAccountNumber, accountHolder, accountHousehold, custodianHint } = body;

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    // Build the full message including attachment content
    let fullMessage = message.trim().slice(0, 2000);

    if (attachments && attachments.length > 0) {
      // Cap the number of attachments processed per request to bound work/memory.
      const attachmentInfo = attachments
        .slice(0, 5)
        .map((att) => extractTextFromAttachment(att))
        .join("");

      fullMessage += attachmentInfo;
    }

    // Element picker references — the user pointed at something on a page. If we can
    // tie it to an account, answer with deep account data; otherwise inject the
    // element context and let the normal pipeline handle it.
    const refList = Array.isArray(references) ? references : [];

    // The household/account chips above the composer scope the whole conversation —
    // they're the subject the user is working on, the way an open folder scopes a
    // session. Sent on every turn, so the grounding survives follow-ups like
    // "what about last quarter" that name nothing.
    const pickerContext = buildPickerContext({
      accountNumber: canvasAccountNumber,
      accountHolder,
      household: accountHousehold,
      custodian: custodianHint,
    });

    // Plain conversation goes straight to the Composer agent. The branches below add
    // page or account context first, but every one of them ends at the same agent.
    const isPlainConversation =
      !canvasPage && refList.length === 0 && !parseAgentMessage(fullMessage.trim());

    if (isPlainConversation) {
      const agentHistory = history.map((m) => ({
        role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: m.content,
      }));

      const { text, reports } = await runAgent({
        context: pickerContext,
        message: fullMessage,
        history: agentHistory,
      });

      // The agent answers in prose; rows from any report tool it called ride back
      // alongside so the UI can render the table it is describing.
      const lastReport = reports.at(-1);

      return NextResponse.json({
        message: text,
        data: lastReport?.data ?? null,
        intent: lastReport ? `workspace_agent:${lastReport.intent}` : "workspace_agent",
        timestamp: new Date().toISOString(),
      });
    }

    // (The picker-bar prefix that used to sit here was unreachable: plain chat returned
    // above before it ran, and the @agent branch below sends `question`, not
    // fullMessage, so the prefix was discarded there too. It's now `pickerContext`,
    // passed as run context to both of those paths. The canvas and reference branches
    // below build their own richer, account-specific context and are left alone.)

    if (refList.length > 0) {
      const refContext = buildReferenceContext(refList);
      const refAccountNumber = refList.find((r) => r?.accountNumber)?.accountNumber || canvasAccountNumber;

      if (refAccountNumber) {
        const portfolioContext = await buildPortfolioCanvasContext(refAccountNumber);
        if (portfolioContext) {
          const { text, reports } = await runAgent({
            context: `The user pointed at a specific element on screen. Answer about that element using the account data below, which is the source of truth for account ${portfolioContext.accountNumber} (${portfolioContext.accountName}).

${refContext}

=== ACCOUNT DATA ===
${portfolioContext.context}`,
            message: fullMessage,
            history: toAgentHistory(history),
          });

          const lastReport = reports.at(-1);
          return NextResponse.json({
            message: text,
            data: lastReport?.data ?? null,
            intent: "reference:account",
            timestamp: new Date().toISOString(),
          });
        }
      }

      // No account tie — prepend the element context and continue the normal flow.
      fullMessage = `${refContext}\n\n${fullMessage}`;
    }

    // Inject canvas page context if the user is in canvas mode
    // Skip for pages that use their own specialized deep context below
    const householdKeywordsForContext = /\b(household|all accounts|every account|across accounts|entire household|whole household|other accounts)\b/i;
    const isHouseholdQueryForContext = householdKeywordsForContext.test(message);
    const usePortfolioDeepContext = canvasPage?.startsWith("/accounts/portfolio") && canvasAccountNumber && !isHouseholdQueryForContext;
    const useTradingDeepContext = canvasPage?.startsWith("/accounts/trading");
    // Kept as its own value rather than prefixed onto the message — the agent takes a
    // separate context argument, and mangling the message also broke the @agent
    // re-parse further down.
    let canvasContext = "";
    if (canvasPage && canvasPageName && !usePortfolioDeepContext && !useTradingDeepContext) {
      const pageDesc = getCanvasPageDescription(canvasPage);
      if (pageDesc) {
        // Resolve "this household" against the account the user is looking at.
        let householdHint = "";
        if (isHouseholdQueryForContext && canvasAccountNumber) {
          const { data: acctForHousehold } = await supabase
            .from("portfolio_accounts")
            .select("household_name, account_number, account_name")
            .eq("account_number", canvasAccountNumber)
            .single();
          if (acctForHousehold?.household_name) {
            householdHint = ` They are viewing account ${acctForHousehold.account_number} (${acctForHousehold.account_name}), which belongs to "${acctForHousehold.household_name}". When they say "this household" or "the household", pass "${acctForHousehold.household_name}" as the accountNumber parameter.`;
          }
        }
        canvasContext = `=== CANVAS CONTEXT ===
The user is viewing the "${canvasPageName}" page (${canvasPage}). That page shows: ${pageDesc}.${householdHint}

You cannot see what is rendered on that page. Call run_report to fetch real data before answering anything about specific numbers, rankings, or comparisons — never infer them from the page description.`;
      }
    }

    // Portfolio canvas with specific account — use deep account context
    if (usePortfolioDeepContext) {
      const portfolioContext = await buildPortfolioCanvasContext(canvasAccountNumber);
      if (portfolioContext) {
        // Detect export requests — return structured data so download buttons appear
        const exportKeywords = /\b(excel|spreadsheet|xlsx|export|download|csv)\b/i;
        const wantsExport = exportKeywords.test(fullMessage);

        // Detect report/analysis/PDF requests
        const reportKeywords = /\b(report|analysis|pdf|financial health|overview report|portfolio report|full analysis|generate.*report|create.*report)\b/i;
        const wantsReport = reportKeywords.test(fullMessage);

        const result = await runAgent({
          context: `You are answering about account ${portfolioContext.accountNumber} (${portfolioContext.accountName}). The account data below is the source of truth — use its exact numbers and do not guess at anything it does not contain.
${wantsExport ? '\nThe user wants to export data. Reply with a brief line like "Here are the holdings for account [number]. Use the download buttons below to export." Do not render a markdown table — the download buttons are added automatically.' : ""}
${wantsReport ? "\nThe user wants a PDF report. Reply with ONLY a one-sentence confirmation such as \"Your portfolio analysis report for [account name] has been generated.\" Do not put the analysis in the chat; it is embedded in the PDF. Do not mention downloading or buttons." : ""}

=== ACCOUNT DATA ===
${portfolioContext.context}`,
          message: fullMessage,
          history: toAgentHistory(history),
        });

        // If export requested, fetch holdings as structured data for download buttons
        let exportData: Record<string, unknown>[] | null = null;
        if (wantsExport && portfolioContext.holdings) {
          exportData = portfolioContext.holdings.map((h: Record<string, unknown>) => ({
            ticker: h.symbol,
            name: h.name,
            assetClass: h.assetClass,
            shares: Number(h.quantity),
            price: Number(h.price),
            value: Number(h.marketValue),
            costBasis: h.costBasis ? Number(h.costBasis) : null,
            gainLoss: h.costBasis ? Number(h.marketValue) - Number(h.costBasis) : null,
          }));
        }

        // If report requested, build structured PDF data with a separate detailed AI analysis
        let pdfReport: Record<string, unknown> | null = null;
        if (wantsReport && portfolioContext.holdings) {
          const acct = portfolioContext.account;
          const holdingsTotal = portfolioContext.holdings.reduce((s: number, h: Record<string, unknown>) => s + (Number(h.marketValue) || 0), 0);
          const cashBal = Number(acct.cash_balance) || 0;
          const totalVal = holdingsTotal + cashBal;

          // Build asset allocation
          const allocMap = new Map<string, number>();
          for (const h of portfolioContext.holdings) {
            const cls = String(h.assetClass || "Other");
            allocMap.set(cls, (allocMap.get(cls) || 0) + (Number(h.marketValue) || 0));
          }
          const assetAllocation = Array.from(allocMap.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([assetClass, value]) => ({
              assetClass,
              value,
              weight: totalVal > 0 ? (value / totalVal) * 100 : 0,
            }));

          // The PDF narrative is a second run: the chat reply is a one-line
          // confirmation, while this is the multi-paragraph body of the document.
          const analysis = await runAgent({
            context: `=== ACCOUNT DATA ===\n${portfolioContext.context}`,
            message:
              "Write a thorough 3-5 paragraph portfolio analysis for a PDF report. Cover portfolio composition, asset allocation balance, concentration risks, gain/loss position, and notable observations. Professional and data-driven, using the exact numbers from the account data. This is the body of a document, so do not address anyone directly and do not offer follow-up questions.",
          });

          pdfReport = {
            accountNumber: portfolioContext.accountNumber,
            accountName: portfolioContext.accountName,
            accountType: String(acct.account_type || ""),
            custodian: String(acct.custodian || ""),
            clientName: String(acct.client_name || ""),
            householdName: String(acct.household_name || ""),
            totalValue: totalVal,
            cashBalance: cashBal,
            riskTolerance: String(acct.risk_tolerance || ""),
            investmentObjective: String(acct.investment_objective || ""),
            timeHorizon: String(acct.time_horizon || ""),
            holdings: portfolioContext.holdings.map((h: Record<string, unknown>) => {
              const mv = Number(h.marketValue) || 0;
              const cb = Number(h.costBasis) || 0;
              const gl = mv - cb;
              return {
                symbol: h.symbol,
                name: h.name,
                assetClass: String(h.assetClass || "Other"),
                quantity: Number(h.quantity) || 0,
                price: Number(h.price) || 0,
                marketValue: mv,
                costBasis: cb,
                gainLoss: gl,
                gainPct: cb > 0 ? (gl / cb) * 100 : 0,
                weight: totalVal > 0 ? (mv / totalVal) * 100 : 0,
              };
            }),
            assetAllocation,
            aiSummary: analysis.text,
          };
        }

        return NextResponse.json({
          message: result.text,
          // Export rows win when requested; otherwise surface any table the agent pulled.
          data: exportData ?? result.reports.at(-1)?.data ?? null,
          pdfReport,
          intent: "canvas:portfolio",
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Trade Blotter canvas — use deep trading context
    if (useTradingDeepContext) {
      const tradingContext = await buildTradingCanvasContext();
      if (tradingContext) {
        const { text, reports } = await runAgent({
          context: `You are answering about the Trade Blotter — the firm's complete trading activity. The data below is the source of truth; use its exact numbers and do not guess at anything it does not contain.

=== TRADE BLOTTER DATA ===
${tradingContext.context}`,
          message: fullMessage,
          history: toAgentHistory(history),
        });

        return NextResponse.json({
          message: text,
          data: reports.at(-1)?.data ?? null,
          intent: "canvas:trading",
          timestamp: new Date().toISOString(),
        });
      }
    }

    // @agent mentions steer which review the Composer agent leads with. The old
    // per-specialty agents were three separate legacy pipelines over the same account
    // data that account_detail already returns; the case workspace collapsed them to
    // focus hints first and this follows that.
    //
    // The sticky-session block that used to live here — replaying history to find the
    // account number for a follow-up — is gone. It existed because those agents were
    // stateless. The agent gets the thread history directly.
    const agentMatch = parseAgentMessage(fullMessage);
    if (agentMatch) {
      const focus = AGENT_FOCUS[agentMatch.agentName] ?? "";
      const question =
        [focus, agentMatch.query].filter(Boolean).join("\n\n") ||
        "Review this account and lead with anything that needs attention.";

      const { text, reports } = await runAgent({
        context: pickerContext,
        message: question,
        history: toAgentHistory(history),
      });

      return NextResponse.json({
        message: text,
        data: reports.at(-1)?.data ?? null,
        intent: `agent:${agentMatch.agentName}`,
        agent: agentMatch.agentName,
        timestamp: new Date().toISOString(),
      });
    }

    // Everything else — a generic canvas page, or a reference with no account tie.
    // The agent classifies, queries, and writes the answer in a single run via its
    // run_report tool, replacing the old classify → query → summarize round trip.
    const { text, reports } = await runAgent({
      context: canvasContext || undefined,
      message: fullMessage,
      history: toAgentHistory(history),
    });

    const lastReport = reports.at(-1);
    return NextResponse.json({
      message: text,
      data: lastReport?.data ?? null,
      intent: lastReport ? `workspace_agent:${lastReport.intent}` : "workspace_agent",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Chat API error:", error);

    // Azure credential / configuration failure
    if (error instanceof Error && error.message.includes("API key")) {
      return NextResponse.json(
        { error: "AI service is not configured. Check AZURE_AI_PROJECT_ENDPOINT and that a credential is available." },
        { status: 500 }
      );
    }

    // Check if it's a rate limit error
    if (
      error instanceof Error &&
      (error.message.includes("429") || error.message.includes("Resource exhausted"))
    ) {
      return NextResponse.json(
        { error: "AI service rate limit. ERROR CODE: 429" },
        { status: 429 }
      );
    }

    return NextResponse.json(
      { error: "An error occurred processing your request." },
      { status: 500 }
    );
  }
}
