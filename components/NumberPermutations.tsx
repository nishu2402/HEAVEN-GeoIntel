"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import type { LookupResponse } from "@/lib/types";

interface Props {
  data: LookupResponse;
}

export default function NumberPermutations({ data }: Props) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const { input } = data;
  const e164 = input.e164;                             // +14155551234
  const intl = data.aggregated.formatInternational;    // +1 415 555 1234
  const national = data.aggregated.formatNational;     // (415) 555-1234
  const allDigits = e164.replace(/\D/g, "");           // 14155551234
  const noCC = allDigits.slice(input.countryCallingCode.replace("+","").length); // 4155551234

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).catch(console.error);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  // Build every plausible format the number might appear as in databases/forms
  const formats: { label: string; value: string; note?: string }[] = [
    { label: "E.164 (canonical)", value: e164, note: "ITU standard — use in APIs" },
    { label: "International spaced", value: intl },
    { label: "National format", value: national },
    { label: "All digits (no +)", value: allDigits, note: "Common in database dumps" },
    { label: "Without country code", value: noCC, note: "Local-only format" },
    { label: "Dots separator", value: noCC.replace(/(\d{3})(\d{3})(\d{4})/, "$1.$2.$3") !== noCC ? noCC.replace(/(\d{3})(\d{3})(\d{4})/, "$1.$2.$3") : noCC.replace(/(\d{3})(\d{4})/, "$1.$2"), note: "Common in EU" },
    { label: "Dashes only", value: noCC.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3") !== noCC ? noCC.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3") : noCC.replace(/(\d{3})(\d{4})/, "$1-$2") },
    { label: "RFC 3966 (tel: URI)", value: data.aggregated.formatRfc3966, note: "Click-to-call URLs" },
    { label: "URL-encoded E.164", value: encodeURIComponent(e164), note: "For URL parameters" },
    { label: "WhatsApp link", value: `https://wa.me/${allDigits}`, note: "Direct chat link" },
    { label: "Stripped spaces", value: e164.replace(/\s/g, ""), note: "Some forms strip spaces" },
  ];

  // Deduplicate identical values
  const seen = new Set<string>();
  const deduped = formats.filter((f) => {
    if (seen.has(f.value)) return false;
    seen.add(f.value);
    return true;
  });

  return (
    <div className="terminal-card p-4 space-y-3">
      <div className="text-xs uppercase tracking-widest text-[#00ff41]/50 border-b border-[#00ff41]/15 pb-2">
        [ NUMBER PERMUTATIONS ] — all database formats
      </div>
      <div className="text-[10px] text-[#00ff41]/55">
        Every format this number may appear as in leaks, forms, or databases. Copy and search each.
      </div>

      <div className="divide-y divide-[#00ff41]/[0.06]">
        {deduped.map((f) => {
          const isCopied = copiedKey === f.label;
          return (
            <div
              key={f.label}
              className="flex items-center gap-2 py-2 px-1 hover:bg-[#00ff41]/5 transition-colors group"
            >
              <div className="w-36 shrink-0">
                <div className="text-[9px] uppercase tracking-widest text-[#00ff41]/35">{f.label}</div>
                {f.note && (
                  <div className="text-[8px] text-[#00ff41]/45 mt-0.5">{f.note}</div>
                )}
              </div>
              <span className="font-mono text-[11px] text-[#00ff41]/80 flex-1 min-w-0 break-all">
                {f.value}
              </span>
              <button
                onClick={() => copy(f.value, f.label)}
                className="shrink-0 p-1 text-[#00ff41]/25 hover:text-[#00ff41] transition-colors"
                title="Copy"
              >
                {isCopied ? <Check className="w-3 h-3 text-[#00ff41]" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
