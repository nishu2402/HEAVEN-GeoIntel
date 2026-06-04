"use client";

import { useEffect, useRef, useState } from "react";
import { History, Trash2, Smartphone, Mail, AtSign, Network, Globe } from "lucide-react";
import { getLookups, clearLookups, LOOKUPS_EVENT, type LookupItem, type LookupKind } from "@/lib/lookupHistory";

const ICON: Record<LookupKind, typeof Smartphone> = {
  phone: Smartphone, email: Mail, username: AtSign, ip: Network, domain: Globe,
};
const COLOR: Record<LookupKind, string> = {
  phone: "#00ff85", email: "#22d3ee", username: "#e879f9", ip: "#fb923c", domain: "#facc15",
};

export default function RecentLookups({ onRun }: { onRun: (kind: LookupKind, value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<LookupItem[]>([]);
  const ref = useRef<HTMLDivElement | null>(null);

  // Load + keep in sync with pushLookup/clearLookups (same tab) and other tabs.
  useEffect(() => {
    const refresh = () => setItems(getLookups());
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

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} aria-label="Recent lookups"
        className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-widest px-2.5 py-1.5 rounded-md border border-[var(--hv-glass-border)] text-[var(--hv-ink-dim)] hover:text-[var(--hv-cyan)] hover:border-[var(--hv-glass-hi)] transition-colors">
        <History className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">RECENT</span>
        {items.length > 0 && <span className="text-[9px] px-1 rounded bg-[var(--hv-glass-border)] text-[var(--hv-ink)]">{items.length}</span>}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-72 max-h-80 overflow-y-auto terminal-card p-2 z-50 shadow-xl">
          <div className="flex items-center justify-between px-1 pb-2 mb-1 border-b border-[var(--hv-glass-border)]">
            <span className="text-[10px] uppercase tracking-widest text-[var(--hv-ink-dim)]">Recent lookups</span>
            {items.length > 0 && (
              <button onClick={() => clearLookups()} className="text-[var(--hv-ink-dim)] hover:text-[var(--hv-red)]" aria-label="Clear history">
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <div className="text-[11px] font-mono text-[var(--hv-ink-dim)] px-1 py-2">No lookups yet. Run one and it appears here.</div>
          ) : (
            <div className="space-y-0.5">
              {items.map((it) => {
                const Icon = ICON[it.kind];
                return (
                  <button key={`${it.kind}-${it.value}`} onClick={() => { onRun(it.kind, it.value); setOpen(false); }}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left hover:bg-[var(--hv-glass-border)]/40 transition-colors">
                    <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: COLOR[it.kind] }} />
                    <span className="font-mono text-xs text-[var(--hv-ink)] truncate flex-1">{it.value}</span>
                    <span className="text-[9px] uppercase tracking-widest text-[var(--hv-ink-dim)]">{it.kind}</span>
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
