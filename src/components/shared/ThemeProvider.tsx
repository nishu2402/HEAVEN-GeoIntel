"use client";

import { createContext, useContext, useCallback, useSyncExternalStore } from "react";

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
const THEME_EVENT = "hv-theme-changed";

// The source of truth is the <html data-theme> attribute — set pre-paint by the
// anti-flash <head> script from localStorage. We read it through
// useSyncExternalStore so the first client render matches the server-rendered
// "dark" default (getServerSnapshot), then React swaps in the real theme after
// hydration. No mount effect, no synchronous setState, no hydration mismatch.
function readTheme(): Theme {
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === "light" ? "light" : "dark";
}
function writeTheme(t: Theme): void {
  document.documentElement.setAttribute("data-theme", t);
  try { localStorage.setItem(KEY, t); } catch { /* private mode / quota */ }
  window.dispatchEvent(new CustomEvent(THEME_EVENT));
}
function subscribe(cb: () => void): () => void {
  window.addEventListener(THEME_EVENT, cb);
  window.addEventListener("storage", cb); // sync across tabs
  return () => {
    window.removeEventListener(THEME_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(subscribe, readTheme, (): Theme => "dark");
  // Flips to true on the first client commit (getServerSnapshot=false →
  // getSnapshot=true), letting consumers render the server-stable variant first.
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);

  const setTheme = useCallback((t: Theme) => writeTheme(t), []);
  const toggle = useCallback(() => writeTheme(readTheme() === "dark" ? "light" : "dark"), []);

  return <Ctx.Provider value={{ theme, mounted, toggle, setTheme }}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
