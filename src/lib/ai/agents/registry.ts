/**
 * Parses a message to check if it starts with @agentName.
 *
 * The names are lenses on the single Composer agent, not separate agents — see
 * AGENT_FOCUS in the chat route and FOCUS_HINTS in the case messages route.
 */
export function parseAgentMessage(
  message: string
): { agentName: string; query: string } | null {
  const match = message.match(/^@(\w+)\s*([\s\S]*)/);
  if (!match) return null;
  const name = match[1].toLowerCase();
  if (!["audit", "margin", "costbasis"].includes(name)) return null;
  return { agentName: name, query: match[2].trim() };
}
