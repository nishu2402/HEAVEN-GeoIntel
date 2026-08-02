"use client";

import { motion } from "framer-motion";
import { GitBranch, ArrowRight } from "lucide-react";
import type { PivotSuggestion } from "@/lib/analysis/autoPivot";
import type { EntityKind } from "@/lib/types";
import type { Mode } from "@/lib/client/modes";

interface Props {
  pivots: PivotSuggestion[];
  /** Switches mode and runs the value — the same runner the command palette uses. */
  onRun: (mode: Mode, value: string) => void;
}

// Same glyph vocabulary as the mode switcher, so a pivot chip reads as "this
// will run in that tab".
const KIND_GLYPH: Record<EntityKind, string> = {
  phone: "📡",
  email: "📧",
  username: "@",
  ip: "⦿",
  domain: "🌐",
};

const KIND_LABEL: Record<EntityKind, string> = {
  phone: "Phone",
  email: "Email",
  username: "Username",
  ip: "IP",
  domain: "Domain",
};

/**
 * The identifiers this result handed us, each runnable in one click.
 *
 * Everything here came verbatim out of the result on screen — see
 * `lib/analysis/autoPivot.ts`, which refuses to synthesise or guess an
 * identifier. `confirmed` pivots (an upstream asserts the link) are separated
 * from `related` ones (a true association that still needs judgement) so the
 * distinction is visible rather than buried in a tooltip.
 */
export default function AutoPivots({ pivots, onRun }: Props) {
  if (pivots.length === 0) return null;

  const confirmed = pivots.filter((p) => p.strength === "confirmed");
  const related = pivots.filter((p) => p.strength === "related");

  const group = (list: PivotSuggestion[], heading: string, blurb: string, accent: string) =>
    list.length > 0 && (
      <div className="space-y-2">
        <div className="text-[11px] uppercase tracking-widest" style={{ color: accent }}>
          {heading} ({list.length})
        </div>
        <p className="text-[12px] font-mono text-[var(--hv-ink-dim)] leading-snug">{blurb}</p>
        <div className="flex flex-wrap gap-1.5">
          {list.map((p) => (
            <button
              key={`${p.kind}:${p.value}`}
              type="button"
              onClick={() => onRun(p.kind as Mode, p.value)}
              title={`${KIND_LABEL[p.kind]} lookup · ${p.reason}`}
              aria-label={`Run ${KIND_LABEL[p.kind]} lookup on ${p.value} — ${p.reason}`}
              className="group flex items-center gap-1.5 text-left px-2 py-1.5 rounded-md border border-[var(--hv-glass-border)] hover:border-[var(--hv-glass-hi)] transition-colors max-w-full"
            >
              <span className="text-[12px] shrink-0" aria-hidden>{KIND_GLYPH[p.kind]}</span>
              <span className="min-w-0">
                <span className="block text-[12px] font-mono text-[var(--hv-ink)] truncate">{p.value}</span>
                <span className="block text-[10px] font-mono text-[var(--hv-ink-dim)] truncate">{p.reason}</span>
              </span>
              <ArrowRight className="w-3 h-3 shrink-0 text-[var(--hv-ink-dim)] group-hover:text-[var(--hv-cyan)] transition-colors" />
            </button>
          ))}
        </div>
      </div>
    );

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="terminal-card p-4 space-y-4"
    >
      <div className="text-[12px] uppercase tracking-widest text-[var(--hv-cyan)]/75 flex items-center gap-1.5">
        <GitBranch className="w-3 h-3" /> AUTO-PIVOT — {pivots.length} identifier{pivots.length === 1 ? "" : "s"} this result handed us
      </div>

      {group(
        confirmed,
        "Confirmed links",
        "A source asserts these belong to the same subject. Clicking runs the matching lookup.",
        "var(--hv-green)",
      )}

      {group(
        related,
        "Related",
        "A real association that still needs your judgement — a mail host, a breached site, an infected machine.",
        "var(--hv-ink-dim)",
      )}

      <div className="text-[11px] font-mono text-[var(--hv-ink-dim)] border-t border-[var(--hv-glass-border)] pt-3">
        Every value above appeared verbatim in this result. Nothing here is guessed or
        pattern-generated, and masked values (Hudson Rock&apos;s free tier obfuscates IPs and
        logins) are excluded because they are evidence, not identifiers.
      </div>
    </motion.div>
  );
}
