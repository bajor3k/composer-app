"use client";

// The sidebar's Alerts / Reports items land here. Both start directly as a the Composer agent
// chat — the hero reads "New Alert for ___" / "New Report for ___" (ChatPage reads
// the ?new= param to enter the matching mode).
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import ChatPage from "@/app/chat/page";

function CreateInner() {
  // Re-key on ?new= so switching Alerts ↔ Reports ↔ plain chat remounts ChatPage,
  // which reads the param on mount to enter the matching mode.
  const kind = useSearchParams().get("new") ?? "chat";
  return <ChatPage key={kind} />;
}

export default function CreatePage() {
  return (
    <Suspense fallback={null}>
      <CreateInner />
    </Suspense>
  );
}
