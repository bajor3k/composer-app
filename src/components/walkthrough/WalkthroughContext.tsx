"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export type WalkthroughStep = {
  target: string;      // data-walk attribute value, e.g. "reports"
  title: string;       // e.g. "Open Reports"
  description: string; // e.g. "Click Reports in the sidebar to see all available reports"
  route?: string;      // e.g. "/knowledge/reports" — used by "Take me there"
};

type WalkthroughContextType = {
  steps: WalkthroughStep[];
  currentStep: number; // -1 = inactive
  highlightTarget: string | null; // target to highlight after "Take me there" navigation
  startWalkthrough: (steps: WalkthroughStep[]) => void;
  navigateTo: (step: WalkthroughStep) => void;
  nextStep: () => void;
  dismiss: () => void;
};

const WalkthroughCtx = createContext<WalkthroughContextType | null>(null);

export function WalkthroughProvider({ children }: { children: ReactNode }) {
  const [steps, setSteps] = useState<WalkthroughStep[]>([]);
  const [currentStep, setCurrentStep] = useState(-1);
  const [highlightTarget, setHighlightTarget] = useState<string | null>(null);

  const startWalkthrough = useCallback((newSteps: WalkthroughStep[]) => {
    setHighlightTarget(null);
    setSteps(newSteps);
    setCurrentStep(0);
  }, []);

  const navigateTo = useCallback((step: WalkthroughStep) => {
    // "Take me there" mode — set highlight target; caller handles router.push()
    setSteps([]);
    setCurrentStep(-1);
    setHighlightTarget(step.target);
    // Auto-clear highlight after 4 seconds
    setTimeout(() => setHighlightTarget(null), 4000);
  }, []);

  const nextStep = useCallback(() => {
    setCurrentStep((prev) => {
      if (prev + 1 >= steps.length) {
        // Last step done — dismiss
        setSteps([]);
        return -1;
      }
      return prev + 1;
    });
  }, [steps.length]);

  const dismiss = useCallback(() => {
    setSteps([]);
    setCurrentStep(-1);
    setHighlightTarget(null);
  }, []);

  return (
    <WalkthroughCtx.Provider value={{ steps, currentStep, highlightTarget, startWalkthrough, navigateTo, nextStep, dismiss }}>
      {children}
    </WalkthroughCtx.Provider>
  );
}

export function useWalkthrough() {
  const ctx = useContext(WalkthroughCtx);
  if (!ctx) throw new Error("useWalkthrough must be used within WalkthroughProvider");
  return ctx;
}
