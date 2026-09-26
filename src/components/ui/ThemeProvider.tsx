"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";

type Theme = "light" | "dark" | "medium" | "glass" | "mocha";

const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (theme: Theme) => void;
}>({
  theme: "light",
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

// Medium Mode is a standalone theme — it never co-exists with `.dark`.
// Glass Mode stacks ON TOP of `.dark` (dark surfaces + #0d0d0d body + frosted sidebar),
// so it adds the `.dark` class as well and lets every existing `dark:` style apply for free.
// Mocha Mode follows the same stack-on-`.dark` strategy as Glass: it adds `.dark` so light
// text + every `dark:` surface apply for free, then warms the palette to coffee tones and
// flips the hierarchy so the middle content section reads lighter than the sidebar/chrome.
function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark" || theme === "glass" || theme === "mocha");
  root.classList.toggle("medium", theme === "medium");
  root.classList.toggle("glass", theme === "glass");
  root.classList.toggle("mocha", theme === "mocha");
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    const stored = localStorage.getItem("composer-theme");
    if (stored === "light" || stored === "dark" || stored === "medium" || stored === "glass" || stored === "mocha") {
      setThemeState(stored);
      applyTheme(stored);
    } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      setThemeState("dark");
      applyTheme("dark");
    }
  }, []);

  // Keep every same-origin document in sync. A `storage` event fires in OTHER documents
  // (other tabs and, crucially, the canvas/page-drawer iframes) whenever the theme is
  // changed here — without this, an open launched page keeps the theme it loaded with
  // and only matches the app when they happen to agree.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== "composer-theme") return;
      const next = e.newValue;
      if (next === "light" || next === "dark" || next === "medium" || next === "glass" || next === "mocha") {
        setThemeState(next);
        applyTheme(next);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    applyTheme(next);
    localStorage.setItem("composer-theme", next);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
