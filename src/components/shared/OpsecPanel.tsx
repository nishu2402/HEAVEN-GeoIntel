"use client";

import { useState } from "react";
import { EyeOff, X, ShieldAlert, Laptop, Radio } from "lucide-react";
import { lookupOpsecProfiles, GLOBAL_OPSEC_NOTES } from "@/lib/analysis/opsec";

/**
 * Opsec disclosure — the footprint every lookup leaves, in one place. Shows the
 * instance-wide facts (server-side proxying, no subject notification, keyless
 * option) and a per-mode table of who sees your query and whether the target is
 * touched directly. Static, derived from the source manifest.
 */
export default function OpsecPanel() {
  const [open, setOpen] = useState(false);
  const profiles = lookupOpsecProfiles();

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Opsec: what does a lookup expose?"
        aria-label="Opsec: what does a lookup expose?"
        className="p-1.5 rounded-md border border-[var(--hv-glass-border)] text-[var(--hv-ink-dim)] hover:text-[var(--hv-cyan)] hover:border-[var(--hv-glass-hi)] transition-colors"
      >
        <EyeOff className="w-4 h-4" />
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[8vh] px-4" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/75 backdrop-blur-md" />
          <div className="glass-pop relative w-full max-w-lg rounded-xl overflow-hidden flex flex-col max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--hv-glass-border)]">
              <div className="flex items-center gap-2 text-[12px] font-mono uppercase tracking-widest text-[var(--hv-cyan)]">
                <EyeOff className="w-4 h-4" /> Opsec: your footprint
              </div>
              <button onClick={() => setOpen(false)} aria-label="Close" className="text-[var(--hv-ink-dim)] hover:text-[var(--hv-ink)]">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto p-4 space-y-4">
              <ul className="space-y-1.5">
                {GLOBAL_OPSEC_NOTES.map((n) => (
                  <li key={n} className="text-[12px] font-mono text-[var(--hv-ink-dim)] flex gap-2">
                    <span className="text-[var(--hv-green)] shrink-0">›</span>
                    <span>{n}</span>
                  </li>
                ))}
              </ul>

              <div>
                <div className="text-[11px] font-mono uppercase tracking-widest text-[var(--hv-green)]/60 mb-1.5">Per-mode exposure</div>
                <div className="space-y-2">
                  {profiles.map((p) => (
                    <div key={p.mode} className="rounded-md border border-[var(--hv-glass-border)] p-2.5 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[12px] font-mono font-bold text-[var(--hv-ink)] w-24 shrink-0">{p.label}</span>
                        {p.clientSide ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded border text-[var(--hv-green)]" style={{ borderColor: "#00ff8540", background: "#00ff8512" }}>
                            <Laptop className="w-3 h-3" /> in-browser
                          </span>
                        ) : p.contactsTarget ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded border text-[var(--hv-amber)]" style={{ borderColor: "var(--hv-amber)", background: "#f59e0b12" }}>
                            <ShieldAlert className="w-3 h-3" /> touches target
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded border text-[var(--hv-ink-dim)] border-[var(--hv-glass-border)]">
                            <Radio className="w-3 h-3" /> third-party only
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] font-mono text-[var(--hv-ink-dim)]">
                        <span className="text-[var(--hv-ink)]">Discloses to:</span>{" "}
                        {p.thirdParties.length > 0 ? p.thirdParties.join(" · ") : "no one: parsed locally"}
                      </div>
                      {p.targetNote && <div className="text-[11px] font-mono text-[var(--hv-amber)]">{p.targetNote}</div>}
                      <div className="text-[11px] font-mono text-[var(--hv-ink-dim)]">{p.note}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
