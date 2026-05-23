"use client";

import { motion } from "framer-motion";
import {
  Phone, Copy, Download, Activity,
} from "lucide-react";
import type { LookupResponse } from "@/lib/types";
import { countryToFlagEmoji } from "@/lib/phoneAnalysis";
import SourceTabs from "./SourceTabs";
import OsintPivots from "./OsintPivots";
import NumberAnatomyPanel from "./NumberAnatomyPanel";
import CountryPanel from "./CountryPanel";
import ShareButton from "./ShareButton";
import SimIntelPanel from "./SimIntelPanel";
import QrCodePanel from "./QrCodePanel";
import PentesterPanel from "./PentesterPanel";
import DorkGenerator from "./DorkGenerator";
import NumberPermutations from "./NumberPermutations";
import ReportExport from "./ReportExport";
import LocationPanel from "./LocationPanel";
import PhoneIdentityPanel from "./PhoneIdentityPanel";
import BreachPanel from "./BreachPanel";
import InfostealerPanel from "./InfostealerPanel";
import { cn, copyText } from "@/lib/utils";

interface Props {
  data: LookupResponse;
}

function copyToClipboard(text: string) {
  void copyText(text);
}

function downloadJson(data: LookupResponse) {
  const e164 = data.input.e164.replace("+", "");
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${e164}_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Inline ThreatScoreBar — mirrors the email panel so phone & email look consistent
function ThreatScoreBar({ score, label }: { score: number; label: string }) {
  const color = score >= 70 ? "#ff1a1a" : score >= 40 ? "#ff6600" : score >= 20 ? "#ffaa00" : "#00ff41";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5" style={{ color }} />
          <span className="text-[12px] uppercase tracking-widest text-[#00ff41]/70">Threat Score</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold text-lg" style={{ color }}>{score}</span>
          <span className="text-[12px] font-mono text-[#00ff41]/55">/100</span>
          <span
            className="text-[12px] font-mono font-bold px-2 py-0.5 border tracking-widest"
            style={{ color, borderColor: color + "70", backgroundColor: color + "18" }}
          >
            {label}
          </span>
        </div>
      </div>
      <div className="w-full h-1.5 bg-[#00ff41]/10 relative">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="h-full"
          style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}60` }}
        />
      </div>
    </div>
  );
}

export default function ResultsDashboard({ data }: Props) {
  const { input, aggregated, sources, countryIntel, threatScore, threatLabel } = data;
  const flag = countryToFlagEmoji(input.country);

  // Active data-source count for the status strip
  const configuredSourceErrors: (string | undefined)[] = [
    sources.numverify.error, sources.ipqs.error, sources.abstract.error,
    sources.twilio.error, sources.breachDirectory.error, sources.fullContact.error,
  ];
  const activeSourcesCount = [
    sources.numverify, sources.ipqs, sources.abstract, sources.twilio,
    sources.breachDirectory, sources.fullContact, sources.hudsonRock,
  ].filter((s) => s.ok).length;
  const configuredCount = configuredSourceErrors.filter((e) => e !== "NOT_CONFIGURED").length;

  const hasSimData = !!(
    aggregated.prepaid !== null || aggregated.active !== null ||
    aggregated.mobileCountryCode || aggregated.userActivity || aggregated.carrier
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="space-y-4 mt-6"
    >
      {/* ── HEADER: number + flag + status badges ───────────────────────────── */}
      <div className="terminal-card p-5 space-y-4">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-4xl">{flag}</span>
            <div>
              <div className="text-2xl font-bold glow-green tracking-wider font-mono">{input.e164}</div>
              <div className="text-sm text-[#00ff41]/60 mt-0.5 font-mono">
                {input.national} · {aggregated.countryName} ({input.countryCallingCode})
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn(
              "text-xs px-3 py-1 border font-mono font-bold tracking-widest",
              input.isValid ? "badge-valid" : "badge-invalid"
            )}>
              {input.isValid ? "✓ VALID" : "✗ INVALID"}
            </span>
            {data.cachedAt && (
              <span className="text-[13px] border badge-neutral px-2 py-1 font-mono">CACHED</span>
            )}
          </div>
        </div>

        {/* Unified threat score */}
        <div className="border-t border-[#00ff41]/10 pt-3">
          <ThreatScoreBar score={threatScore} label={threatLabel} />
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 flex-wrap pt-1 border-t border-[#00ff41]/10">
          <button
            onClick={() => copyToClipboard(input.e164)}
            className="flex items-center gap-1.5 text-xs border border-[#00ff41]/30 px-3 py-1.5 text-[#00ff41]/70 hover:text-[#00ff41] hover:border-[#00ff41]/60 transition-colors font-mono"
          >
            <Copy className="w-3 h-3" /> COPY E.164
          </button>
          <button
            onClick={() => copyToClipboard(aggregated.formatInternational)}
            className="flex items-center gap-1.5 text-xs border border-[#00ff41]/30 px-3 py-1.5 text-[#00ff41]/70 hover:text-[#00ff41] hover:border-[#00ff41]/60 transition-colors font-mono"
          >
            <Copy className="w-3 h-3" /> COPY INTL
          </button>
          <button
            onClick={() => downloadJson(data)}
            className="flex items-center gap-1.5 text-xs border border-[#00d9ff]/30 px-3 py-1.5 text-[#00d9ff]/70 hover:text-[#00d9ff] hover:border-[#00d9ff]/60 transition-colors font-mono"
          >
            <Download className="w-3 h-3" /> EXPORT JSON
          </button>
          <ShareButton e164={input.e164} />
          <ReportExport data={data} />
        </div>

        {/* Data source status strip */}
        <div className="flex items-center gap-3 pt-1 border-t border-[#00ff41]/10 flex-wrap">
          <div className="text-[12px] uppercase tracking-widest text-[#00ff41]/50 font-mono">DATA SOURCES</div>
          <div className="flex gap-2 flex-wrap">
            {[
              { label: "libphonenumber",  ok: true,                        always: true },
              { label: "Hudson Rock",     ok: sources.hudsonRock.ok,       configured: true },
              { label: "NumVerify",       ok: sources.numverify.ok,        configured: sources.numverify.error !== "NOT_CONFIGURED" },
              { label: "IPQS",            ok: sources.ipqs.ok,             configured: sources.ipqs.error !== "NOT_CONFIGURED" },
              { label: "Abstract",        ok: sources.abstract.ok,         configured: sources.abstract.error !== "NOT_CONFIGURED" },
              { label: "Twilio",          ok: sources.twilio.ok,           configured: sources.twilio.error !== "NOT_CONFIGURED" },
              { label: "BreachDirectory", ok: sources.breachDirectory.ok,  configured: sources.breachDirectory.error !== "NOT_CONFIGURED" },
              { label: "FullContact",     ok: sources.fullContact.ok,      configured: sources.fullContact.error !== "NOT_CONFIGURED" },
            ].map((s) => (
              <span
                key={s.label}
                className={`text-[12px] font-mono px-1.5 py-0.5 border ${
                  s.ok
                    ? "text-[#00ff41] border-[#00ff41]/30 bg-[#00ff41]/5"
                    : "configured" in s && s.configured
                    ? "text-[#ff3e3e]/60 border-[#ff3e3e]/20"
                    : "text-[#00ff41]/45 border-[#00ff41]/10"
                }`}
              >
                {s.ok ? "✓" : ("always" in s && s.always) ? "✓" : "·"} {s.label}
              </span>
            ))}
          </div>
          {activeSourcesCount <= 1 && configuredCount === 0 && (
            <span className="text-[12px] text-[#ffaa00]/60 font-mono">
              + carrier/breach/identity APIs: see .env.local for free-tier keys
            </span>
          )}
        </div>
      </div>

      {/* ── IDENTITY (FullContact + CNAM + free-lookup action center) ───────── */}
      <PhoneIdentityPanel data={data} />

      {/* ── BREACH DATA (BreachDirectory + free-lookup action center) ──────── */}
      <BreachPanel
        breachDirectory={sources.breachDirectory}
        subjectLabel="this phone number"
        e164={input.e164}
      />

      {/* ── INFOSTEALER MALWARE (Hudson Rock — free, always-on) ─────────────── */}
      <InfostealerPanel data={data} />

      {/* ── Pentester intelligence — core value of the tool ─────────────────── */}
      <PentesterPanel data={data} />

      {/* ── Consolidated metadata: location + anatomy ───────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <LocationPanel data={data} />
        {countryIntel ? <CountryPanel intel={countryIntel} /> : <div />}
      </div>

      {/* ── Number anatomy (replaces 3 old duplicate panels) ────────────────── */}
      <NumberAnatomyPanel data={data} />

      {/* ── SIM intelligence + QR code ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {hasSimData
          ? <SimIntelPanel aggregated={aggregated} />
          : <PlaceholderCard
              icon={<Phone className="w-3 h-3" />}
              title="SIM & CARRIER INTELLIGENCE"
              note="Add IPQS or Twilio API keys to .env.local for live carrier, prepaid, and SIM activity data." />}
        <QrCodePanel e164={input.e164} />
      </div>

      {/* ── Number permutations + Dork generator side-by-side on desktop ───── */}
      <NumberPermutations data={data} />
      <DorkGenerator e164={input.e164} national={input.national} />

      {/* ── OSINT pivots ────────────────────────────────────────────────────── */}
      <OsintPivots e164={input.e164} national={input.national} country={input.country} />

      {/* ── Raw source data ─────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="text-[13px] uppercase tracking-widest text-[#00ff41]/60">
          [ RAW SOURCE DATA ] — API responses
        </div>
        <SourceTabs sources={sources} />
      </div>
    </motion.div>
  );
}

function PlaceholderCard({ icon, title, note }: { icon: React.ReactNode; title: string; note: string }) {
  return (
    <div className="terminal-card p-4 space-y-2">
      <div className="text-[12px] uppercase tracking-widest text-[#00ff41]/70 flex items-center gap-1.5">
        {icon} {title}
      </div>
      <div className="text-[12px] font-mono text-[#00ff41]/55 italic">{note}</div>
    </div>
  );
}
