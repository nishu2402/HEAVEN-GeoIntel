"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";

type Theme = "dark" | "light";
interface ThemeCtx {
  theme: Theme;
  /** false during SSR + first client render; true after mount. */
  mounted: boolean;
  toggle: () => void;
  setTheme: (t: Theme) => void;
}

const Ctx = createContext<ThemeCtx>({ theme: "dark", mounted: false, toggle: () => {}, setTheme: () => {} });
const KEY = "heaven-geointel-theme";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // CRITICAL: first client render MUST equal the server render to avoid a
  // hydration mismatch. Server always renders "dark" (the layout's default
  // data-theme), so the initial state here is ALSO "dark" — no document read,
  // no localStorage read. The real persisted theme is applied after mount.
  const [theme, setThemeState] = useState<Theme>("dark");
  const [mounted, setMounted] = useState(false);

  // After mount: adopt the theme the anti-flash <head> script already set on
  // <html> (sourced from localStorage). This runs only on the client, post
  // hydration, so it can never cause a mismatch.
  useEffect(() => {
    const attr = document.documentElement.getAttribute("data-theme");
    if (attr === "light" || attr === "dark") setThemeState(attr);
    setMounted(true);
  }, []);

  // Reflect theme changes to the DOM + persist. Skip until mounted so we don't
  // clobber the pre-paint attribute before we've read it.
  useEffect(() => {
    if (!mounted) return;
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
  }, [theme, mounted]);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const toggle = useCallback(() => setThemeState((p) => (p === "dark" ? "light" : "dark")), []);

  return <Ctx.Provider value={{ theme, mounted, toggle, setTheme }}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
