"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { Mode } from "@/lib/client/modes";

// Honest progress for a running lookup. The client can't know per-source progress
// (the server fans out in parallel), so we DON'T fake an "X of N" counter — we
// show what's being queried + an elapsed timer + an indeterminate bar, so a slow
// lookup feels alive instead of frozen. No fabricated numbers.
const LABEL: Partial<Record<Mode, string>> = {
  phone: "Analysing the number and querying breach + infostealer sources…",
  email: "Checking breach databases, reputation and deliverability…",
  username: "Scanning 29 sites in parallel for this handle…",
  ip: "Resolving geolocation, ASN, open ports and threat intel…",
  domain: "Resolving DNS, WHOIS, subdomains and email-security posture…",
};

export default function ScanProgress({ mode }: { mode: Mode }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 250);
    return () => clearInterval(id);
  }, [mode]);

  return (
    <div className="terminal-card p-4 mt-6 space-y-2" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[12px] font-mono text-[var(--hv-cyan)] uppercase tracking-widest">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          {LABEL[mode] ?? "Working…"}
        </div>
        <span className="text-[11px] font-mono text-[var(--hv-ink-dim)] shrink-0 tabular-nums">{elapsed}s</span>
      </div>
      {/* Indeterminate sweep — honest "still working", not a fake percentage */}
      <div className="w-full h-1 bg-[var(--hv-glass-border)] rounded overflow-hidden">
        <div className="h-full w-1/3 rounded hv-scan-sweep" style={{ background: "linear-gradient(90deg,transparent,var(--hv-cyan),transparent)" }} />
      </div>
      {elapsed >= 8 && (
        <div className="text-[11px] font-mono text-[var(--hv-ink-dim)]">
          Some free sources are slow or rate-limit bots — hang tight, results stream in as each responds.
        </div>
      )}
    </div>
  );
}
