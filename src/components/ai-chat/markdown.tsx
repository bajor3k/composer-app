// Lightweight markdown rendering shared by chat surfaces (side panel messages,
// case workspace thread). Supports bullet groups, **bold**, and `inline code` —
// intentionally minimal; extracted unchanged from AiChatMessage.

export function renderMarkdownContent(text: string) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let bulletGroup: React.ReactNode[] = [];

  const flushBullets = () => {
    if (bulletGroup.length > 0) {
      elements.push(
        <ul key={`ul-${elements.length}`} className="space-y-1.5 my-1">
          {bulletGroup}
        </ul>
      );
      bulletGroup = [];
    }
  };

  const inlineBold = (str: string): React.ReactNode[] => {
    const parts: React.ReactNode[] = [];
    const regex = /\*\*(.+?)\*\*/g;
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(str)) !== null) {
      if (match.index > lastIndex) parts.push(str.slice(lastIndex, match.index));
      parts.push(<strong key={match.index}>{match[1]}</strong>);
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < str.length) parts.push(str.slice(lastIndex));
    return parts;
  };

  const inlineCode = (nodes: React.ReactNode[]): React.ReactNode[] => {
    return nodes.flatMap((node, i) => {
      if (typeof node !== "string") return [node];
      const parts: React.ReactNode[] = [];
      const regex = /`([^`]+)`/g;
      let lastIndex = 0;
      let match;
      while ((match = regex.exec(node)) !== null) {
        if (match.index > lastIndex) parts.push(node.slice(lastIndex, match.index));
        parts.push(
          <code key={`code-${i}-${match.index}`} className="px-1 py-0.5 bg-black/10 dark:bg-white/10 rounded text-[11px]">
            {match[1]}
          </code>
        );
        lastIndex = regex.lastIndex;
      }
      if (lastIndex < node.length) parts.push(node.slice(lastIndex));
      return parts;
    });
  };

  const formatInline = (str: string) => inlineCode(inlineBold(str));

  lines.forEach((line, i) => {
    const bulletMatch = line.match(/^[\s]*[-•]\s+(.*)/);
    if (bulletMatch) {
      bulletGroup.push(
        <li key={`li-${i}`} className="flex gap-2 text-sm leading-relaxed">
          <span className="text-black/30 dark:text-white/30 flex-shrink-0 mt-0.5">•</span>
          <span>{formatInline(bulletMatch[1])}</span>
        </li>
      );
    } else {
      flushBullets();
      const trimmed = line.trim();
      if (trimmed === "") {
        if (elements.length > 0) elements.push(<div key={`br-${i}`} className="h-2" />);
      } else {
        elements.push(
          <p key={`p-${i}`} className="text-sm leading-relaxed">{formatInline(trimmed)}</p>
        );
      }
    }
  });

  flushBullets();

  return <div>{elements}</div>;
}
