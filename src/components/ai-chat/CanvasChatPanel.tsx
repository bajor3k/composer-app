"use client";

import { useEffect, useRef } from "react";
import { useChat } from "./AiChatContext";
import AiChatMessage, { TypingIndicator } from "./AiChatMessage";
import AiChatInput from "./AiChatInput";

export default function CanvasChatPanel() {
  const {
    messages,
    isLoading,
    sendMessage,
    canvasPage,
    canvasPageName,
    canvasAccountNumber,
    canvasAccountName,
  } = useChat();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-black medium:bg-[#c2c2c2]">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 min-h-0">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-6">
            <p className="text-base text-black/50 dark:text-white/50 mb-1">Studio Mode</p>
            <h1 className="text-2xl font-bold text-black dark:text-white tracking-tight mb-2">
              How can I help you?
            </h1>
            <p className="text-xs text-black/40 dark:text-white/40 max-w-[260px]">
              {canvasAccountNumber ? (
                <>
                  Ask me anything about account{" "}
                  <span className="font-medium text-black/60 dark:text-white/60">
                    {canvasAccountNumber}
                  </span>
                  {canvasAccountName && (
                    <> — {canvasAccountName}</>
                  )}
                </>
              ) : canvasPage?.startsWith("/accounts/portfolio") ? (
                <>
                  Select an account on the{" "}
                  <span className="font-medium text-black/60 dark:text-white/60">
                    {canvasPageName}
                  </span>{" "}
                  page to get started.
                </>
              ) : (
                <>
                  Ask me anything about the{" "}
                  <span className="font-medium text-black/60 dark:text-white/60">
                    {canvasPageName}
                  </span>{" "}
                  page.
                </>
              )}
            </p>
          </div>
        ) : (
          <>
            {messages
              .filter((m) => !m.hidden)
              .map((msg) => (
                <AiChatMessage key={msg.id} message={msg} />
              ))}
            {isLoading && <TypingIndicator />}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input */}
      <AiChatInput onSend={sendMessage} disabled={isLoading} />
    </div>
  );
}
