"use client";

import { useMemo, useState } from "react";
import { Copy, Check, ExternalLink, Radar, Play, Loader2, Mail, Clock } from "lucide-react";
import { copyText } from "@/lib/utils";
import { generateTyposquats } from "@/lib/analysis/typosquat";
import type { TyposquatScanResponse } from "@/lib/types";

/**
 * Look-alike domains for the target, generated in the browser and then RESOLVED
 * on demand.
 *
 * Generating them was only half the job: the panel used to print 180 names and
 * leave the analyst to open each in a new tab, which is homework rather than a
 * finding. One click now resolves every candidate over DNS-over-HTTPS and
 * reports which exist, which accept mail, and how recently they were
 * registered — a look-alike registered last week is a live campaign, one
 * registered in 2009 is usually the brand's own defensive holding.
 *
 * It still never claims a squat is malicious. It reports DNS and RDAP facts.
 */
export default function TyposquatPanel({ domain }: { domain: string }) {
  const variants = useMemo(() => generateTyposquats(domain), [domain]);
  const [copied, setCopied] = useState(false);
  const [scan, setScan] = useState<TyposquatScanResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (variants.length === 0) return null;

  const copyAll = () => {
    void copyText(variants.map((v) => v.domain).join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const runScan = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/typosquat-scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domain }),
      });
      const json = (await res.json()) as TyposquatScanResponse & { error?: string };
      if (!res.ok) setError(json.error ?? `scan failed (HTTP ${res.status})`);
      else setScan(json);
    } catch {
      setError("the scan request failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div id="sec-typosquat" className="terminal-card p-4 space-y-3 scroll-mt-24">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5">
          <Radar className="w-3.5 h-3.5" /> LOOK-ALIKE DOMAINS: {variants.length} generated
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={runScan} disabled={busy} aria-label="Resolve every look-alike candidate"
            className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-1 rounded border border-[var(--hv-glass-border)] text-[var(--hv-green)] hover:border-[var(--hv-glass-hi)] disabled:opacity-50">
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            {busy ? "Resolving" : "Resolve all"}
          </button>
          <button type="button" onClick={copyAll} aria-label="Copy every look-alike candidate"
            className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-1 rounded border border-[var(--hv-glass-border)] text-[var(--hv-cyan)] hover:border-[var(--hv-glass-hi)]">
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} {copied ? "Copied" : "Copy all"}
          </button>
        </div>
      </div>

      {error && <p className="text-[11px] font-mono text-[#ff4d6d]">{error}</p>}

      {scan && (
        <div className="space-y-2">
          <div className="text-[11px] font-mono text-[var(--hv-ink)]">
            <span className="text-[var(--hv-green)] font-bold">{scan.resolving}</span> of {scan.checked} resolve
            {" · "}<span className="text-[#fb923c] font-bold">{scan.withMail}</span> accept mail
            {scan.unanswered > 0 && <> · {scan.unanswered} got no DNS answer (unknown, not absent)</>}
          </div>
          <div className="max-h-72 overflow-y-auto space-y-1">
            {scan.findings.map((f) => (
              <div key={f.domain} className="flex items-center gap-2 flex-wrap text-[11px] font-mono border-b border-[var(--hv-glass-border)] pb-1">
                <a href={`?mode=domain&q=${encodeURIComponent(f.domain)}`} target="_blank" rel="noopener noreferrer"
                  className="text-[var(--hv-cyan)] hover:underline">{f.display ?? f.domain}</a>
                {f.display && <span className="text-[var(--hv-ink-dim)]">({f.domain})</span>}
                <span className="text-[var(--hv-ink-dim)]">{f.technique}</span>
                {f.addresses[0] && <span className="text-[var(--hv-ink)]">{f.addresses[0]}</span>}
                {f.mx.length > 0 && (
                  <span className="text-[#fb923c] inline-flex items-center gap-1"><Mail className="w-3 h-3" />{f.mx[0]}</span>
                )}
                {f.ageDays !== null && (
                  <span className={f.ageDays < 90 ? "text-[#ff4d6d] inline-flex items-center gap-1" : "text-[var(--hv-ink-dim)] inline-flex items-center gap-1"}>
                    <Clock className="w-3 h-3" />registered {f.ageDays}d ago
                  </span>
                )}
                {f.whois?.registrar && <span className="text-[var(--hv-ink-dim)]">{f.whois.registrar}</span>}
              </div>
            ))}
          </div>
          <p className="text-[11px] font-mono text-[var(--hv-ink-dim)]">
            Only candidates with live DNS are listed. Registration dates come from RDAP for the first twelve, so an
            older look-alike held by the brand&apos;s own registrar is easy to tell from one registered last week.
          </p>
        </div>
      )}

      {!scan && (
        <>
          <div className="flex flex-wrap gap-1.5 max-h-72 overflow-y-auto">
            {variants.map((v) => (
              <a key={v.domain} href={`?mode=domain&q=${encodeURIComponent(v.domain)}`} target="_blank" rel="noopener noreferrer"
                title={`${v.technique}: open a domain lookup to check if it's registered`}
                className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded border border-[var(--hv-glass-border)] text-[var(--hv-ink)] hover:text-[var(--hv-cyan)] hover:border-[var(--hv-glass-hi)] transition-colors">
                {v.display ?? v.domain}
                <ExternalLink className="w-2.5 h-2.5 opacity-60" />
              </a>
            ))}
          </div>
          <p className="text-[11px] font-mono text-[var(--hv-ink-dim)]">
            Generated from the target name (omission, homoglyph, keyboard-slip, Unicode look-alike, TLD-swap). Resolve
            all to see which of them actually exist.
          </p>
        </>
      )}
    </div>
  );
}
