"use client";

import { AlertTriangle, ExternalLink, ShieldAlert } from "lucide-react";
import type { TakeoverCandidate } from "@/lib/types";

/**
 * Dangling-CNAME takeover candidates. Self-hides when there are none. Each row
 * is framed as a lead to VERIFY, not a confirmed takeover: the CNAME points at a
 * takeover-prone service, and the fingerprint is what proves the backing
 * resource is actually unclaimed.
 */
export default function SubdomainTakeoverPanel({ candidates }: { candidates?: TakeoverCandidate[] }) {
  if (!candidates || candidates.length === 0) return null;
  return (
    <div id="sec-takeover" className="terminal-card p-4 space-y-3 scroll-mt-24 border" style={{ borderColor: "#ff4d6d50" }}>
      <div className="text-[12px] uppercase tracking-widest flex items-center gap-1.5 text-[#ff4d6d]">
        <ShieldAlert className="w-3.5 h-3.5" /> SUBDOMAIN-TAKEOVER CANDIDATES: {candidates.length}
      </div>
      <div className="space-y-2">
        {candidates.map((c) => {
          const color = c.status === "vulnerable" ? "#ff4d6d" : "#fb923c";
          return (
            <div key={`${c.name}-${c.host}`} className="rounded-md border p-3 space-y-1" style={{ borderColor: color + "50", background: color + "0d" }}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-sm font-bold text-[var(--hv-ink)] break-all">{c.name}</span>
                <span className="text-[10px] font-mono">→</span>
                <span className="font-mono text-xs text-[var(--hv-ink-dim)] break-all">{c.host}</span>
                <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded tracking-widest" style={{ color, background: color + "1a" }}>
                  {c.service} · {c.status.toUpperCase()}
                </span>
              </div>
              <div className="text-[11px] font-mono text-[var(--hv-ink-dim)] leading-tight">
                Verify: load <span className="text-[var(--hv-cyan)] break-all">{c.name}</span> and look for &ldquo;{c.fingerprint}&rdquo;. If present, the resource is unclaimed and takeable.
              </div>
              <a href={c.reference} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] font-mono text-[var(--hv-cyan)] hover:underline">
                <ExternalLink className="w-3 h-3" /> can-i-take-over-xyz reference
              </a>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] font-mono text-[var(--hv-ink-dim)] flex items-center gap-1.5">
        <AlertTriangle className="w-3 h-3" /> A service match is necessary, not sufficient. Confirm with the fingerprint before reporting a takeover.
      </p>
    </div>
  );
}
