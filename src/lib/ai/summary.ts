// ── Grounded narration — a readable summary with no model involved ───────────
//
// Turns a finished AiAnalysis into plain sentences an analyst can read at a
// glance. It is deterministic and template-driven, NOT generative: every line is
// gated on a signal, factor or anomaly that is already present, so it can never
// say more than the evidence does. When a local or cloud model is configured
// (Phase 3) it writes a richer narrative on top of this same bundle; this is the
// always-available floor that needs no model and leaks nothing.

import type { AiAnalysis } from "./index";

/** Deterministic, grounded summary lines. Never invents; never over-claims. */
export function narrate(a: AiAnalysis): string[] {
  const lines: string[] = [];
  const r = a.risk;

  if (r.factors.length === 0 && a.anomalies.length === 0) {
    lines.push(`No elevated-risk signals were found for ${a.subject} across the sources that answered.`);
  } else {
    lines.push(`${a.subject} scores ${r.score} out of 100 (${r.band} risk).`);
    if (r.factors.length > 0) {
      const n = r.factors.length;
      lines.push(`The score rests on ${n} risk ${n === 1 ? "signal" : "signals"}, chief among them:`);
      for (const f of r.factors.slice(0, 3)) {
        lines.push(`${f.label}: ${f.evidence}.`);
      }
    }
  }

  for (const an of a.anomalies) {
    lines.push(`${an.title}. ${an.detail}`);
  }

  lines.push("This assessment weighs only collected evidence and asserts nothing a source did not report.");
  return lines;
}
