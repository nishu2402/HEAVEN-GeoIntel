"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ScanText, Play, Plus } from "lucide-react";
import type { EntityKind } from "@/lib/types";
import type { Mode } from "@/lib/client/modes";
import { analyzeText } from "@/lib/ai/inference";
import { insightsToEntities, summarizeInsights, runTargetFor } from "@/lib/ai/mlSignals";
import type { TextCategory } from "@/lib/ai/textAnalysis";

/**
 * AI TEXT INTEL — the on-device NLP surface (Phase 2).
 *
 * Paste any block of text (a leaked-credential paste, a threat report, an email
 * body) and the bundled, keyless model extracts every identifier it contains,
 * labels the topic, and guesses the language. Extraction is verbatim and
 * shape-checked, so each identifier is a real candidate the analyst can run as a
 * lookup or drop into the session graph in one click. Nothing is inferred about
 * any subject and nothing leaves the browser: the model ships in the app.
 */

const CATEGORY_COLOR: Record<TextCategory, string> = {
  credentials: "#ff6600",
  threat: "#ff1a1a",
  network: "#00d4ff",
  financial: "#ffaa00",
  personal: "#9acd32",
  neutral: "var(--hv-ink-dim)",
};

export default function AiTextIntel({
  onAddEntities,
  onQuickLookup,
}: {
  onAddEntities: (list: { kind: EntityKind; value: string }[]) => void;
  onQuickLookup: (mode: Mode, value: string) => void;
}) {
  const [text, setText] = useState("");
  const insights = useMemo(() => (text.trim() ? analyzeText(text) : null), [text]);
  const graphEntities = insights ? insightsToEntities(insights) : [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="terminal-card p-4 space-y-3"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-[12px] uppercase tracking-widest text-[var(--hv-cyan)]/75 flex items-center gap-1.5">
          <ScanText className="w-3.5 h-3.5" /> AI Text Intel
        </div>
        <span className="text-[10px] font-mono text-[var(--hv-ink-dim)]">on-device, keyless, grounded</span>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste text: a credential dump, a threat report, an email body… identifiers are extracted locally."
        aria-label="Text to analyze"
        rows={5}
        className="w-full resize-y rounded-md bg-[var(--hv-glass)] border border-[var(--hv-glass-border)] p-2.5 font-mono text-[12px] text-[var(--hv-ink)] placeholder:text-[var(--hv-ink-dim)] focus:outline-none focus:border-[var(--hv-cyan)]/50"
      />

      {insights && (
        <div className="space-y-3">
          {/* Topic + language badges */}
          <div className="flex flex-wrap items-center gap-1.5">
            {insights.classification.category !== "neutral" && (
              <span
                className="px-2 py-0.5 rounded text-[10px] uppercase tracking-widest font-mono"
                style={{
                  color: CATEGORY_COLOR[insights.classification.category],
                  border: `1px solid ${CATEGORY_COLOR[insights.classification.category]}55`,
                  background: `${CATEGORY_COLOR[insights.classification.category]}14`,
                }}
              >
                {insights.classification.category} · {Math.round(insights.classification.confidence * 100)}%
              </span>
            )}
            {insights.language.language !== "unknown" && (
              <span className="px-2 py-0.5 rounded text-[10px] uppercase tracking-widest font-mono text-[var(--hv-ink-dim)] border border-[var(--hv-glass-border)]">
                lang: {insights.language.language}
              </span>
            )}
          </div>

          {/* Grounded summary */}
          <div className="space-y-0.5">
            {summarizeInsights(insights).map((line, i) => (
              <p key={i} className="text-[11px] font-mono text-[var(--hv-ink-dim)] leading-snug">{line}</p>
            ))}
          </div>

          {/* Extracted identifiers */}
          {insights.entities.length === 0 ? (
            <p className="text-[11px] font-mono text-[var(--hv-ink-dim)]">No identifiers found in this text.</p>
          ) : (
            <div className="space-y-1.5">
              <div className="text-[11px] uppercase tracking-widest text-[var(--hv-ink-dim)]">
                Identifiers ({insights.entities.length})
              </div>
              {insights.entities.map((e) => {
                const target = runTargetFor(e);
                return (
                  <div key={`${e.kind}:${e.value}`} className="flex items-center gap-2">
                    <span className="text-[10px] font-mono uppercase tracking-wide text-[var(--hv-ink-dim)] w-16 shrink-0">{e.kind}</span>
                    <span className="text-[12px] font-mono text-[var(--hv-ink)] truncate min-w-0 flex-1" title={e.value}>{e.value}</span>
                    <span className="text-[10px] font-mono text-[var(--hv-ink-dim)] shrink-0">{Math.round(e.confidence * 100)}%</span>
                    <button
                      type="button"
                      onClick={() => onQuickLookup(target.mode, target.value)}
                      title={`Run ${target.mode} lookup`}
                      className="shrink-0 flex items-center gap-1 px-2 py-0.5 rounded border border-[var(--hv-glass-border)] text-[10px] font-mono text-[var(--hv-ink-dim)] hover:text-[var(--hv-green)] hover:border-[var(--hv-green)]/50 transition-colors"
                    >
                      <Play className="w-3 h-3" /> run
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {graphEntities.length > 0 && (
            <button
              type="button"
              onClick={() => onAddEntities(graphEntities)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-[var(--hv-cyan)]/40 text-[11px] font-mono text-[var(--hv-cyan)] hover:bg-[var(--hv-cyan)]/10 transition-colors"
            >
              <Plus className="w-3 h-3" /> Add {graphEntities.length} to graph
            </button>
          )}
        </div>
      )}

      <div className="text-[10px] font-mono text-[var(--hv-ink-dim)]">
        The model runs in your browser. Identifiers are matched from the text you paste, never invented; the topic and language are labels, each with a confidence.
      </div>
    </motion.div>
  );
}
