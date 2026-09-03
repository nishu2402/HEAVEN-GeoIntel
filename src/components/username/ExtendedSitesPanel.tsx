"use client";

import { useMemo, useState } from "react";
import { Globe2, ChevronRight, ChevronDown, ExternalLink } from "lucide-react";
import { extendedProfileLinks } from "@/lib/analysis/extendedProfiles";

interface Props { username: string }

/**
 * Breadth overlay: 600+ WhatsMyName sites offered as MANUAL "open to verify"
 * launch links, grouped by category and collapsed by default. Never auto-checked
 * and never claimed — the analyst opens a link and judges, so there is no
 * false-positive surface. Self-hides when there is nothing to add.
 */
export default function ExtendedSitesPanel({ username }: Props) {
  const groups = useMemo(() => extendedProfileLinks(username), [username]);
  const total = useMemo(() => groups.reduce((n, g) => n + g.sites.length, 0), [groups]);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (total === 0) return null;

  const toggleCat = (cat: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });

  return (
    <div className="terminal-card p-4 space-y-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-1.5 text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] hover:text-[var(--hv-cyan)] transition-colors"
      >
        <Globe2 className="w-3.5 h-3.5" />
        <span className="flex-1 text-left">EXTENDED SWEEP: {total} more sites · open to verify</span>
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
      </button>

      {open && (
        <>
          <div className="space-y-1.5">
            {groups.map((g) => {
              const isOpen = expanded.has(g.category);
              return (
                <div key={g.category} className="rounded-md border border-[var(--hv-glass-border)]">
                  <button
                    type="button"
                    onClick={() => toggleCat(g.category)}
                    className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-mono uppercase tracking-widest text-[var(--hv-ink)] hover:text-[var(--hv-cyan)] transition-colors"
                  >
                    {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    <span className="flex-1 text-left">{g.category}</span>
                    <span className="text-[var(--hv-ink-dim)]">{g.sites.length}</span>
                  </button>
                  {isOpen && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 p-2 pt-0">
                      {g.sites.map((s) => (
                        <a key={s.name} href={s.url} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1.5 px-2 py-1.5 rounded border border-transparent hover:border-[var(--hv-glass-hi)] transition-all">
                          <ExternalLink className="w-3 h-3 shrink-0 text-[var(--hv-cyan)]" />
                          <span className="text-[11px] font-mono text-[var(--hv-ink)] break-all">{s.name}</span>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-[10px] font-mono text-[var(--hv-ink-dim)] pt-1 leading-snug">
            Sites from <a href="https://github.com/WebBreacher/WhatsMyName" target="_blank" rel="noopener noreferrer" className="text-[var(--hv-cyan)] hover:underline">WhatsMyName</a> (CC BY-SA 4.0). These are manual launch links: presence is never auto-claimed, so open one to confirm.
          </p>
        </>
      )}
    </div>
  );
}
