"use client";

import { useState } from "react";
import { HelpCircle, X } from "lucide-react";

const MODE_HELP: [string, string][] = [
  ["📡 Phone", "Carrier · line type · breach · infostealer · identity · pivots"],
  ["✉ Email", "Breach databases · reputation · identity · deliverability"],
  // The site count is asserted against USERNAME_SITES.length in
  // tests/usernameSites.test.ts — the catalog is server-side, so it is written
  // out here rather than imported, which would ship the whole thing to the
  // browser for one number.
  ["@ Username", "Where a handle is registered — 43 sites, no false positives"],
  ["⦿ IP", "Geo · ASN · ISP · open ports · VPN/proxy flags · risk score"],
  ["🌐 Domain", "DNS · WHOIS · SPF/DMARC · subdomains (cert transparency)"],
  ["≡ Bulk", "Triage up to 25 phone numbers → CSV export"],
  ["🕸 Graph", "Link-analysis graph of every identifier this session"],
  ["🗂 Cases", "Save identifiers + notes across sessions"],
];

const SHORTCUTS: [string, string][] = [
  ["⌘K / Ctrl+K", "Command palette — type any identifier, it auto-detects the type"],
  ["1 – 8", "Switch lookup mode"],
  ["/", "Focus the input box"],
];

export default function HelpPopover() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="What can I do here?"
        aria-label="Help — what can I do here?"
        className="p-1.5 rounded-md border border-[var(--hv-glass-border)] text-[var(--hv-ink-dim)] hover:text-[var(--hv-cyan)] hover:border-[var(--hv-glass-hi)] transition-colors"
      >
        <HelpCircle className="w-4 h-4" />
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[8vh] px-4" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/75 backdrop-blur-md" />
          <div className="glass-pop relative w-full max-w-lg rounded-xl overflow-hidden flex flex-col max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--hv-glass-border)]">
              <div className="flex items-center gap-2 text-[12px] font-mono uppercase tracking-widest text-[var(--hv-cyan)]">
                <HelpCircle className="w-4 h-4" /> What can I do here?
              </div>
              <button onClick={() => setOpen(false)} aria-label="Close" className="text-[var(--hv-ink-dim)] hover:text-[var(--hv-ink)]">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto p-4 space-y-4">
              <p className="text-[12px] font-mono text-[var(--hv-ink-dim)]">
                One console, eight modes. Paste any identifier or pick a mode — most data is free and needs no API key.
              </p>
              <div>
                <div className="text-[11px] font-mono uppercase tracking-widest text-[var(--hv-green)]/60 mb-1.5">Modes</div>
                <div className="space-y-1">
                  {MODE_HELP.map(([name, desc]) => (
                    <div key={name} className="flex items-baseline gap-2">
                      <span className="text-[13px] font-mono font-bold text-[var(--hv-ink)] w-28 shrink-0">{name}</span>
                      <span className="text-[12px] font-mono text-[var(--hv-ink-dim)]">{desc}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-mono uppercase tracking-widest text-[var(--hv-magenta)]/74 mb-1.5">Keyboard</div>
                <div className="space-y-1">
                  {SHORTCUTS.map(([k, desc]) => (
                    <div key={k} className="flex items-baseline gap-2">
                      <kbd className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[var(--hv-glass-border)] text-[var(--hv-ink)] w-28 shrink-0 text-center">{k}</kbd>
                      <span className="text-[12px] font-mono text-[var(--hv-ink-dim)]">{desc}</span>
                    </div>
                  ))}
                </div>
              </div>
              <p className="text-[11px] font-mono text-[var(--hv-ink-dim)] pt-1 border-t border-[var(--hv-glass-border)]">
                Metadata only — no real-time location or device tracking. Use within an authorized scope.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
