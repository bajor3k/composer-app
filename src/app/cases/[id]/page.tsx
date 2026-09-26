"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import CaseWorkspace from "@/components/cases/CaseWorkspace";

export default function CasePage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full">
          <div className="text-muted">Loading...</div>
        </div>
      }
    >
      <CasePageContent />
    </Suspense>
  );
}

function CasePageContent() {
  const params = useParams<{ id: string }>();
  return <CaseWorkspace caseId={params.id} />;
}
