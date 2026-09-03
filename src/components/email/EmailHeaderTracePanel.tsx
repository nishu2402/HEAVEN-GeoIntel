"use client";

import { useState } from "react";
import { Route, MapPin, ShieldCheck, ShieldAlert, ArrowDown, Mail } from "lucide-react";
import { analyzeHeaders, type HeaderAnalysis } from "@/lib/analysis/emailHeaders";

/**
 * Paste a raw email header block and trace the delivery path: every Received hop
 * oldest-first with its sending IP and timing, plus SPF/DKIM/DMARC verdicts. The
 * recovered origin IP hands off to IP mode. All parsing is local.
 */
export default function EmailHeaderTracePanel({ onIpLookup }: { onIpLookup?: (ip: string) => void }) {
  const [raw, setRaw] = useState("");
  const [analysis, setAnalysis] = useState<HeaderAnalysis | null>(null);

  const trace = () => setAnalysis(raw.trim() ? analyzeHeaders(raw) : null);

  const authBadge = (label: string, verdict: string | null) => {
    if (!verdict) return null;
    const pass = verdict === "pass";
    const color = pass ? "#00ff85" : "#ff4d6d";
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-mono font-bold px-2 py-0.5 rounded border tracking-widest" style={{ color, borderColor: color + "60", background: color + "14" }}>
        {pass ? <ShieldCheck className="w-3 h-3" /> : <ShieldAlert className="w-3 h-3" />} {label}: {verdict.toUpperCase()}
      </span>
    );
  };

  return (
    <div className="terminal-card p-4 space-y-3">
      <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5">
        <Route className="w-3.5 h-3.5" /> EMAIL HEADER TRACE: paste raw headers
      </div>
      <textarea
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        placeholder={"Paste the full header block (Gmail: Show original · Outlook: message details)…"}
        rows={5}
        className="w-full text-[12px] font-mono bg-[var(--hv-glass)] border border-[var(--hv-glass-border)] rounded p-2 text-[var(--hv-ink)] focus:outline-none focus:border-[var(--hv-cyan)]"
      />
      <div className="flex items-center gap-2">
        <button type="button" onClick={trace}
          className="text-[11px] font-mono uppercase tracking-widest px-3 py-1.5 rounded border border-[var(--hv-green)]/40 text-[var(--hv-green)] hover:bg-[var(--hv-green)]/10">
          Trace path
        </button>
        {analysis && (
          <button type="button" onClick={() => { setRaw(""); setAnalysis(null); }}
            className="text-[11px] font-mono uppercase tracking-widest px-3 py-1.5 rounded border border-[var(--hv-glass-border)] text-[var(--hv-ink-dim)] hover:text-[var(--hv-ink)]">
            Clear
          </button>
        )}
      </div>

      {analysis && analysis.hops.length === 0 && (
        <div className="text-[12px] font-mono text-[var(--hv-amber)]">No Received hops found: paste the full raw header block.</div>
      )}

      {analysis && analysis.hops.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {authBadge("SPF", analysis.spf)}
            {authBadge("DKIM", analysis.dkim)}
            {authBadge("DMARC", analysis.dmarc)}
          </div>

          {analysis.originIp && (
            <div className="flex items-center gap-2 flex-wrap rounded-md border border-[var(--hv-cyan)]/30 bg-[var(--hv-cyan)]/5 p-2.5">
              <MapPin className="w-3.5 h-3.5 text-[var(--hv-cyan)]" />
              <span className="text-[12px] font-mono">Origin IP: <span className="font-bold text-[var(--hv-cyan)]">{analysis.originIp}</span></span>
              {onIpLookup
                ? <button type="button" onClick={() => onIpLookup(analysis.originIp as string)} className="text-[11px] font-mono font-bold uppercase tracking-widest px-2 py-0.5 rounded border border-[var(--hv-cyan)]/50 text-[var(--hv-cyan)] hover:bg-[var(--hv-cyan)]/10">Look up as IP →</button>
                : <a href={`?mode=ip&q=${encodeURIComponent(analysis.originIp)}`} target="_blank" rel="noopener noreferrer" className="text-[11px] font-mono font-bold uppercase tracking-widest px-2 py-0.5 rounded border border-[var(--hv-cyan)]/50 text-[var(--hv-cyan)] hover:bg-[var(--hv-cyan)]/10">Look up as IP →</a>}
            </div>
          )}

          <div className="space-y-1.5">
            {analysis.hops.map((h) => (
              <div key={h.index}>
                {h.index > 0 && (
                  <div className="flex items-center gap-1 text-[10px] font-mono text-[var(--hv-ink-dim)] pl-2">
                    <ArrowDown className="w-3 h-3" />{h.delaySeconds != null ? `${h.delaySeconds}s` : "—"}
                  </div>
                )}
                <div className="rounded-md border border-[var(--hv-glass-border)] p-2.5 text-[12px] font-mono">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--hv-glass-border)] text-[var(--hv-ink-dim)]">HOP {h.index}</span>
                    {h.from && <span className="text-[var(--hv-green)]">{h.from}</span>}
                    {h.by && <><span className="text-[var(--hv-ink-dim)]">→</span><span className="text-[var(--hv-ink)]">{h.by}</span></>}
                    {h.ip && <span className="text-[var(--hv-cyan)]">[{h.ip}]</span>}
                    {h.protocol && <span className="text-[10px] text-[var(--hv-magenta)]">{h.protocol}</span>}
                  </div>
                  {h.timestamp && <div className="text-[10px] text-[var(--hv-ink-dim)] mt-1">{h.timestamp}</div>}
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 border-t border-[var(--hv-glass-border)] pt-2">
            {([["From", analysis.from], ["Subject", analysis.subject], ["Message-ID", analysis.messageId], ["Return-Path", analysis.returnPath]] as [string, string | null][])
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="flex gap-2 text-[11px] font-mono">
                  <span className="text-[var(--hv-ink-dim)] uppercase tracking-widest w-24 shrink-0 flex items-center gap-1"><Mail className="w-2.5 h-2.5" />{k}</span>
                  <span className="text-[var(--hv-ink)] break-all">{v}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
