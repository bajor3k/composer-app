"use client";

import { useEffect, useState, useCallback } from "react";
import { useWalkthrough } from "./WalkthroughContext";

export default function WalkthroughOverlay() {
  const { steps, currentStep, highlightTarget, nextStep, dismiss } = useWalkthrough();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null);

  const step = currentStep >= 0 && currentStep < steps.length ? steps[currentStep] : null;

  // Find and track the target element position (walkthrough mode)
  const updatePosition = useCallback(() => {
    if (!step) { setRect(null); return; }
    const el = document.querySelector(`[data-walk="${step.target}"]`);
    if (el) {
      setRect(el.getBoundingClientRect());
    } else {
      setRect(null);
    }
  }, [step]);

  useEffect(() => {
    if (!step) { setRect(null); return; }

    // Initial position
    updatePosition();

    // Reposition on resize, scroll, and periodically (for sidebar expand/collapse)
    const interval = setInterval(updatePosition, 200);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      clearInterval(interval);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [step, updatePosition]);

  // Track highlight target position ("Take me there" mode)
  useEffect(() => {
    if (!highlightTarget) { setHighlightRect(null); return; }

    const update = () => {
      const el = document.querySelector(`[data-walk="${highlightTarget}"]`);
      if (el) {
        setHighlightRect(el.getBoundingClientRect());
      }
    };

    // Small delay to let page render after navigation
    const timeout = setTimeout(update, 300);
    const interval = setInterval(update, 200);

    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [highlightTarget]);

  // Listen for clicks on the target element
  useEffect(() => {
    if (!step) return;

    const handleClick = (e: MouseEvent) => {
      const el = document.querySelector(`[data-walk="${step.target}"]`);
      if (el && el.contains(e.target as Node)) {
        // Let the navigation happen, then advance
        setTimeout(nextStep, 100);
      }
    };

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [step, nextStep]);

  // Escape to dismiss
  useEffect(() => {
    if (currentStep < 0 && !highlightTarget) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [currentStep, highlightTarget, dismiss]);

  // ── "Take me there" highlight ring (no backdrop, just a pulsing ring) ──
  if (highlightTarget && highlightRect) {
    const pad = 8;
    return (
      <div className="fixed inset-0 z-[9999] pointer-events-none">
        <div
          className="absolute rounded-xl border-2 border-black dark:border-white animate-pulse shadow-[0_0_20px_rgba(0,0,0,0.3),0_0_40px_rgba(0,0,0,0.2)] dark:shadow-[0_0_20px_rgba(255,255,255,0.3),0_0_40px_rgba(255,255,255,0.2)]"
          style={{
            left: highlightRect.left - pad,
            top: highlightRect.top - pad,
            width: highlightRect.width + pad * 2,
            height: highlightRect.height + pad * 2,
          }}
        />
      </div>
    );
  }

  if (!step || !rect) return null;

  // Spotlight cutout dimensions (with padding)
  const pad = 6;
  const cutout = {
    x: rect.left - pad,
    y: rect.top - pad,
    w: rect.width + pad * 2,
    h: rect.height + pad * 2,
    rx: 10,
  };

  // Dot position (center-right of the element)
  const dotX = rect.right + 4;
  const dotY = rect.top + rect.height / 2;

  // Tooltip position (to the right of the dot)
  const tooltipLeft = dotX + 20;
  const tooltipTop = dotY - 20;

  return (
    <div className="fixed inset-0 z-[9999]" style={{ pointerEvents: "auto" }}>
      {/* Backdrop with spotlight cutout */}
      <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: "none" }}>
        <defs>
          <mask id="walkthrough-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            <rect
              x={cutout.x}
              y={cutout.y}
              width={cutout.w}
              height={cutout.h}
              rx={cutout.rx}
              fill="black"
            />
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.5)"
          mask="url(#walkthrough-mask)"
          style={{ pointerEvents: "auto" }}
          onClick={dismiss}
        />
      </svg>

      {/* Make the cutout area clickable (pass-through to the actual element) */}
      <div
        className="absolute rounded-[10px]"
        style={{
          left: cutout.x,
          top: cutout.y,
          width: cutout.w,
          height: cutout.h,
          pointerEvents: "none",
        }}
      />

      {/* Pulsing dot */}
      <div
        className="absolute"
        style={{
          left: dotX,
          top: dotY,
          transform: "translate(-50%, -50%)",
          pointerEvents: "none",
        }}
      >
        {/* Ping ring */}
        <div className="absolute inset-0 w-5 h-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/40 animate-ping" />
        {/* Solid dot */}
        <div className="absolute w-3 h-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-lg shadow-accent/50" />
      </div>

      {/* Tooltip card */}
      <div
        className="absolute w-64 bg-black dark:bg-white rounded-xl shadow-2xl border border-white/10 dark:border-black/10 overflow-hidden"
        style={{
          left: Math.min(tooltipLeft, window.innerWidth - 280),
          top: Math.max(8, Math.min(tooltipTop, window.innerHeight - 160)),
          pointerEvents: "auto",
        }}
      >
        <div className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-white/50 dark:text-black/50">
              Step {currentStep + 1} of {steps.length}
            </span>
            <button
              onClick={dismiss}
              className="text-white/40 dark:text-black/40 hover:text-white dark:hover:text-black transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <h3 className="text-sm font-semibold text-white dark:text-black mb-1">{step.title}</h3>
          <p className="text-xs text-white/70 dark:text-black/70 leading-relaxed">{step.description}</p>
        </div>
        <div className="px-4 pb-3 flex items-center justify-between">
          <button
            onClick={dismiss}
            className="text-xs text-white/40 dark:text-black/40 hover:text-white/70 dark:hover:text-black/70 transition-colors"
          >
            Skip
          </button>
          <button
            onClick={nextStep}
            className="px-3 py-1.5 text-xs font-medium bg-accent text-white rounded-lg hover:bg-accent/80 transition-colors"
          >
            {currentStep + 1 < steps.length ? "Next" : "Done"}
          </button>
        </div>
      </div>
    </div>
  );
}
