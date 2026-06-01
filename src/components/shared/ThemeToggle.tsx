"use client";

import { Sun, Moon } from "lucide-react";
import { useTheme } from "./ThemeProvider";

export default function ThemeToggle() {
  const { theme, mounted, toggle } = useTheme();

  // Until mounted, render the server-stable variant (dark icon, no theme text)
  // so the hydrated markup matches the server exactly. suppressHydrationWarning
  // belts-and-braces covers the swap on the very next client paint.
  const isDark = !mounted || theme === "dark";

  return (
    <button
      onClick={toggle}
      suppressHydrationWarning
      aria-label={`Switch to ${isDark ? "light" : "dark"} theme`}
      title={`Switch to ${isDark ? "light" : "dark"} theme`}
      className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-widest px-2.5 py-1.5 rounded-md border border-[var(--hv-glass-border)] text-[var(--hv-ink-dim)] hover:text-[var(--hv-cyan)] hover:border-[var(--hv-glass-hi)] transition-colors"
    >
      {isDark ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
      <span className="hidden sm:inline" suppressHydrationWarning>{isDark ? "DARK" : "LIGHT"}</span>
    </button>
  );
}
