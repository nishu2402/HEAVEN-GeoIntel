"use client";

import { motion } from "framer-motion";
import { Database, ShieldCheck, ShieldAlert, Tag } from "lucide-react";
import type { LeakCheckData, SourceResult } from "@/lib/types";

interface Props {
  source: SourceResult<LeakCheckData>;
  /** Reads truthfully in all three modes that call LeakCheck. */
  subject: "phone number" | "email address" | "username";
}

// Field names LeakCheck reports are raw column labels from the source dumps.
// Map the ones worth calling out; anything unmapped is shown verbatim rather
// than dropped, so we never hide an exposure type we didn't anticipate.
const HIGH_RISK = new Set(["password", "ssn", "dob", "address", "phone", "cc", "passport"]);

function fmtField(f: string): string {
  return f.replace(/_/g, " ");
}

export default function LeakCheckPanel({ source, subject }: Props) {
  if (!source.ok) {
    return (
      <div className="terminal-card p-4 border border-[#555]/30 space-y-2">
        <div className="text-[12px] uppercase tracking-widest text-[#888] flex items-center gap-1.5">
          <Database className="w-3 h-3" /> PUBLIC BREACH INDEX — LeakCheck · free · no key
        </div>
        <div className="text-[13px] font-mono text-[#aaa]">
          {source.error === "RATE_LIMITED"
            ? "LeakCheck rate-limited — the free tier is shared per source IP. This is not a clean result; try again shortly."
            : `LeakCheck check failed: ${source.error ?? "unknown"}`}
        </div>
      </div>
    );
  }

  const d = source.data!;
  const found = d.found > 0;
  const borderColor = found ? "#ffaa00" : "#00ff41";
  const risky = d.fields.filter((f) => HIGH_RISK.has(f.toLowerCase()));

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="terminal-card p-4 space-y-4"
      style={{ borderColor: borderColor + "55" }}
    >
      <div>
        <div className="text-[12px] uppercase tracking-widest text-[#00ff41]/65 mb-1.5 flex items-center gap-1.5">
          {found
            ? <ShieldAlert className="w-3 h-3" style={{ color: borderColor }} />
            : <ShieldCheck className="w-3 h-3 text-[#00ff41]" />}
          PUBLIC BREACH INDEX — LeakCheck · free · no key
        </div>
        {found ? (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-2xl font-bold font-mono" style={{ color: borderColor }}>
              {d.found.toLocaleString()} RECORD{d.found === 1 ? "" : "S"}
            </span>
            <span className="text-[12px] font-mono text-[#ffaa00]/80">
              this {subject} appears in indexed breach data
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-lg font-bold font-mono text-[#00ff41]">NOT INDEXED</span>
            <span className="text-[12px] font-mono text-[#00ff41]/60">
              — LeakCheck holds no breach records for this {subject}
            </span>
          </div>
        )}
      </div>

      {found && d.sources.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] uppercase tracking-widest text-[#00ff41]/45">
            Named breaches ({d.sources.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {d.sources.map((s, i) => (
              <span
                key={`${s.name}-${i}`}
                className="text-[11px] font-mono text-[#00d9ff]/85 px-1.5 py-0.5 border border-[#00d9ff]/25"
              >
                {s.name}
                {s.date && <span className="text-[#00d9ff]/50"> · {s.date}</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {found && d.fields.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] uppercase tracking-widest text-[#00ff41]/45 flex items-center gap-1">
            <Tag className="w-2.5 h-2.5" /> Exposed field types
          </div>
          <div className="flex flex-wrap gap-1">
            {d.fields.map((f) => {
              const hot = HIGH_RISK.has(f.toLowerCase());
              return (
                <span
                  key={f}
                  className={
                    hot
                      ? "text-[11px] font-mono text-[#ff3e3e]/90 px-1.5 py-0.5 border border-[#ff3e3e]/35 bg-[#ff3e3e]/[0.06]"
                      : "text-[11px] font-mono text-[#00ff41]/70 px-1.5 py-0.5 border border-[#00ff41]/20"
                  }
                >
                  {fmtField(f)}
                </span>
              );
            })}
          </div>
          {risky.length > 0 && (
            <div className="text-[12px] font-mono text-[#ff3e3e]/80">
              {risky.length} high-sensitivity field type{risky.length === 1 ? " was" : "s were"} exposed
              in at least one of these breaches.
            </div>
          )}
        </div>
      )}

      <div className="text-[12px] font-mono text-[#00ff41]/45 border-t border-[#00ff41]/10 pt-3">
        LeakCheck&apos;s public tier reports which breaches mention an identifier and which
        field types they held — never the values. Field types are aggregated across all
        matching records, so a listed type may come from any one of the breaches above.
      </div>
    </motion.div>
  );
}
