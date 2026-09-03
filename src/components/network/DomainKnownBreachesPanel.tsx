"use client";

import { ShieldAlert, BadgeCheck } from "lucide-react";
import type { DomainBreach } from "@/lib/types";

interface Props {
  breaches: DomainBreach[];
  domain: string;
}

/** A high-signal exposure class gets a hotter colour so the eye lands on it. */
const HOT = new Set(["Passwords", "Social security numbers", "Dates of birth", "Credit cards"]);

/**
 * Breaches the offline HIBP catalog records for a domain. Renders nothing when
 * the catalog has none — domain mode is already dense, and a "no known breaches"
 * box would read as reassurance the catalog cannot honestly give (it lists only
 * publicly catalogued breaches, not everything that ever happened to a domain).
 * The footer states plainly that this describes the domain, not its users today.
 */
export default function DomainKnownBreachesPanel({ breaches, domain }: Props) {
  if (breaches.length === 0) return null;

  return (
    <div className="terminal-card p-4 space-y-3 border" style={{ borderColor: "#ff3e3e55" }}>
      <div className="text-[12px] uppercase tracking-widest text-[#00ff41]/65 flex items-center gap-1.5">
        <ShieldAlert className="w-3 h-3 text-[#ff3e3e]" /> KNOWN BREACHES FOR THIS DOMAIN
      </div>

      <div className="text-[13px] font-mono text-[#ff3e3e]/85">
        {breaches.length} breach{breaches.length === 1 ? "" : "es"} in the public catalog{" "}
        {breaches.length === 1 ? "is" : "are"} recorded against {domain}.
      </div>

      <div className="space-y-2">
        {breaches.map((b) => (
          <div key={b.name} className="border border-[#ff3e3e]/15 bg-[#ff3e3e]/[0.02] p-2.5 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[13px] font-bold text-[#00d9ff]">{b.name}</span>
              {b.date && <span className="text-[11px] font-mono text-[#00ff41]/55">{b.date}</span>}
              {b.verified && (
                <span className="text-[10px] font-mono tracking-widest px-1 text-[#00ff41]/80 flex items-center gap-1">
                  <BadgeCheck className="w-2.5 h-2.5" /> VERIFIED
                </span>
              )}
              {b.records !== null && b.records > 0 && (
                <span className="text-[11px] font-mono text-[#00ff41]/45">
                  {b.records.toLocaleString()} records
                </span>
              )}
            </div>
            {b.dataClasses.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {b.dataClasses.map((c) => (
                  <span
                    key={c}
                    className={
                      HOT.has(c)
                        ? "text-[10px] font-mono text-[#ff3e3e]/90 px-1 py-0.5 border border-[#ff3e3e]/30"
                        : "text-[10px] font-mono text-[#00ff41]/60 px-1 py-0.5 border border-[#00ff41]/18"
                    }
                  >
                    {c}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="text-[11px] font-mono text-[#00ff41]/45 border-t border-[#00ff41]/10 pt-2">
        From the offline HIBP breach catalog: what is publicly recorded about the domain, not a
        statement that its accounts are exposed today.
      </div>
    </div>
  );
}
