"use client";

import { CheckCircle2, XCircle, MinusCircle, CircleSlash } from "lucide-react";

export type SourceState = "ok" | "empty" | "error" | "off";

export interface SourceStat {
  source: string;
  state: SourceState;
  detail?: string;
}

const META: Record<SourceState, { color: string; Icon: typeof CheckCircle2; label: string }> = {
  ok:    { color: "#00ff85", Icon: CheckCircle2, label: "answered" },
  empty: { color: "#fbbf24", Icon: MinusCircle,  label: "no record" },
  error: { color: "#ff4d6d", Icon: XCircle,      label: "unreachable" },
  off:   { color: "#7a8aa0", Icon: CircleSlash,  label: "no API key" },
};

/**
 * Provenance strip: shows which sources contributed to a result, whether each
 * answered, had no record, failed, or is not configured. This is the project's
 * "say where it came from / never a bare N/A" rule made visible.
 */
export default function SourceStrip({ sources, label = "Sources" }: { sources: SourceStat[]; label?: string }) {
  if (!sources.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono text-[var(--hv-ink-dim)] px-1">
      <span className="uppercase tracking-widest">{label}:</span>
      {sources.map((s) => {
        const m = META[s.state];
        const Icon = m.Icon;
        return (
          <span key={s.source} title={s.detail || m.label}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border"
            style={{ borderColor: m.color + "40", color: m.color }}>
            <Icon className="w-2.5 h-2.5" /> {s.source}
          </span>
        );
      })}
    </div>
  );
}
