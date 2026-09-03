"use client";

import { useMemo, useState } from "react";
import { Copy, Check, ExternalLink, Radar } from "lucide-react";
import { copyText } from "@/lib/utils";
import { generateTyposquats } from "@/lib/analysis/typosquat";

/**
 * Look-alike / typosquat domains for the target, generated in the browser (pure
 * string derivation, no key). Each variant is a one-click, new-tab domain lookup
 * so the analyst can check which look-alikes are actually registered — the panel
 * never claims a squat exists, it hands over what to check.
 */
export default function TyposquatPanel({ domain }: { domain: string }) {
  const variants = useMemo(() => generateTyposquats(domain), [domain]);
  const [copied, setCopied] = useState(false);
  if (variants.length === 0) return null;

  const copyAll = () => {
    void copyText(variants.map((v) => v.domain).join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div id="sec-typosquat" className="terminal-card p-4 space-y-3 scroll-mt-24">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5">
          <Radar className="w-3.5 h-3.5" /> LOOK-ALIKE DOMAINS: {variants.length} to check
        </div>
        <button type="button" onClick={copyAll}
          className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-1 rounded border border-[var(--hv-glass-border)] text-[var(--hv-cyan)] hover:border-[var(--hv-glass-hi)]">
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} {copied ? "Copied" : "Copy all"}
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5 max-h-72 overflow-y-auto">
        {variants.map((v) => (
          <a key={v.domain} href={`?mode=domain&q=${encodeURIComponent(v.domain)}`} target="_blank" rel="noopener noreferrer"
            title={`${v.technique}: open a domain lookup to check if it's registered`}
            className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded border border-[var(--hv-glass-border)] text-[var(--hv-ink)] hover:text-[var(--hv-cyan)] hover:border-[var(--hv-glass-hi)] transition-colors">
            {v.domain}
            <ExternalLink className="w-2.5 h-2.5 opacity-60" />
          </a>
        ))}
      </div>
      <p className="text-[11px] font-mono text-[var(--hv-ink-dim)]">
        Generated from the target name (omission, homoglyph, keyboard-slip, TLD-swap, …). Click one to check whether it resolves.
      </p>
    </div>
  );
}
