"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  ShieldAlert, ShieldCheck, AlertTriangle, ExternalLink,
  Key, Copy, Check, Zap, Lock,
} from "lucide-react";
import type { XposedOrNotData, XposedOrNotBreach, BreachDirectoryData } from "@/lib/types";
import {
  detectHash,
  CRACK_DIFFICULTY_LABEL,
  CRACK_DIFFICULTY_COLOR,
} from "@/lib/hashDetect";

interface Props {
  xon: { ok: boolean; data?: XposedOrNotData; error?: string };
  breachDirectory: { ok: boolean; data?: BreachDirectoryData; error?: string };
}

// ── Small helpers ─────────────────────────────────────────────────────────────

const PASSWORD_RISK_META: Record<string, { label: string; color: string }> = {
  ClearText:   { label: "PLAINTEXT",  color: "#ff1a1a" },
  EasyToCrack: { label: "EASY CRACK", color: "#ff6600" },
  StrongHash:  { label: "HASHED",     color: "#ffaa00" },
  Unknown:     { label: "UNKNOWN",    color: "#555"    },
};

const DATA_TYPE_COLORS: Record<string, string> = {
  "Passwords":              "#ff3e3e",
  "Email addresses":        "#00d9ff",
  "Email Addresses":        "#00d9ff",
  "Usernames":              "#00ff41",
  "Names":                  "#00d9ff",
  "Name":                   "#00d9ff",
  "Phone numbers":          "#ffaa00",
  "Phone Numbers":          "#ffaa00",
  "Physical addresses":     "#ffaa00",
  "Physical Addresses":     "#ffaa00",
  "IP addresses":           "#ff6600",
  "IP Addresses":           "#ff6600",
  "Dates of birth":         "#888",
  "Geographic locations":   "#888",
  "Partial credit card data": "#ff1a1a",
  "Credit Cards":           "#ff1a1a",
  "Security Questions":     "#ff6600",
};

function getDataTypeColor(t: string): string {
  return DATA_TYPE_COLORS[t] ?? "#00ff41";
}

function formatCount(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)         return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function DataBadge({ type }: { type: string }) {
  const color = getDataTypeColor(type);
  return (
    <span className="text-[8px] font-mono px-1.5 py-0.5 border tracking-wider"
      style={{ color, borderColor: color + "40", backgroundColor: color + "0d" }}>
      {type.toUpperCase()}
    </span>
  );
}

function RiskBadge({ risk }: { risk: string }) {
  const m = PASSWORD_RISK_META[risk] ?? PASSWORD_RISK_META["Unknown"];
  return (
    <span className="text-[8px] font-mono font-bold px-1.5 py-0.5 border tracking-widest"
      style={{ color: m.color, borderColor: m.color + "60", backgroundColor: m.color + "12" }}>
      {m.label}
    </span>
  );
}

// Copy + open in one click
function CopyOpenBtn({
  hash, label, url, disabled,
}: { hash: string; label: string; url: string; disabled?: boolean }) {
  const [done, setDone] = useState(false);
  const handle = () => {
    if (disabled) return;
    navigator.clipboard.writeText(hash).catch(console.error);
    window.open(url, "_blank", "noopener,noreferrer");
    setDone(true);
    setTimeout(() => setDone(false), 2000);
  };
  return (
    <button
      onClick={handle}
      disabled={disabled}
      className={`flex items-center gap-1 text-[9px] font-mono px-2 py-1 border transition-all ${
        disabled
          ? "border-[#555]/30 text-[#555] cursor-not-allowed"
          : "border-[#00d9ff]/40 text-[#00d9ff]/70 hover:border-[#00d9ff] hover:text-[#00d9ff] cursor-pointer"
      }`}
    >
      {done ? <Check className="w-2.5 h-2.5" /> : <Zap className="w-2.5 h-2.5" />}
      {done ? "COPIED + OPENED" : label}
    </button>
  );
}

function CopyHashBtn({ hash }: { hash: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(hash).catch(console.error);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="flex items-center gap-1 text-[9px] font-mono px-2 py-1 border border-[#00ff41]/30 text-[#00ff41]/50 hover:text-[#00ff41] hover:border-[#00ff41]/60 transition-all"
    >
      {done ? <Check className="w-2.5 h-2.5" /> : <Copy className="w-2.5 h-2.5" />}
      {done ? "COPIED" : "COPY"}
    </button>
  );
}

// ── Breach row ────────────────────────────────────────────────────────────────

function BreachRow({ breach, index }: { breach: XposedOrNotBreach; index: number }) {
  const year = breach.xposedDate.split("-")[0] ?? "????";
  const hasPassword = breach.xposedData.some((d) => d.toLowerCase().includes("password"));
  const riskMeta = PASSWORD_RISK_META[breach.passwordRisk] ?? PASSWORD_RISK_META["Unknown"];
  const accent = hasPassword ? riskMeta.color : "#00ff41";

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04 }}
      className="border-l-2 pl-3 py-2.5 space-y-1.5"
      style={{ borderColor: accent + "60" }}
    >
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono font-bold text-sm" style={{ color: accent }}>
            {breach.breach}
          </span>
          {breach.domain && (
            <a href={`https://${breach.domain}`} target="_blank" rel="noopener noreferrer"
              className="text-[9px] font-mono text-[#00ff41]/30 hover:text-[#00ff41]/60 flex items-center gap-0.5 transition-colors">
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
              {formatCount(breach.xposedRecords)} records
            </span>
          )}
          {hasPassword && <RiskBadge risk={breach.passwordRisk} />}
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {breach.xposedData.map((dt) => <DataBadge key={dt} type={dt} />)}
      </div>
    </motion.div>
  );
}

// ── Credential hash card ──────────────────────────────────────────────────────

function CredentialCard({
  entry, index,
}: { entry: { password: string; sha1: string; hash: string; sources: string[] }; index: number }) {
  // Pick the best hash to analyse: prefer SHA-1 (40 hex) over MD5 (32 hex)
  // Partial password shown separately
  const sha1Info  = entry.sha1  ? detectHash(entry.sha1)  : null;
  const md5Info   = entry.hash  ? detectHash(entry.hash)   : null;
  const partInfo  = entry.password ? detectHash(entry.password) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.07 }}
      className="border border-[#ff3e3e]/20 bg-[#ff3e3e]/[0.02] p-3 space-y-3"
    >
      {/* Sources */}
      {entry.sources.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[8px] uppercase tracking-widest text-[#00ff41]/30">Source:</span>
          {entry.sources.map((s) => (
            <span key={s} className="text-[9px] font-mono text-[#00d9ff]/70 border border-[#00d9ff]/20 px-1.5 py-0.5">
              {s}
            </span>
          ))}
        </div>
      )}

      {/* Partial password */}
      {entry.password && (
        <HashField
          label="PARTIAL PASSWORD"
          value={entry.password}
          info={partInfo}
          isPartial
        />
      )}

      {/* SHA-1 hash */}
      {entry.sha1 && (
        <HashField label="SHA-1 HASH" value={entry.sha1} info={sha1Info} />
      )}

      {/* MD5 hash */}
      {entry.hash && entry.hash !== entry.sha1 && (
        <HashField label="MD5 HASH" value={entry.hash} info={md5Info} />
      )}
    </motion.div>
  );
}

function HashField({
  label, value, info, isPartial = false,
}: {
  label: string;
  value: string;
  info: ReturnType<typeof detectHash> | null;
  isPartial?: boolean;
}) {
  if (!value || !info) return null;
  const diffColor = CRACK_DIFFICULTY_COLOR[info.crackable];

  return (
    <div className="space-y-1.5">
      {/* Label row */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[8px] uppercase tracking-widest text-[#00ff41]/30">{label}</span>
        <span
          className="text-[8px] font-mono font-bold px-1.5 py-0.5 border tracking-widest"
          style={{ color: info.color, borderColor: info.color + "50", backgroundColor: info.color + "10" }}
        >
          {info.algorithm}
        </span>
        {!isPartial && (
          <span className="text-[8px] font-mono" style={{ color: diffColor }}>
            {CRACK_DIFFICULTY_LABEL[info.crackable]}
          </span>
        )}
      </div>

      {/* Hash value */}
      <div className="flex items-center gap-2 flex-wrap">
        <code
          className="font-mono text-[10px] break-all flex-1"
          style={{ color: info.color }}
        >
          {value}
        </code>
        <CopyHashBtn hash={value} />
      </div>

      {/* Note */}
      <p className="text-[9px] font-mono text-[#00ff41]/30 leading-snug">
        {info.note}
      </p>

      {/* Crack buttons — only for non-partial, crackable hashes */}
      {!isPartial && info.crackable !== "infeasible" && (
        <div className="flex gap-2 flex-wrap pt-0.5">
          <CopyOpenBtn
            hash={value}
            label={`CRACK → ${info.bestTool.label}`}
            url={info.bestTool.url}
          />
          <CopyOpenBtn
            hash={value}
            label="CRACK → CrackStation"
            url="https://crackstation.net/"
          />
          <CopyOpenBtn
            hash={value}
            label="CRACK → Hashes.com"
            url="https://hashes.com/en/decrypt/hash"
          />
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function BreachPanel({ xon, breachDirectory }: Props) {

  // ── XON state ──
  if (!xon.ok) {
    return (
      <div className="terminal-card p-4 border border-[#555]/30">
        <div className="text-[9px] uppercase tracking-widest text-[#555] mb-2 flex items-center gap-1.5">
          <ShieldAlert className="w-3 h-3" /> BREACH DATABASE — XposedOrNot
        </div>
        <div className="text-[10px] font-mono text-[#555]">
          {xon.error === "RATE_LIMITED"
            ? "Rate limited — try again in a moment"
            : `Could not reach XposedOrNot: ${xon.error ?? "unknown error"}`}
        </div>
      </div>
    );
  }

  const xonData  = xon.data!;
  const bdData   = breachDirectory.ok ? breachDirectory.data : null;
  const sorted   = [...xonData.breaches].sort((a, b) => b.xposedDate.localeCompare(a.xposedDate));

  const hasPlaintext  = xonData.breaches.some((b) => b.passwordRisk === "ClearText");
  const hasEasyCrack  = xonData.breaches.some((b) => b.passwordRisk === "EasyToCrack");
  const criticalCount = xonData.breaches.filter((b) =>
    b.passwordRisk === "ClearText" || b.passwordRisk === "EasyToCrack"
  ).length;

  const borderColor = xonData.breachCount === 0
    ? "#00ff41"
    : hasPlaintext  ? "#ff1a1a"
    : hasEasyCrack  ? "#ff6600"
    : "#ff3e3e";

  return (
    <div className="terminal-card p-4 space-y-4" style={{ borderColor: borderColor + "40" }}>

      {/* ── Header ── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="text-[9px] uppercase tracking-widest text-[#00ff41]/40 mb-1.5 flex items-center gap-1.5">
            {xonData.breachCount === 0
              ? <ShieldCheck className="w-3 h-3 text-[#00ff41]" />
              : <ShieldAlert className="w-3 h-3" style={{ color: borderColor }} />}
            BREACH DATABASE — XposedOrNot · free · 1000+ sources
          </div>

          {xonData.breachCount === 0 ? (
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold font-mono text-[#00ff41]">CLEAN</span>
              <span className="text-xs font-mono text-[#00ff41]/50">
                — no exposures across 1000+ breach databases
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-2xl font-bold font-mono" style={{ color: borderColor }}>
                {xonData.breachCount} BREACH{xonData.breachCount !== 1 ? "ES" : ""}
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

        {xonData.breachCount > 0 && (
          <div className="flex gap-4 text-right shrink-0">
            {xonData.xposedDataTypes.length > 0 && (
              <div>
                <div className="text-[8px] uppercase tracking-widest text-[#00ff41]/30">Data Types</div>
                <div className="font-mono text-xs font-bold text-[#00d9ff] mt-0.5">
                  {xonData.xposedDataTypes.length}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Critical warnings ── */}
      {hasPlaintext && (
        <div className="flex items-center gap-2 p-2.5 border border-[#ff1a1a]/40 bg-[#ff1a1a]/5">
          <Key className="w-3.5 h-3.5 text-[#ff1a1a] shrink-0" />
          <span className="text-[10px] font-mono text-[#ff1a1a]">
            CRITICAL — Plaintext passwords exposed. Assume this password AND all reused passwords are compromised.
          </span>
        </div>
      )}
      {!hasPlaintext && hasEasyCrack && (
        <div className="flex items-center gap-2 p-2.5 border border-[#ff6600]/40 bg-[#ff6600]/5">
          <Key className="w-3.5 h-3.5 text-[#ff6600] shrink-0" />
          <span className="text-[10px] font-mono text-[#ff6600]">
            HIGH RISK — MD5/SHA-1 hashes exposed. Crackable with rainbow tables or Hashcat in minutes to hours.
          </span>
        </div>
      )}

      {/* ── All data types exposed ── */}
      {xonData.xposedDataTypes.length > 0 && (
        <div>
          <div className="text-[9px] uppercase tracking-widest text-[#00ff41]/30 mb-1.5">All Exposed Data Types</div>
          <div className="flex flex-wrap gap-1">
            {xonData.xposedDataTypes.map((dt) => <DataBadge key={dt} type={dt} />)}
          </div>
        </div>
      )}

      {/* ── CREDENTIAL HASHES from BreachDirectory ── */}
      {bdData && bdData.found > 0 && bdData.results.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 border-b border-[#ff3e3e]/20 pb-1">
            <Lock className="w-3 h-3 text-[#ff3e3e]" />
            <span className="text-[9px] uppercase tracking-widest text-[#ff3e3e]/70">
              CREDENTIAL HASHES — BreachDirectory · {bdData.found} record{bdData.found !== 1 ? "s" : ""} found
            </span>
          </div>
          <div className="space-y-3">
            {bdData.results.slice(0, 10).map((entry, i) => (
              <CredentialCard key={i} entry={entry} index={i} />
            ))}
            {bdData.results.length > 10 && (
              <div className="text-[9px] font-mono text-[#00ff41]/30 text-center">
                + {bdData.results.length - 10} more records (showing first 10)
              </div>
            )}
          </div>
        </div>
      ) : bdData && bdData.found === 0 ? (
        <div className="border border-[#00ff41]/10 p-3 space-y-1">
          <div className="text-[9px] uppercase tracking-widest text-[#00ff41]/40 flex items-center gap-1.5">
            <Lock className="w-3 h-3" /> CREDENTIAL HASHES — BreachDirectory
          </div>
          <div className="text-[10px] font-mono text-[#00ff41]/30">
            No credential records found in BreachDirectory for this email.
          </div>
        </div>
      ) : breachDirectory.error === "NOT_CONFIGURED" ? (
        /* Not configured — show setup prompt + manual crack tools */
        <div className="border border-[#555]/20 p-3 space-y-2.5 bg-[#00ff41]/[0.02]">
          <div className="text-[9px] uppercase tracking-widest text-[#555] flex items-center gap-1.5">
            <Lock className="w-3 h-3" /> CREDENTIAL HASHES — BreachDirectory
          </div>
          <p className="text-[10px] font-mono text-[#555] leading-relaxed">
            Add <code className="text-[#00ff41]/60">RAPIDAPI_KEY</code> to <code className="text-[#00ff41]/60">.env.local</code> to fetch actual password hashes from BreachDirectory.
            Free tier: 50 lookups/day. Sign up at{" "}
            <a href="https://rapidapi.com/rohan-patra/api/breachdirectory" target="_blank" rel="noopener noreferrer"
              className="text-[#00d9ff]/60 hover:text-[#00d9ff] underline-offset-2 underline transition-colors">
              rapidapi.com
            </a>
          </p>
          {/* Still show manual crack tools if XON says passwords were leaked */}
          {(hasPlaintext || hasEasyCrack) && (
            <div className="space-y-1.5 pt-1 border-t border-[#555]/20">
              <div className="text-[9px] uppercase tracking-widest text-[#555]">
                Online crack tools — paste your hash below:
              </div>
              <div className="flex gap-2 flex-wrap">
                {[
                  { label: "CrackStation", url: "https://crackstation.net/" },
                  { label: "Hashes.com", url: "https://hashes.com/en/decrypt/hash" },
                  { label: "Hashkiller", url: "https://hashkiller.io/listmanager" },
                ].map(({ label, url }) => (
                  <a key={label} href={url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[9px] font-mono px-2 py-1 border border-[#00d9ff]/30 text-[#00d9ff]/60 hover:text-[#00d9ff] hover:border-[#00d9ff] transition-all">
                    <ExternalLink className="w-2.5 h-2.5" /> {label}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* ── Breach list from XposedOrNot ── */}
      {sorted.length > 0 && (
        <div className="space-y-3">
          <div className="text-[9px] uppercase tracking-widest text-[#00ff41]/30 border-b border-[#00ff41]/10 pb-1">
            Breach Details — newest first
          </div>
          <div className="space-y-3 max-h-[28rem] overflow-y-auto pr-1">
            {sorted.map((b, i) => <BreachRow key={b.breach + i} breach={b} index={i} />)}
          </div>
        </div>
      )}

      {/* Clean state footer */}
      {xonData.breachCount === 0 && (
        <div className="text-[9px] font-mono text-[#00ff41]/25 border-t border-[#00ff41]/10 pt-3">
          Use the OSINT matrix below to cross-check HaveIBeenPwned, Dehashed, IntelligenceX, and LeakCheck.
        </div>
      )}
    </div>
  );
}
