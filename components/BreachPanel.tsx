"use client";

import { motion } from "framer-motion";
import { ShieldAlert, ShieldCheck, AlertTriangle, ExternalLink, Key } from "lucide-react";
import type { XposedOrNotData, XposedOrNotBreach } from "@/lib/types";

interface Props {
  xon: { ok: boolean; data?: XposedOrNotData; error?: string };
}

const PASSWORD_RISK_META: Record<string, { label: string; color: string; order: number }> = {
  ClearText:   { label: "PLAINTEXT",   color: "#ff1a1a", order: 0 },
  EasyToCrack: { label: "EASY CRACK",  color: "#ff6600", order: 1 },
  StrongHash:  { label: "HASHED",      color: "#ffaa00", order: 2 },
  Unknown:     { label: "UNKNOWN",     color: "#555",    order: 3 },
};

const DATA_TYPE_COLORS: Record<string, string> = {
  "Passwords":             "#ff3e3e",
  "Email Addresses":       "#00d9ff",
  "Usernames":             "#00ff41",
  "Names":                 "#00d9ff",
  "Phone Numbers":         "#ffaa00",
  "Physical Addresses":    "#ffaa00",
  "IP Addresses":          "#ff6600",
  "Dates of Birth":        "#888",
  "Geographic Locations":  "#888",
  "Credit Cards":          "#ff1a1a",
  "Social Security Numbers": "#ff1a1a",
  "Security Questions":    "#ff6600",
  "Auth Tokens":           "#ff3e3e",
};

function getDataTypeColor(type: string): string {
  return DATA_TYPE_COLORS[type] ?? "#00ff41";
}

function formatRecordCount(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function PasswordRiskBadge({ risk }: { risk: string }) {
  const meta = PASSWORD_RISK_META[risk] ?? PASSWORD_RISK_META["Unknown"];
  return (
    <span
      className="text-[8px] font-mono font-bold px-1.5 py-0.5 border tracking-widest"
      style={{ color: meta.color, borderColor: meta.color + "60", backgroundColor: meta.color + "12" }}
    >
      {meta.label}
    </span>
  );
}

function DataTypeBadge({ type }: { type: string }) {
  const color = getDataTypeColor(type);
  return (
    <span
      className="text-[8px] font-mono px-1.5 py-0.5 border tracking-wider"
      style={{ color, borderColor: color + "40", backgroundColor: color + "0d" }}
    >
      {type.toUpperCase()}
    </span>
  );
}

function BreachRow({ breach, index }: { breach: XposedOrNotBreach; index: number }) {
  const year = breach.xposedDate.split("-")[0] ?? "????";
  const hasPassword = breach.xposedData.some((d) => d.toLowerCase().includes("password"));
  const riskMeta = PASSWORD_RISK_META[breach.passwordRisk] ?? PASSWORD_RISK_META["Unknown"];
  const rowAccent = hasPassword ? riskMeta.color : "#00ff41";

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04 }}
      className="border-l-2 pl-3 py-2 space-y-1.5"
      style={{ borderColor: rowAccent + "60" }}
    >
      {/* Breach name + meta */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold text-sm" style={{ color: rowAccent }}>
            {breach.breach}
          </span>
          {breach.domain && (
            <a
              href={`https://${breach.domain}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[9px] font-mono text-[#00ff41]/30 hover:text-[#00ff41]/60 flex items-center gap-0.5 transition-colors"
            >
              {breach.domain} <ExternalLink className="w-2.5 h-2.5 inline" />
            </a>
          )}
          {breach.verified && (
            <span className="text-[8px] font-mono text-[#00ff41]/40 border border-[#00ff41]/20 px-1.5 py-0.5">
              VERIFIED
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[9px] font-mono text-[#00ff41]/40">{year}</span>
          {breach.xposedRecords > 0 && (
            <span className="text-[9px] font-mono text-[#00ff41]/30">
              {formatRecordCount(breach.xposedRecords)} records
            </span>
          )}
          {hasPassword && <PasswordRiskBadge risk={breach.passwordRisk} />}
        </div>
      </div>

      {/* Data types */}
      <div className="flex flex-wrap gap-1">
        {breach.xposedData.map((dt) => (
          <DataTypeBadge key={dt} type={dt} />
        ))}
      </div>
    </motion.div>
  );
}

export default function BreachPanel({ xon }: Props) {
  if (!xon.ok) {
    return (
      <div className="terminal-card p-4 border border-[#555]/30">
        <div className="text-[9px] uppercase tracking-widest text-[#555] mb-2 flex items-center gap-1.5">
          <ShieldAlert className="w-3 h-3" /> BREACH DATABASE — XposedOrNot
        </div>
        <div className="text-[10px] font-mono text-[#555]">
          {xon.error === "RATE_LIMITED"
            ? "Rate limited — try again in a moment"
            : `Could not reach breach database: ${xon.error ?? "unknown error"}`}
        </div>
      </div>
    );
  }

  const data = xon.data!;
  const sorted = [...data.breaches].sort((a, b) => b.xposedDate.localeCompare(a.xposedDate));

  const hasPlaintext = data.breaches.some((b) => b.passwordRisk === "ClearText");
  const hasEasyCrack = data.breaches.some((b) => b.passwordRisk === "EasyToCrack");
  const hasPasswords = data.breaches.some((b) => b.xposedData.some((d) => d.toLowerCase().includes("password")));

  const criticalCount = data.breaches.filter((b) => b.passwordRisk === "ClearText" || b.passwordRisk === "EasyToCrack").length;

  const borderColor = data.breachCount === 0
    ? "#00ff41"
    : hasPlaintext
    ? "#ff1a1a"
    : hasEasyCrack
    ? "#ff6600"
    : "#ff3e3e";

  return (
    <div
      className="terminal-card p-4 space-y-4"
      style={{ borderColor: borderColor + "40" }}
    >
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="text-[9px] uppercase tracking-widest text-[#00ff41]/40 mb-1.5 flex items-center gap-1.5">
            {data.breachCount === 0
              ? <ShieldCheck className="w-3 h-3 text-[#00ff41]" />
              : <ShieldAlert className="w-3 h-3" style={{ color: borderColor }} />}
            BREACH DATABASE — XposedOrNot · free · 1000+ sources
          </div>

          {data.breachCount === 0 ? (
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold font-mono text-[#00ff41]">CLEAN</span>
              <span className="text-xs font-mono text-[#00ff41]/50">
                — no exposures found across 1000+ breach databases
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-2xl font-bold font-mono" style={{ color: borderColor }}>
                {data.breachCount} BREACH{data.breachCount !== 1 ? "ES" : ""}
              </span>
              {criticalCount > 0 && (
                <span className="text-[10px] font-mono flex items-center gap-1" style={{ color: borderColor }}>
                  <AlertTriangle className="w-3 h-3" />
                  {criticalCount} with crackable passwords
                </span>
              )}
            </div>
          )}
        </div>

        {/* Summary stats */}
        {data.breachCount > 0 && (
          <div className="flex gap-4 text-right shrink-0">
            {hasPasswords && (
              <div>
                <div className="text-[8px] uppercase tracking-widest text-[#00ff41]/30">Password Risk</div>
                <div className="font-mono text-xs font-bold mt-0.5" style={{ color: hasPlaintext ? "#ff1a1a" : hasEasyCrack ? "#ff6600" : "#ffaa00" }}>
                  {hasPlaintext ? "PLAINTEXT" : hasEasyCrack ? "EASY CRACK" : "HASHED"}
                </div>
              </div>
            )}
            {data.xposedDataTypes.length > 0 && (
              <div>
                <div className="text-[8px] uppercase tracking-widest text-[#00ff41]/30">Data Types</div>
                <div className="font-mono text-xs font-bold text-[#00d9ff] mt-0.5">
                  {data.xposedDataTypes.length}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Critical password warning */}
      {hasPlaintext && (
        <div className="flex items-center gap-2 p-2.5 border border-[#ff1a1a]/40 bg-[#ff1a1a]/5">
          <Key className="w-3.5 h-3.5 text-[#ff1a1a] shrink-0" />
          <span className="text-[10px] font-mono text-[#ff1a1a]">
            CRITICAL — Plaintext passwords exposed in at least one breach. Assume password and all reused passwords are compromised.
          </span>
        </div>
      )}
      {!hasPlaintext && hasEasyCrack && (
        <div className="flex items-center gap-2 p-2.5 border border-[#ff6600]/40 bg-[#ff6600]/5">
          <Key className="w-3.5 h-3.5 text-[#ff6600] shrink-0" />
          <span className="text-[10px] font-mono text-[#ff6600]">
            HIGH RISK — MD5/SHA1 hashes exposed. These can be cracked using rainbow tables or Hashcat within hours.
          </span>
        </div>
      )}

      {/* All data types exposed across all breaches */}
      {data.xposedDataTypes.length > 0 && (
        <div>
          <div className="text-[9px] uppercase tracking-widest text-[#00ff41]/30 mb-1.5">
            All Exposed Data Types
          </div>
          <div className="flex flex-wrap gap-1">
            {data.xposedDataTypes.map((dt) => (
              <DataTypeBadge key={dt} type={dt} />
            ))}
          </div>
        </div>
      )}

      {/* Breach list */}
      {sorted.length > 0 && (
        <div className="space-y-3">
          <div className="text-[9px] uppercase tracking-widest text-[#00ff41]/30 border-b border-[#00ff41]/10 pb-1">
            Breach Details — sorted newest first
          </div>
          <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
            {sorted.map((breach, i) => (
              <BreachRow key={breach.breach + i} breach={breach} index={i} />
            ))}
          </div>
        </div>
      )}

      {/* No breaches — OSINT pivot suggestion */}
      {data.breachCount === 0 && (
        <div className="text-[9px] font-mono text-[#00ff41]/25 border-t border-[#00ff41]/10 pt-3">
          Use the OSINT matrix below to manually check HaveIBeenPwned, Dehashed, IntelligenceX, and LeakCheck for additional coverage.
        </div>
      )}
    </div>
  );
}
