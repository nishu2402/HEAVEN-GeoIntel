"use client";

import { useEffect, useState } from "react";
import { Command } from "cmdk";
import {
  Search, Smartphone, Mail, AtSign, Network, Globe, Layers, Share2, FolderOpen,
  Sun, Moon, CornerDownLeft,
} from "lucide-react";
import { MODES, detectMode, type Mode } from "@/lib/modes";
import { useTheme } from "./ThemeProvider";

interface Props {
  onMode: (m: Mode) => void;
  onQuickLookup: (mode: Mode, value: string) => void;
}

const MODE_ICON: Record<Mode, React.ReactNode> = {
  phone: <Smartphone className="w-4 h-4" />,
  email: <Mail className="w-4 h-4" />,
  username: <AtSign className="w-4 h-4" />,
  ip: <Network className="w-4 h-4" />,
  domain: <Globe className="w-4 h-4" />,
  bulk: <Layers className="w-4 h-4" />,
  graph: <Share2 className="w-4 h-4" />,
  cases: <FolderOpen className="w-4 h-4" />,
};

export default function CommandPalette({ onMode, onQuickLookup }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { theme, toggle } = useTheme();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const detected = query.trim() ? detectMode(query.trim()) : null;

  function run(fn: () => void) { fn(); setOpen(false); setQuery(""); }

  return (
    <>
      {/* Trigger pill (visible in header) */}
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 text-[11px] font-mono px-2.5 py-1.5 rounded-md border border-[var(--hv-glass-border)] text-[var(--hv-ink-dim)] hover:text-[var(--hv-cyan)] hover:border-[var(--hv-glass-hi)] transition-colors"
        aria-label="Open command palette"
      >
        <Search className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Search</span>
        <kbd className="hidden sm:inline text-[10px] px-1 py-0.5 rounded bg-[var(--hv-glass-border)]">⌘K</kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4"
          onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/75 backdrop-blur-md" />
          <Command
            label="Command palette"
            className="holo relative w-full max-w-xl glass-pop rounded-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            shouldFilter={true}
          >
            <div className="flex items-center gap-2 px-4 border-b border-[var(--hv-glass-border)]">
              <Search className="w-4 h-4 text-[var(--hv-ink-dim)]" />
              <Command.Input
                autoFocus
                value={query}
                onValueChange={setQuery}
                placeholder="Type a phone / email / username / IP / domain, or a command…"
                className="flex-1 bg-transparent py-3.5 text-sm font-mono text-[var(--hv-ink)] placeholder:text-[var(--hv-ink-dim)] outline-none"
              />
              <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--hv-glass-border)] text-[var(--hv-ink-dim)]">ESC</kbd>
            </div>

            <Command.List className="max-h-[50vh] overflow-y-auto p-2">
              <Command.Empty className="py-6 text-center text-sm font-mono text-[var(--hv-ink-dim)]">
                No matches.
              </Command.Empty>

              {detected && query.trim() && (
                <Command.Group heading="Run lookup" className="text-[10px] uppercase tracking-widest text-[var(--hv-ink-dim)] px-2 py-1">
                  <Command.Item
                    value={`run ${query}`}
                    onSelect={() => run(() => onQuickLookup(detected, query.trim()))}
                    className="flex items-center gap-2.5 px-2.5 py-2.5 rounded-md text-sm font-mono text-[var(--hv-ink)] cursor-pointer data-[selected=true]:bg-[var(--hv-green)]/12 data-[selected=true]:text-[var(--hv-green)]"
                  >
                    {MODE_ICON[detected]}
                    <span className="flex-1">Search <b>{query.trim()}</b> as {detected.toUpperCase()}</span>
                    <CornerDownLeft className="w-3.5 h-3.5 text-[var(--hv-ink-dim)]" />
                  </Command.Item>
                </Command.Group>
              )}

              <Command.Group heading="Switch mode" className="text-[10px] uppercase tracking-widest text-[var(--hv-ink-dim)] px-2 py-1">
                {MODES.map((m) => (
                  <Command.Item
                    key={m.id}
                    value={`mode ${m.label}`}
                    onSelect={() => run(() => onMode(m.id))}
                    className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm font-mono text-[var(--hv-ink)] cursor-pointer data-[selected=true]:bg-[var(--hv-cyan)]/12 data-[selected=true]:text-[var(--hv-cyan)]"
                  >
                    {MODE_ICON[m.id]}
                    <span className="capitalize">{m.label.toLowerCase()}</span>
                  </Command.Item>
                ))}
              </Command.Group>

              <Command.Group heading="Appearance" className="text-[10px] uppercase tracking-widest text-[var(--hv-ink-dim)] px-2 py-1">
                <Command.Item
                  value="toggle theme dark light"
                  onSelect={() => run(toggle)}
                  className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm font-mono text-[var(--hv-ink)] cursor-pointer data-[selected=true]:bg-[var(--hv-magenta)]/12 data-[selected=true]:text-[var(--hv-magenta)]"
                >
                  {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                  Switch to {theme === "dark" ? "light" : "dark"} theme
                </Command.Item>
              </Command.Group>
            </Command.List>
          </Command>
        </div>
      )}
    </>
  );
}
