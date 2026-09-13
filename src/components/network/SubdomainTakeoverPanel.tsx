"use client";

import { AlertTriangle, ExternalLink, ShieldAlert } from "lucide-react";
import type { TakeoverCandidate } from "@/lib/types";

/**
 * Dangling-CNAME takeover candidates. Self-hides when there are none.
 *
 * The server already probed each host and dropped the ones serving real
 * content, so a row here is either CONFIRMED (the provider's "nothing bound
 * here" page came back, which is the takeover condition) or UNVERIFIED (nothing
 * answered at all). Those two are coloured and worded differently on purpose —
 * treating them alike is what made this panel cry wolf.
 */
export default function SubdomainTakeoverPanel({ candidates }: { candidates?: TakeoverCandidate[] }) {
  if (!candidates || candidates.length === 0) return null;
  const confirmed = candidates.filter((c) => c.verification === "unclaimed").length;
  const headline = confirmed > 0
    ? `SUBDOMAIN TAKEOVER: ${confirmed} CONFIRMED of ${candidates.length}`
    : `DANGLING CNAMES TO REVIEW: ${candidates.length}`;
  const headColor = confirmed > 0 ? "#ff4d6d" : "#fb923c";
  return (
    <div id="sec-takeover" className="terminal-card p-4 space-y-3 scroll-mt-24 border" style={{ borderColor: headColor + "50" }}>
      <div className="text-[12px] uppercase tracking-widest flex items-center gap-1.5" style={{ color: headColor }}>
        <ShieldAlert className="w-3.5 h-3.5" /> {headline}
      </div>
      <div className="space-y-2">
        {candidates.map((c) => {
          const proven = c.verification === "unclaimed";
          const color = proven ? (c.status === "vulnerable" ? "#ff4d6d" : "#fb923c") : "#8b93a7";
          return (
            <div key={`${c.name}-${c.host}`} className="rounded-md border p-3 space-y-1" style={{ borderColor: color + "50", background: color + "0d" }}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-sm font-bold text-[var(--hv-ink)] break-all">{c.name}</span>
                <span className="text-[10px] font-mono">→</span>
                <span className="font-mono text-xs text-[var(--hv-ink-dim)] break-all">{c.host}</span>
                <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded tracking-widest" style={{ color, background: color + "1a" }}>
                  {c.service} · {proven ? `${c.status.toUpperCase()} · CONFIRMED` : "UNVERIFIED"}
                </span>
              </div>
              <div className="text-[11px] font-mono text-[var(--hv-ink-dim)] leading-tight">
                {proven
                  ? <>Probed and confirmed: {c.name} serves &ldquo;{c.fingerprint}&rdquo;, so the backing resource is unclaimed and takeable.</>
                  : <>Points at {c.service} but the host answered nothing, so the resource state is unknown. Resolve it yourself and look for &ldquo;{c.fingerprint}&rdquo;.</>}
              </div>
              <a href={c.reference} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] font-mono text-[var(--hv-cyan)] hover:underline">
                <ExternalLink className="w-3 h-3" /> can-i-take-over-xyz reference
              </a>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] font-mono text-[var(--hv-ink-dim)] flex items-center gap-1.5">
        <AlertTriangle className="w-3 h-3" /> Hosts already serving content were probed and dropped. Re-check before reporting: a resource can be claimed between the scan and the report.
      </p>
    </div>
  );
}
