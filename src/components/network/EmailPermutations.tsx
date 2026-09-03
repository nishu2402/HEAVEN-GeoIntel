"use client";

import { useMemo, useState } from "react";
import { AtSign, Copy, Check, Lightbulb } from "lucide-react";
import { permuteEmails, inferPattern } from "@/lib/analysis/emailPermutations";
import { copyText } from "@/lib/utils";

// ── Email permutation for an engagement ──────────────────────────────────────
//
// Deliberately not wired to the lookup pipeline: this generates candidates and
// nothing else. Every address shown is a guess the analyst still has to
// confirm, and the panel says so rather than letting a long tidy list imply
// otherwise.
//
// The "known address" box is the part that pays for itself. One confirmed
// mailbox at the domain usually identifies the org's rule outright, which turns
// seventeen candidates into one answer for every other name at that company.

export default function EmailPermutations({ domain }: { domain: string }) {
  const [name, setName] = useState("");
  const [known, setKnown] = useState("");
  const [knownName, setKnownName] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const candidates = useMemo(() => permuteEmails(name, domain), [name, domain]);
  const matched = useMemo(
    () => (known && knownName ? inferPattern(known, knownName) : []),
    [known, knownName],
  );

  const copy = (text: string, key: string) => {
    void copyText(text);
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600);
  };

  const inputClass =
    "w-full bg-transparent border border-[var(--hv-glass-border)] rounded px-2.5 py-1.5 font-mono text-xs text-[var(--hv-ink)] placeholder:text-[var(--hv-ink-dim)] focus:outline-none focus:border-[var(--hv-cyan)]";

  return (
    <div id="sec-emails" className="terminal-card p-4 space-y-3 scroll-mt-24">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5">
          <AtSign className="w-3 h-3" /> EMAIL PERMUTATIONS
        </div>
        {candidates.length > 0 && (
          <button
            type="button"
            onClick={() => copy(candidates.map((c) => c.address).join("\n"), "__all")}
            className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest px-2 py-1 rounded border border-[var(--hv-cyan)]/40 text-[var(--hv-cyan)] hover:bg-[var(--hv-cyan)]/10 transition-all"
          >
            {copied === "__all" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            Copy all {candidates.length}
          </button>
        )}
      </div>

      <label className="block space-y-1">
        <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--hv-ink-dim)]">Full name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Q. Doe" className={inputClass} />
      </label>

      <details className="group">
        <summary className="cursor-pointer text-[10px] font-mono uppercase tracking-widest text-[var(--hv-ink-dim)] hover:text-[var(--hv-cyan)]">
          Know one address here? Narrow it to a single rule
        </summary>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
          <input value={knownName} onChange={(e) => setKnownName(e.target.value)} placeholder="That person's full name" className={inputClass} />
          <input value={known} onChange={(e) => setKnown(e.target.value)} placeholder={`known.person@${domain}`} className={inputClass} />
        </div>
        {known && knownName && (
          <div className="mt-2 flex items-start gap-1.5 font-mono text-[11px]"
            style={{ color: matched.length ? "#00ff85" : "#fb923c" }}>
            <Lightbulb className="w-3 h-3 shrink-0 mt-0.5" />
            {matched.length === 0
              ? "That address does not match any pattern here: the org may use a nickname, a middle name, or a numeric suffix."
              : matched.length === 1
                ? `Pattern: ${matched[0]}: the highlighted candidate is the one to use.`
                : `Fits ${matched.length} rules equally (${matched.join(", ")}); this name cannot tell them apart.`}
          </div>
        )}
      </details>

      {candidates.length > 0 && (
        <>
          <div className="space-y-1 border-t border-[var(--hv-glass-border)] pt-2">
            {candidates.map((c) => {
              const hit = matched.includes(c.pattern);
              return (
                <button
                  key={c.address}
                  type="button"
                  onClick={() => copy(c.address, c.address)}
                  title="Copy this address"
                  className="w-full text-left flex items-baseline gap-2 font-mono text-xs px-2 py-1 rounded hover:bg-[var(--hv-cyan)]/10 transition-colors"
                  style={hit ? { background: "rgba(0,255,133,0.10)", boxShadow: "inset 0 0 0 1px rgba(0,255,133,0.35)" } : undefined}
                >
                  {copied === c.address
                    ? <Check className="w-3 h-3 shrink-0 text-[#00ff85]" />
                    : <Copy className="w-3 h-3 shrink-0 text-[var(--hv-ink-dim)]" />}
                  <span className="text-[var(--hv-ink)] break-all">{c.address}</span>
                  <span className="ml-auto shrink-0 text-[10px] text-[var(--hv-ink-dim)]">{c.pattern}</span>
                </button>
              );
            })}
          </div>
          <div className="text-[10px] font-mono text-[var(--hv-ink-dim)] border-t border-[var(--hv-glass-border)] pt-2">
            Candidates only. Nothing here has been checked against the mail server: run them through the EMAIL tab
            or a breach index before treating any as real.
          </div>
        </>
      )}
    </div>
  );
}
