"use client";

import { motion } from "framer-motion";
import {
  Bug, ShieldCheck, ShieldAlert, Calendar, Monitor, Globe,
  Lock, Eye,
} from "lucide-react";
import type { LookupResponse } from "@/lib/types";

interface Props {
  data: LookupResponse;
}

function fmtDate(iso: string | null): string {
  /* v8 ignore next -- the only caller guards `s.dateCompromised` first; the null branch is defensive */
  if (!iso) return "—";
  try { return new Date(iso).toISOString().split("T")[0]; }
  catch { return iso; }
}

export default function InfostealerPanel({ data }: Props) {
  const hr = data.sources.hudsonRock;

  // Hudson Rock returns ok=true even when no infections are found, so we
  // always show this card.  Empty state is a green "clean" badge, not a
  // "not configured" wall.
  if (!hr.ok) {
    return (
      <div className="terminal-card p-4 border border-[#555]/30 space-y-2">
        <div className="text-[12px] uppercase tracking-widest text-[#888] flex items-center gap-1.5">
          <Bug className="w-3 h-3" /> INFOSTEALER MALWARE EXPOSURE — Hudson Rock · free · no key
        </div>
        <div className="text-[13px] font-mono text-[#aaa]">
          {hr.error === "RATE_LIMITED"
            ? "Hudson Rock rate-limited — try again in a few seconds."
            : `Hudson Rock check failed: ${hr.error ?? "unknown"}`}
        </div>
      </div>
    );
  }

  const d = hr.data!;
  const found = d.total > 0;

  const borderColor = found ? "#ff3e3e" : "#00ff41";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="terminal-card p-4 space-y-4"
      style={{ borderColor: borderColor + "55" }}
    >
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <div className="text-[12px] uppercase tracking-widest text-[#00ff41]/65 mb-1.5 flex items-center gap-1.5">
            {found
              ? <ShieldAlert className="w-3 h-3" style={{ color: borderColor }} />
              : <ShieldCheck className="w-3 h-3 text-[#00ff41]" />}
            INFOSTEALER MALWARE EXPOSURE — Hudson Rock · free · no key
          </div>
          {found ? (
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-2xl font-bold font-mono" style={{ color: borderColor }}>
                {d.total} INFECTION{d.total === 1 ? "" : "S"}
              </span>
              <span className="text-[12px] font-mono text-[#ff3e3e]/80">
                this phone number was captured by an info-stealer running on a victim&apos;s device
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold font-mono text-[#00ff41]">CLEAN</span>
              <span className="text-[12px] font-mono text-[#00ff41]/60">
                — no infostealer infections recorded by Hudson Rock for this number
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Stealer list */}
      {found && d.stealers.length > 0 && (
        <div className="space-y-3">
          <p className="text-[13px] font-mono text-[#00ff41]/65 leading-snug">
            Each row below is a compromised device that captured the number while it was
            being typed into a website. The stolen credential dump usually includes
            paired passwords and the sites the number was used on.
          </p>
          {d.stealers.map((s, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className="border border-[#ff3e3e]/30 bg-[#ff3e3e]/[0.04] p-3 space-y-2"
            >
              <div className="flex items-center gap-2 flex-wrap text-[12px] font-mono">
                {s.malwareFamily && (
                  <span className="px-1.5 py-0.5 border border-[#ff3e3e]/50 bg-[#ff3e3e]/15 text-[#ff3e3e] font-bold tracking-widest">
                    {s.malwareFamily.toUpperCase()}
                  </span>
                )}
                {s.dateCompromised && (
                  <span className="text-[#00d9ff] flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> {fmtDate(s.dateCompromised)}
                  </span>
                )}
                {s.operatingSystem && (
                  <span className="text-[#00ff41]/65 flex items-center gap-1">
                    <Monitor className="w-3 h-3" /> {s.operatingSystem}
                  </span>
                )}
                {s.computerName && (
                  <span className="text-[#00ff41]/50">· {s.computerName}</span>
                )}
                {s.ip && (
                  <span className="text-[#00ff41]/50 flex items-center gap-1">
                    <Globe className="w-3 h-3" /> {s.ip}
                  </span>
                )}
              </div>

              {s.topLogins.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[11px] uppercase tracking-widest text-[#00ff41]/45 flex items-center gap-1">
                    <Eye className="w-2.5 h-2.5" /> Sites this credential was used on
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {s.topLogins.filter(Boolean).map((url, j) => (
                      <span key={`${url}-${j}`} className="text-[11px] font-mono text-[#00d9ff]/85 px-1.5 py-0.5 border border-[#00d9ff]/25">
                        {url}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {s.topPasswords.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[11px] uppercase tracking-widest text-[#00ff41]/45 flex items-center gap-1">
                    <Lock className="w-2.5 h-2.5" /> Sample captured passwords (Hudson Rock obfuscation)
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {s.topPasswords.map((p, j) => (
                      <span key={j} className="text-[11px] font-mono text-[#ffaa00]/85 px-1.5 py-0.5 border border-[#ffaa00]/25">
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      )}

      {!found && (
        <div className="text-[12px] font-mono text-[#00ff41]/45 border-t border-[#00ff41]/10 pt-3">
          Hudson Rock indexes ~26M infected devices. A clean result here is genuinely a
          good sign — but does not rule out other types of breaches. Check the breach
          panel above for credential leaks.
        </div>
      )}
    </motion.div>
  );
}
