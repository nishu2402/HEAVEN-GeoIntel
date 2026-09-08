"use client";

import { ScrollText } from "lucide-react";
import type { InvestigationCase } from "@/lib/types";
import { buildCaseBriefing } from "@/lib/ai/caseBriefing";

/**
 * AI CASE BRIEFING — a whole-case read-out (Phase 4).
 *
 * A one-glance summary of the case: how many identifiers of each kind it holds,
 * and what the on-device model reads from the analyst's notes. Pure and grounded
 * (see buildCaseBriefing): it counts what is pinned and reads only what is
 * written, and computes entirely in the browser.
 */
export default function CaseBriefing({ caseData }: { caseData: Pick<InvestigationCase, "entities" | "notes"> }) {
  const b = buildCaseBriefing(caseData);

  return (
    <div className="terminal-card p-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[12px] uppercase tracking-widest text-[var(--hv-cyan)]/75 flex items-center gap-1.5">
          <ScrollText className="w-3.5 h-3.5" /> AI Case Briefing
        </div>
        <span className="text-[10px] font-mono text-[var(--hv-ink-dim)]">on-device, grounded</span>
      </div>

      {b.entityCounts.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {b.entityCounts.map((c) => (
            <span
              key={c.kind}
              className="px-2 py-0.5 rounded text-[10px] uppercase tracking-widest font-mono text-[var(--hv-ink-dim)] border border-[var(--hv-glass-border)]"
            >
              {c.kind} ×{c.count}
            </span>
          ))}
        </div>
      )}

      <div className="space-y-0.5">
        {b.lines.map((line, i) => (
          <p key={i} className="text-[11px] font-mono text-[var(--hv-ink-dim)] leading-snug">{line}</p>
        ))}
      </div>
    </div>
  );
}
