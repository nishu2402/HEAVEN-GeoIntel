"use client";

import { useEffect, useState } from "react";
import { Database, X, CheckCircle2, ExternalLink } from "lucide-react";

interface SourceInfo {
  id: string;
  name: string;
  tier: "free" | "key";
  configured: boolean;
  unlocks: string;
  modes: string[];
  signup?: string;
}
interface SourcesResponse { sources: SourceInfo[]; keyActive: number; keyTotal: number }

function Row({ s }: { s: SourceInfo }) {
  return (
    <div className="flex items-start gap-2.5 py-2 border-b border-[var(--hv-glass-border)] last:border-b-0">
      {s.configured
        ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-[var(--hv-green)]" />
        : <span className="w-3.5 h-3.5 mt-1 shrink-0 rounded-full border border-[var(--hv-ink-dim)]" aria-hidden="true" />}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-mono font-bold text-[var(--hv-ink)]">{s.name}</span>
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--hv-ink-dim)]">{s.modes.join(" · ")}</span>
          {!s.configured && s.signup && (
            <a href={s.signup} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[10px] font-mono text-[var(--hv-cyan)] hover:underline">
              <ExternalLink className="w-2.5 h-2.5" /> free key
            </a>
          )}
        </div>
        <div className="text-[12px] font-mono text-[var(--hv-ink-dim)] leading-tight mt-0.5">{s.unlocks}</div>
      </div>
      <span className={`text-[10px] font-mono uppercase tracking-widest shrink-0 mt-0.5 ${s.configured ? "text-[var(--hv-green)]" : "text-[var(--hv-ink-dim)]"}`}>
        {s.configured ? "ON" : "OFF"}
      </span>
    </div>
  );
}

export default function SourcesPanel() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<SourcesResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || data) return;
    setLoading(true);
    fetch("/api/sources")
      .then((r) => r.json())
      .then((j: SourcesResponse) => setData(j))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, data]);

  const free = data?.sources.filter((s) => s.tier === "free") ?? [];
  const keys = data?.sources.filter((s) => s.tier === "key") ?? [];

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Data sources & API keys"
        aria-label="Data sources and API keys"
        className="p-1.5 rounded-md border border-[var(--hv-glass-border)] text-[var(--hv-ink-dim)] hover:text-[var(--hv-cyan)] hover:border-[var(--hv-glass-hi)] transition-colors"
      >
        <Database className="w-4 h-4" />
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[8vh] px-4" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/75 backdrop-blur-md" />
          <div className="glass-pop relative w-full max-w-lg rounded-xl overflow-hidden flex flex-col max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--hv-glass-border)]">
              <div className="flex items-center gap-2 text-[12px] font-mono uppercase tracking-widest text-[var(--hv-cyan)]">
                <Database className="w-4 h-4" /> Data sources &amp; keys
                {data && <span className="text-[var(--hv-ink-dim)]">· {data.keyActive}/{data.keyTotal} optional keys active</span>}
              </div>
              <button onClick={() => setOpen(false)} aria-label="Close" className="text-[var(--hv-ink-dim)] hover:text-[var(--hv-ink)]">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto p-4 space-y-4">
              {loading && <div className="text-center py-6 text-sm font-mono text-[var(--hv-ink-dim)]">Loading…</div>}
              {data && (
                <>
                  <div>
                    <div className="text-[11px] font-mono uppercase tracking-widest text-[var(--hv-green)]/60 mb-1">Always on — no key needed</div>
                    {free.map((s) => <Row key={s.id} s={s} />)}
                  </div>
                  <div>
                    <div className="text-[11px] font-mono uppercase tracking-widest text-[var(--hv-amber)]/70 mb-1">Optional API keys — add to <code>.env.local</code> to unlock</div>
                    {keys.map((s) => <Row key={s.id} s={s} />)}
                  </div>
                  <p className="text-[11px] font-mono text-[var(--hv-ink-dim)] pt-1 border-t border-[var(--hv-glass-border)]">
                    The tool works fully without any keys. Keys only add deeper enrichment — a field shown empty just means that source isn&rsquo;t configured, never that we hid data.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
