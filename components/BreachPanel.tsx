"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  ShieldAlert, ShieldCheck, AlertTriangle, ExternalLink,
  Key, Copy, Check, Zap, Lock, Info,
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
  Unknown:     { label: "UNKNOWN",    color: "#888"    },
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
  "Dates of birth":         "#aaaaaa",
  "Geographic locations":   "#aaaaaa",
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

// Badges — higher contrast than before
function DataBadge({ type }: { type: string }) {
  const color = getDataTypeColor(type);
  return (
    <span
      className="text-[12px] font-mono font-semibold px-2 py-0.5 border tracking-wider"
      style={{ color, borderColor: color + "70", backgroundColor: color + "18" }}
    >
      {type.toUpperCase()}
    </span>
  );
}

function RiskBadge({ risk }: { risk: string }) {
  const m = PASSWORD_RISK_META[risk] ?? PASSWORD_RISK_META["Unknown"];
  return (
    <span
      className="text-[12px] font-mono font-bold px-2 py-0.5 border tracking-widest"
      style={{ color: m.color, borderColor: m.color + "70", backgroundColor: m.color + "18" }}
    >
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
      className={`flex items-center gap-1 text-[12px] font-mono px-2 py-1 border transition-all ${
        disabled
          ? "border-[#555]/40 text-[#888] cursor-not-allowed"
          : "border-[#00d9ff]/50 text-[#00d9ff] hover:border-[#00d9ff] hover:bg-[#00d9ff]/10 cursor-pointer"
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
      className="flex items-center gap-1 text-[12px] font-mono px-2 py-1 border border-[#00ff41]/40 text-[#00ff41]/70 hover:text-[#00ff41] hover:border-[#00ff41]/70 transition-all"
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
      className="border-l-2 pl-3 py-2.5 space-y-2"
      style={{ borderColor: accent + "70" }}
    >
      <div className="flex items-center justify-between flex-wrap gap-2">
        {/* Left: name + domain */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono font-bold text-sm" style={{ color: accent }}>
            {breach.breach}
          </span>
          {breach.domain && (
            <a
              href={`https://${breach.domain}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[13px] font-mono text-[#00ff41]/60 hover:text-[#00ff41] flex items-center gap-0.5 transition-colors"
            >
              {breach.domain} <ExternalLink className="w-2.5 h-2.5 inline ml-0.5" />
            </a>
          )}
          {breach.verified && (
            <span className="text-[12px] font-mono text-[#00ff41]/70 border border-[#00ff41]/40 px-1.5 py-0.5">
              VERIFIED
            </span>
          )}
        </div>

        {/* Right: year + records + risk badge */}
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <span className="text-[13px] font-mono text-[#00ff41]/70 font-semibold">{year}</span>
          {breach.xposedRecords > 0 && (
            <span className="text-[13px] font-mono text-[#00ff41]/60">
              {formatCount(breach.xposedRecords)} records
            </span>
          )}
          {hasPassword && <RiskBadge risk={breach.passwordRisk} />}
        </div>
      </div>

      {/* Data type badges */}
      {breach.xposedData.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {breach.xposedData.map((dt) => <DataBadge key={dt} type={dt} />)}
        </div>
      )}
    </motion.div>
  );
}

// ── Credential hash card ──────────────────────────────────────────────────────

function CredentialCard({
  entry, index,
}: { entry: { password: string; sha1: string; hash: string; sources: string[] }; index: number }) {
  const sha1Info  = entry.sha1  ? detectHash(entry.sha1)  : null;
  const md5Info   = entry.hash  ? detectHash(entry.hash)   : null;
  const partInfo  = entry.password ? detectHash(entry.password) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.07 }}
      className="border border-[#ff3e3e]/30 bg-[#ff3e3e]/[0.04] p-3 space-y-3"
    >
      {/* Sources */}
      {entry.sources.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[12px] uppercase tracking-widest text-[#00ff41]/60">Source:</span>
          {entry.sources.map((s) => (
            <span key={s} className="text-[13px] font-mono text-[#00d9ff]/80 border border-[#00d9ff]/30 px-1.5 py-0.5">
              {s}
            </span>
          ))}
        </div>
      )}

      {entry.password && (
        <HashField label="PARTIAL PASSWORD" value={entry.password} info={partInfo} isPartial />
      )}
      {entry.sha1 && (
        <HashField label="SHA-1 HASH" value={entry.sha1} info={sha1Info} />
      )}
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
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[12px] uppercase tracking-widest text-[#00ff41]/60">{label}</span>
        <span
          className="text-[12px] font-mono font-bold px-1.5 py-0.5 border tracking-widest"
          style={{ color: info.color, borderColor: info.color + "60", backgroundColor: info.color + "15" }}
        >
          {info.algorithm}
        </span>
        {!isPartial && (
          <span className="text-[12px] font-mono font-semibold" style={{ color: diffColor }}>
            {CRACK_DIFFICULTY_LABEL[info.crackable]}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <code className="font-mono text-[13px] break-all flex-1" style={{ color: info.color }}>
          {value}
        </code>
        <CopyHashBtn hash={value} />
      </div>

      <p className="text-[12px] font-mono text-[#00ff41]/55 leading-snug">{info.note}</p>

      {!isPartial && info.crackable !== "infeasible" && (
        <div className="flex gap-2 flex-wrap pt-0.5">
          <CopyOpenBtn hash={value} label={`CRACK → ${info.bestTool.label}`} url={info.bestTool.url} />
          <CopyOpenBtn hash={value} label="CRACK → CrackStation" url="https://crackstation.net/" />
          <CopyOpenBtn hash={value} label="CRACK → Hashes.com" url="https://hashes.com/en/decrypt/hash" />
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function BreachPanel({ xon, breachDirectory }: Props) {

  if (!xon.ok) {
    return (
      <div className="terminal-card p-4 border border-[#555]/30">
        <div className="text-[13px] uppercase tracking-widest text-[#888] mb-2 flex items-center gap-1.5">
          <ShieldAlert className="w-3 h-3" /> BREACH DATABASE — XposedOrNot
        </div>
        <div className="text-xs font-mono text-[#aaa]">
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

  const bdConfigured = breachDirectory.error !== "NOT_CONFIGURED";
  const bdHasCredentials = bdData && bdData.found > 0 && bdData.results.length > 0;

  return (
    <div className="terminal-card p-4 space-y-4" style={{ borderColor: borderColor + "50" }}>

      {/* ── Header ── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="text-[13px] uppercase tracking-widest text-[#00ff41]/60 mb-1.5 flex items-center gap-1.5">
            {xonData.breachCount === 0
              ? <ShieldCheck className="w-3 h-3 text-[#00ff41]" />
              : <ShieldAlert className="w-3 h-3" style={{ color: borderColor }} />}
            BREACH DATABASE — XposedOrNot · free · 1000+ sources
          </div>

          {xonData.breachCount === 0 ? (
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold font-mono text-[#00ff41]">CLEAN</span>
              <span className="text-xs font-mono text-[#00ff41]/60">
                — no exposures across 1000+ breach databases
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-2xl font-bold font-mono" style={{ color: borderColor }}>
                {xonData.breachCount} BREACH{xonData.breachCount !== 1 ? "ES" : ""}
              </span>
              {criticalCount > 0 && (
                <span className="text-xs font-mono flex items-center gap-1" style={{ color: borderColor }}>
                  <AlertTriangle className="w-3 h-3" />
                  {criticalCount} with crackable passwords
                </span>
              )}
            </div>
          )}
        </div>

        {xonData.breachCount > 0 && xonData.xposedDataTypes.length > 0 && (
          <div className="text-right shrink-0">
            <div className="text-[12px] uppercase tracking-widest text-[#00ff41]/50">Unique Data Types</div>
            <div className="font-mono text-sm font-bold text-[#00d9ff] mt-0.5">
              {xonData.xposedDataTypes.length}
            </div>
          </div>
        )}
      </div>

      {/* ── What these results mean ── */}
      {xonData.breachCount > 0 && (
        <div className="flex items-start gap-2 p-3 border border-[#00d9ff]/20 bg-[#00d9ff]/[0.04]">
          <Info className="w-3.5 h-3.5 text-[#00d9ff]/70 shrink-0 mt-0.5" />
          <div className="text-[13px] font-mono text-[#00d9ff]/80 leading-relaxed">
            <span className="font-bold text-[#00d9ff]">What this means:</span> The badges below show
            WHICH types of data were stolen in each breach (e.g. &ldquo;Passwords&rdquo;, &ldquo;Phone Numbers&rdquo;).
            To see the <span className="text-[#00d9ff] font-bold">actual leaked credential hashes</span> for
            this specific email, enable BreachDirectory below — it returns the real SHA-1/MD5 password hashes
            that can be cracked with one click.
          </div>
        </div>
      )}

      {/* ── Critical warnings ── */}
      {hasPlaintext && (
        <div className="flex items-center gap-2 p-3 border border-[#ff1a1a]/50 bg-[#ff1a1a]/[0.06]">
          <Key className="w-3.5 h-3.5 text-[#ff1a1a] shrink-0" />
          <span className="text-xs font-mono text-[#ff1a1a]">
            CRITICAL — Plaintext passwords exposed. Assume this password AND all reused passwords are compromised.
          </span>
        </div>
      )}
      {!hasPlaintext && hasEasyCrack && (
        <div className="flex items-center gap-2 p-3 border border-[#ff6600]/50 bg-[#ff6600]/[0.06]">
          <Key className="w-3.5 h-3.5 text-[#ff6600] shrink-0" />
          <span className="text-xs font-mono text-[#ff6600]">
            HIGH RISK — MD5/SHA-1 hashes exposed. Crackable with rainbow tables or Hashcat in minutes to hours.
          </span>
        </div>
      )}

      {/* ── All data types summary ── */}
      {xonData.xposedDataTypes.length > 0 && (
        <div>
          <div className="text-[12px] uppercase tracking-widest text-[#00ff41]/60 mb-2">All Exposed Data Types (across all breaches)</div>
          <div className="flex flex-wrap gap-1.5">
            {xonData.xposedDataTypes.map((dt) => <DataBadge key={dt} type={dt} />)}
          </div>
        </div>
      )}

      {/* ── CREDENTIAL HASHES — BreachDirectory ── */}
      {bdHasCredentials ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 border-b border-[#ff3e3e]/30 pb-2">
            <Lock className="w-3 h-3 text-[#ff3e3e]" />
            <span className="text-[13px] uppercase tracking-widest text-[#ff3e3e]/80 font-semibold">
              ACTUAL CREDENTIAL HASHES — BreachDirectory · {bdData.found} record{bdData.found !== 1 ? "s" : ""} found
            </span>
          </div>
          <p className="text-[13px] font-mono text-[#00ff41]/60 leading-relaxed">
            These are the real password hashes from breach databases for this email. Click
            &ldquo;CRACK&rdquo; to copy the hash and open a cracking tool in one action.
          </p>
          <div className="space-y-3">
            {bdData.results.slice(0, 10).map((entry, i) => (
              <CredentialCard key={i} entry={entry} index={i} />
            ))}
            {bdData.results.length > 10 && (
              <div className="text-[13px] font-mono text-[#00ff41]/50 text-center border border-[#00ff41]/15 py-2">
                + {bdData.results.length - 10} more records (showing first 10)
              </div>
            )}
          </div>
        </div>
      ) : bdData && bdData.found === 0 ? (
        <div className="border border-[#00ff41]/15 p-3 space-y-1">
          <div className="text-[13px] uppercase tracking-widest text-[#00ff41]/60 flex items-center gap-1.5">
            <Lock className="w-3 h-3" /> CREDENTIAL HASHES — BreachDirectory
          </div>
          <div className="text-[13px] font-mono text-[#00ff41]/60">
            No credential records found in BreachDirectory for this email.
          </div>
        </div>
      ) : !bdConfigured ? (
        /* NOT CONFIGURED — prominent setup guide */
        <div className="border border-[#ffaa00]/30 p-4 space-y-3 bg-[#ffaa00]/[0.04]">
          <div className="flex items-center gap-2">
            <Lock className="w-3.5 h-3.5 text-[#ffaa00]" />
            <span className="text-[13px] uppercase tracking-widest text-[#ffaa00] font-bold">
              GET ACTUAL LEAKED PASSWORDS — BreachDirectory Setup
            </span>
          </div>

          <p className="text-[13px] font-mono text-[#ffaa00]/80 leading-relaxed">
            BreachDirectory holds <span className="text-[#ffaa00] font-bold">real password hashes</span> from
            3.5 billion+ leaked credentials. Add a free API key to see the actual SHA-1 / MD5 hashes
            for this email with one-click crack buttons.
          </p>

          <div className="space-y-1.5 border-t border-[#ffaa00]/20 pt-3">
            <div className="text-[12px] uppercase tracking-widest text-[#ffaa00]/70">3 steps to enable:</div>
            <div className="text-[13px] font-mono text-[#00ff41]/80 space-y-1">
              <div><span className="text-[#ffaa00]">1.</span> Go to{" "}
                <a href="https://rapidapi.com/rohan-patra/api/breachdirectory" target="_blank" rel="noopener noreferrer"
                  className="text-[#00d9ff] underline underline-offset-2 hover:text-[#00d9ff]/80">
                  rapidapi.com → BreachDirectory
                </a>
                {" "}→ Subscribe to the <span className="text-[#00ff41]">free tier</span> (50 lookups/day)
              </div>
              <div><span className="text-[#ffaa00]">2.</span> Copy your RapidAPI key from the dashboard</div>
              <div>
                <span className="text-[#ffaa00]">3.</span> Add to{" "}
                <code className="text-[#00ff41] bg-[#00ff41]/10 px-1">.env.local</code>:
                {" "}<code className="text-[#00ff41] bg-[#00ff41]/10 px-1">RAPIDAPI_KEY=your_key_here</code>
                {" "}then restart
              </div>
            </div>
          </div>

          {/* Manual crack tools — always available */}
          {(hasPlaintext || hasEasyCrack) && (
            <div className="space-y-2 border-t border-[#ffaa00]/20 pt-3">
              <div className="text-[12px] uppercase tracking-widest text-[#00ff41]/60">
                Meanwhile — paste hashes from HaveIBeenPwned or Dehashed into these:
              </div>
              <div className="flex gap-2 flex-wrap">
                {[
                  { label: "CrackStation",  url: "https://crackstation.net/" },
                  { label: "Hashes.com",    url: "https://hashes.com/en/decrypt/hash" },
                  { label: "Hashkiller",    url: "https://hashkiller.io/listmanager" },
                  { label: "Dehashed",      url: "https://dehashed.com" },
                ].map(({ label, url }) => (
                  <a key={label} href={url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[13px] font-mono px-2 py-1 border border-[#00d9ff]/40 text-[#00d9ff] hover:text-[#00d9ff] hover:border-[#00d9ff]/70 hover:bg-[#00d9ff]/10 transition-all">
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
          <div className="text-[13px] uppercase tracking-widest text-[#00ff41]/60 border-b border-[#00ff41]/15 pb-2 font-semibold">
            Breach Details — newest first
          </div>
          <div className="space-y-3 max-h-[32rem] overflow-y-auto pr-1 scrollbar-thin">
            {sorted.map((b, i) => <BreachRow key={b.breach + i} breach={b} index={i} />)}
          </div>
        </div>
      )}

      {/* Clean state footer */}
      {xonData.breachCount === 0 && (
        <div className="text-[13px] font-mono text-[#00ff41]/50 border-t border-[#00ff41]/15 pt-3">
          Use the OSINT matrix below to cross-check HaveIBeenPwned, Dehashed, IntelligenceX, and LeakCheck.
        </div>
      )}
    </div>
  );
}
