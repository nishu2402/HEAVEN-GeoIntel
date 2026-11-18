"use client";

import type { ReactNode } from "react";

// Reusable "at a glance" summary used by the phone / email / IP / domain
// dashboards. Surfaces the few answers people actually want above the long
// panel stack. Section navigation lives in <SectionRail>, which docks to the
// top of the scroll instead of riding inside this card.
export interface GlanceTile { label: ReactNode; value: string; accent?: string }

export default function GlanceCard({ tiles }: { tiles: GlanceTile[] }) {
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
    </div>
  );
}
