"use client";

import { useEffect, useRef, useState } from "react";
import { History, Trash2, Smartphone, Mail, AtSign, Network, Globe } from "lucide-react";
import { getLookups, clearLookups, LOOKUPS_EVENT, type LookupItem, type LookupKind } from "@/lib/client/lookupHistory";

const ICON: Record<LookupKind, typeof Smartphone> = {
  phone: Smartphone, email: Mail, username: AtSign, ip: Network, domain: Globe,
};
const COLOR: Record<LookupKind, string> = {
  phone: "#00ff85", email: "#22d3ee", username: "#e879f9", ip: "#fb923c", domain: "#facc15",
};

/** Short relative time. `now` is passed in (set in state, never read during render). */
function timeAgo(ts: number, now: number): string {
  const s = Math.max(1, Math.floor((now - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24); if (d < 7) return `${d}d`;
  return `${Math.floor(d / 7)}w`;
}

export default function RecentLookups({ onRun }: { onRun: (kind: LookupKind, value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<LookupItem[]>([]);
  const [now, setNow] = useState(0); // set via effects/handlers: keeps render pure
  const ref = useRef<HTMLDivElement | null>(null);

  // Load + keep in sync with pushLookup/clearLookups (same tab) and other tabs.
  useEffect(() => {
    const refresh = () => { setItems(getLookups()); setNow(Date.now()); };
    refresh();
    window.addEventListener(LOOKUPS_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => { window.removeEventListener(LOOKUPS_EVENT, refresh); window.removeEventListener("storage", refresh); };
  }, []);

  // Close on outside click.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function toggle() {
    setOpen((o) => {
      const next = !o;
      if (next) { setItems(getLookups()); setNow(Date.now()); } // fresh on open
      return next;
    });
  }

  return (
    <div className="relative" ref={ref}>
      <button onClick={toggle} aria-label="Recent lookups" aria-expanded={open}
        className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-widest px-2.5 py-1.5 rounded-md border border-[var(--hv-glass-border)] text-[var(--hv-ink-dim)] hover:text-[var(--hv-cyan)] hover:border-[var(--hv-glass-hi)] transition-colors">
        <History className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">RECENT</span>
        {items.length > 0 && (
          <span className="text-[9px] leading-none px-1.5 py-0.5 rounded-full bg-[var(--hv-cyan)]/15 text-[var(--hv-cyan)] font-bold">{items.length}</span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 rounded-xl glass-pop overflow-hidden z-50 animate-[hv-pop_.14s_ease-out]">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--hv-glass-border)] bg-white/[0.02]">
            <div className="flex items-center gap-2">
              <History className="w-3.5 h-3.5 text-[var(--hv-cyan)]" />
              <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--hv-ink-dim)]">Recent lookups</span>
              {items.length > 0 && (
                <span className="text-[9px] leading-none px-1.5 py-0.5 rounded-full bg-[var(--hv-glass-border)] text-[var(--hv-ink)]">{items.length}</span>
              )}
            </div>
            {items.length > 0 && (
              <button onClick={() => clearLookups()}
                className="flex items-center gap-1 text-[9px] font-mono uppercase tracking-widest text-[var(--hv-ink-dim)] hover:text-[var(--hv-red)] transition-colors"
                aria-label="Clear history">
                <Trash2 className="w-3 h-3" /> Clear
              </button>
            )}
          </div>

          {/* Body */}
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center px-6 py-8 gap-2">
              <div className="flex items-center justify-center w-10 h-10 rounded-full border border-[var(--hv-glass-border)] bg-[var(--hv-cyan)]/5">
                <History className="w-4 h-4 text-[var(--hv-ink-dim)]" />
              </div>
              <div className="text-xs font-mono text-[var(--hv-ink)]">No lookups yet</div>
              <div className="text-[10px] font-mono text-[var(--hv-ink-dim)] leading-relaxed">
                Run a phone, email, username,<br />IP or domain search: it lands here.
              </div>
            </div>
          ) : (
            <div className="max-h-[22rem] overflow-y-auto p-1.5">
              {items.map((it) => {
                const Icon = ICON[it.kind];
                const c = COLOR[it.kind];
                return (
                  <button key={`${it.kind}-${it.value}`} onClick={() => { onRun(it.kind, it.value); setOpen(false); }}
                    className="group w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left hover:bg-white/[0.05] transition-colors">
                    <span className="flex items-center justify-center w-7 h-7 rounded-md shrink-0 border"
                      style={{ color: c, backgroundColor: `${c}14`, borderColor: `${c}33` }}>
                      <Icon className="w-3.5 h-3.5" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-mono text-xs text-[var(--hv-ink)] truncate group-hover:text-[var(--hv-cyan)] transition-colors">{it.value}</span>
                      <span className="block text-[9px] font-mono uppercase tracking-widest text-[var(--hv-ink-dim)]">{it.kind}</span>
                    </span>
                    {now > 0 && (
                      <span className="text-[9px] font-mono text-[var(--hv-ink-dim)] shrink-0 tabular-nums">{timeAgo(it.ts, now)}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
