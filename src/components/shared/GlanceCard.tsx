"use client";

import type { ReactNode } from "react";

// Reusable "at a glance" summary + section-jump nav, used by the email / IP /
// domain dashboards (the phone dashboard has its own green-themed inline copy).
// Surfaces the few answers people actually want above the long panel stack.
export interface GlanceTile { label: ReactNode; value: string; accent?: string }
export interface JumpItem { id: string; label: string }

export default function GlanceCard({ tiles, jump }: { tiles: GlanceTile[]; jump?: JumpItem[] }) {
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  return (
    <div className="terminal-card p-4 space-y-3">
      <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] border-b border-[var(--hv-glass-border)] pb-2">[ AT A GLANCE ]</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {tiles.map((t, i) => (
          <div key={i} className="border border-[var(--hv-glass-border)] rounded px-2.5 py-2">
            <div className="text-[10px] uppercase tracking-widest text-[var(--hv-ink-dim)] font-mono">{t.label}</div>
            <div className="text-[13px] font-mono font-bold truncate mt-0.5" style={{ color: t.accent ?? "var(--hv-green)" }} title={t.value}>{t.value}</div>
          </div>
        ))}
      </div>
      {jump && jump.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--hv-glass-border)] pt-2">
          <span className="text-[11px] font-mono text-[var(--hv-ink-dim)] uppercase tracking-widest">Jump to</span>
          {jump.map((j) => (
            <button
              key={j.id}
              onClick={() => go(j.id)}
              className="text-[11px] font-mono px-2 py-0.5 rounded border border-[var(--hv-glass-border)] text-[var(--hv-ink-dim)] hover:text-[var(--hv-ink)] hover:border-[var(--hv-glass-hi)] transition-colors"
            >
              {j.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
