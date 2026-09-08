"use client";

import { motion } from "framer-motion";
import { BrainCircuit, AlertTriangle, ShieldCheck } from "lucide-react";
import { analyzeLookup, type AnalyzeInput, type RiskBand, type AnomalySeverity } from "@/lib/ai";
import AiAnalystButton from "@/components/shared/AiAnalystButton";

/**
 * AI ANALYSIS — the explainable risk read-out for a finished lookup.
 *
 * It runs the pure, deterministic analysis engine (src/lib/ai) over the result
 * already on screen and shows the score with the exact signals that produced it.
 * Nothing here is generated or invented: every factor cites the field it came
 * from, so an analyst can audit the number rather than trust it. The engine runs
 * entirely in the browser, so the assessment leaks nothing. When a local or cloud
 * model is configured (a later phase) its narrative lands in the Narrative block
 * below, grounded on this same evidence.
 */

const BAND_COLOR: Record<RiskBand, string> = {
  minimal: "#00ff41",
  low: "#9acd32",
  elevated: "#ffaa00",
  high: "#ff6600",
  critical: "#ff1a1a",
};

const SEVERITY_COLOR: Record<AnomalySeverity, string> = {
  info: "var(--hv-ink-dim)",
  warn: "#ffaa00",
  high: "#ff6600",
  critical: "#ff1a1a",
};

export default function AiAnalysisPanel({ input }: { input: AnalyzeInput }) {
  const a = analyzeLookup(input);
  const { risk } = a;
  const color = BAND_COLOR[risk.band];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="terminal-card p-4 space-y-4"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-[12px] uppercase tracking-widest text-[var(--hv-cyan)]/75 flex items-center gap-1.5">
          <BrainCircuit className="w-3.5 h-3.5" /> AI Analysis
        </div>
        <span className="text-[10px] font-mono text-[var(--hv-ink-dim)]">local, explainable, grounded</span>
      </div>

      {/* Score + band + confidence */}
      <div className="space-y-2">
        <div className="flex items-baseline gap-2">
          <span className="font-mono font-bold text-2xl leading-none" style={{ color }}>{risk.score}</span>
          <span className="text-[12px] font-mono text-[var(--hv-ink-dim)]">/100</span>
          <span
            className="ml-1 px-2 py-0.5 rounded text-[10px] uppercase tracking-widest font-mono"
            style={{ color, border: `1px solid ${color}55`, background: `${color}14` }}
          >
            {risk.band} risk
          </span>
          <span className="ml-auto text-[10px] font-mono text-[var(--hv-ink-dim)]">confidence: {risk.confidence}</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-[var(--hv-glass-border)] overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${risk.score}%`, background: color }} />
        </div>
        <p className="text-[12px] font-mono text-[var(--hv-ink-dim)] leading-snug">{risk.rationale}</p>
      </div>

      {/* Contributing factors */}
      {risk.factors.length === 0 ? (
        <div className="flex items-center gap-2 text-[12px] font-mono text-[var(--hv-green)]">
          <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
          No positive-risk signals across the sources that answered.
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-widest text-[var(--hv-ink-dim)]">
            Contributing factors ({risk.factors.length})
          </div>
          <div className="space-y-2">
            {risk.factors.map((f) => (
              <div key={f.id} className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-mono text-[var(--hv-ink)]">{f.label}</span>
                  <span className="text-[10px] font-mono text-[var(--hv-ink-dim)]">{Math.round(f.share * 100)}%</span>
                </div>
                <div className="h-1 w-full rounded-full bg-[var(--hv-glass-border)] overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${Math.round(f.share * 100)}%`, background: color }} />
                </div>
                <p className="text-[10px] font-mono text-[var(--hv-ink-dim)] leading-snug">{f.evidence}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Flagged cross-field patterns */}
      {a.anomalies.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-widest text-[var(--hv-ink-dim)]">
            Flagged patterns ({a.anomalies.length})
          </div>
          {a.anomalies.map((an) => (
            <div key={an.id} className="flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: SEVERITY_COLOR[an.severity] }} />
              <div className="min-w-0">
                <span className="block text-[12px] font-mono text-[var(--hv-ink)]">{an.title}</span>
                <span className="block text-[10px] font-mono text-[var(--hv-ink-dim)] leading-snug">{an.detail}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Grounded narrative — the model-free floor, and the slot a configured model enriches */}
      <div className="space-y-1 border-t border-[var(--hv-glass-border)] pt-3">
        <div className="text-[11px] uppercase tracking-widest text-[var(--hv-ink-dim)]">Narrative</div>
        {a.summary.map((line, i) => (
          <p key={i} className="text-[11px] font-mono text-[var(--hv-ink-dim)] leading-snug">{line}</p>
        ))}
        {/* Optional model narration, grounded on this same bundle (Phase 3). */}
        <AiAnalystButton analysis={a} />
      </div>

      <div className="text-[10px] font-mono text-[var(--hv-ink-dim)]">
        Computed in your browser from this result only. The score decomposes into the factors
        shown, and the engine asserts no fact a source did not report.
      </div>
    </motion.div>
  );
}
