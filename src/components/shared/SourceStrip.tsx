"use client";

import { CheckCircle2, XCircle, MinusCircle, CircleSlash } from "lucide-react";

export type SourceState = "ok" | "empty" | "error" | "off";

export interface SourceStat {
  source: string;
  state: SourceState;
  detail?: string;
}

// The strip renders BETWEEN panels, directly on the page background, so its
// colours come from the --hv-*-page tokens rather than the neon accents. The
// neon palette is tuned for dark glass: on the light theme's #e9edf6 paper,
// #00ff85 measures 1.1:1 and the whole strip disappears.
const META: Record<SourceState, { color: string; Icon: typeof CheckCircle2; label: string }> = {
  ok:    { color: "var(--hv-page-green)", Icon: CheckCircle2, label: "answered" },
  empty: { color: "var(--hv-page-amber)", Icon: MinusCircle,  label: "no record" },
  error: { color: "var(--hv-page-red)",   Icon: XCircle,      label: "unreachable" },
  off:   { color: "var(--hv-page-slate)", Icon: CircleSlash,  label: "no API key" },
};

/**
 * Provenance strip: shows which sources contributed to a result, whether each
 * answered, had no record, failed, or is not configured. This is the project's
 * "say where it came from / never a bare N/A" rule made visible.
 */
export default function SourceStrip({ sources, label = "Sources" }: { sources: SourceStat[]; label?: string }) {
  if (!sources.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono text-[var(--hv-ink-page-dim)] px-1">
      <span className="uppercase tracking-widest">{label}:</span>
      {sources.map((s) => {
        const m = META[s.state];
        const Icon = m.Icon;
        return (
          <span key={s.source} title={s.detail || m.label}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border"
            // color-mix rather than the old `m.color + "40"` hex-alpha trick:
            // m.color is now a var(), which cannot be string-concatenated.
            style={{ borderColor: `color-mix(in srgb, ${m.color} 45%, transparent)`, color: m.color }}>
            <Icon className="w-2.5 h-2.5" /> {s.source}
          </span>
        );
      })}
    </div>
  );
}
