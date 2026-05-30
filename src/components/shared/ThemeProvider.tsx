"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";

type Theme = "dark" | "light";
interface ThemeCtx { theme: Theme; toggle: () => void; setTheme: (t: Theme) => void; }

const Ctx = createContext<ThemeCtx>({ theme: "dark", toggle: () => {}, setTheme: () => {} });
const KEY = "heaven-geointel-theme";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Initialise from the data-theme the anti-flash <head> script already set on
  // <html> (sourced from localStorage). Reading the DOM attribute — not
  // localStorage — in the initializer avoids a setState-in-effect and any
  // SSR/CSR hydration mismatch (the attribute is the single source of truth).
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof document !== "undefined") {
      const attr = document.documentElement.getAttribute("data-theme");
      if (attr === "light" || attr === "dark") return attr;
    }
    return "dark";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const toggle = useCallback(() => setThemeState((p) => (p === "dark" ? "light" : "dark")), []);

  return <Ctx.Provider value={{ theme, toggle, setTheme }}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
