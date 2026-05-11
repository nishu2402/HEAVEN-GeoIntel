"use client";

import { motion } from "framer-motion";
import {
  Wifi, Phone, MapPin, Clock, Shield,
  Copy, Download, Hash, Globe, User, CreditCard,
  Activity, Radio, AlertTriangle,
} from "lucide-react";
import type { LookupResponse } from "@/lib/types";
import { countryToFlagEmoji } from "@/lib/phoneAnalysis";
import MetricCard from "./MetricCard";
import FraudScoreBar from "./FraudScoreBar";
import SourceTabs from "./SourceTabs";
import OsintPivots from "./OsintPivots";
import NumberBreakdown from "./NumberBreakdown";
import CountryPanel from "./CountryPanel";
import FormatPanel from "./FormatPanel";
import ShareButton from "./ShareButton";
import SimIntelPanel from "./SimIntelPanel";
import QrCodePanel from "./QrCodePanel";
import PentesterPanel from "./PentesterPanel";
import DorkGenerator from "./DorkGenerator";
import NumberPermutations from "./NumberPermutations";
import ReportExport from "./ReportExport";
import { cn } from "@/lib/utils";

interface Props {
  data: LookupResponse;
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(console.error);
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

export default function ResultsDashboard({ data }: Props) {
  const { input, aggregated, sources, analysis, countryIntel } = data;
  const flag = countryToFlagEmoji(input.country);

  // Build only the cards that have real, meaningful data
  type CardDef = {
    label: string;
    value: string;
    icon?: React.ReactNode;
    variant?: "default" | "warn" | "danger" | "cyan" | "neutral";
    index: number;
  };

  const cards: CardDef[] = [];
  let idx = 0;

  // --- Always-available offline data ---
  // Country
  cards.push({ label: "Country", value: aggregated.countryName, icon: <Globe className="w-3 h-3" />, variant: "default", index: idx++ });

  // US/CA area code intelligence (offline — no API needed)
  if (analysis.npaInfo) {
    cards.push({ label: "State / Province", value: `${analysis.npaInfo.state} (${analysis.npaInfo.stateAbbr})`, icon: <MapPin className="w-3 h-3" />, variant: "cyan", index: idx++ });
    cards.push({ label: "Region / Metro", value: analysis.npaInfo.region, icon: <MapPin className="w-3 h-3" />, variant: "cyan", index: idx++ });
  }

  // Calling code
  cards.push({ label: "Calling Code", value: input.countryCallingCode, icon: <Phone className="w-3 h-3" />, variant: "cyan", index: idx++ });

  // Number type — show what we actually know
  if (aggregated.isAmbiguousType) {
    cards.push({ label: "Number Type", value: "Mobile or Landline", icon: <Wifi className="w-3 h-3" />, variant: "neutral", index: idx++ });
  } else if (aggregated.typeDescription && aggregated.typeDescription !== "Unknown") {
    const typeVariant =
      aggregated.isVoip ? "warn" :
      analysis.isPremiumRate ? "danger" :
      analysis.isTollFree ? "cyan" :
      "default";
    cards.push({ label: "Number Type", value: aggregated.typeDescription, icon: <Wifi className="w-3 h-3" />, variant: typeVariant, index: idx++ });
  }

  // Timezone
  const tzDisplay = aggregated.utcOffsets?.[0] ?? aggregated.timezone?.[0]?.split("/").pop() ?? null;
  if (tzDisplay) {
    cards.push({ label: "Timezone", value: tzDisplay, icon: <Clock className="w-3 h-3" />, variant: "default", index: idx++ });
  }

  // IANA timezone name
  if (aggregated.timezone?.[0]) {
    cards.push({ label: "IANA Timezone", value: aggregated.timezone[0], icon: <Clock className="w-3 h-3" />, variant: "neutral", index: idx++ });
  }

  // Area code (only for countries where it's meaningful)
  if (aggregated.areaCode) {
    cards.push({ label: "Area Code", value: aggregated.areaCode, icon: <MapPin className="w-3 h-3" />, variant: "cyan", index: idx++ });
  }

  // Number length vs expected
  if (aggregated.numberLength) {
    const expectedStr = analysis.expectedLengths.length > 0 ? ` / ${analysis.expectedLengths.join(" or ")} expected` : "";
    cards.push({ label: "Digit Count", value: `${aggregated.numberLength} digits${expectedStr}`, icon: <Hash className="w-3 h-3" />, variant: "neutral", index: idx++ });
  }

  // --- Confirmed type flags (only show when definitively true) ---
  if (aggregated.isMobile === true) {
    cards.push({ label: "Confirmed Mobile", value: "YES", variant: "default", index: idx++ });
  }
  if (aggregated.isFixedLine === true) {
    cards.push({ label: "Confirmed Landline", value: "YES", variant: "cyan", index: idx++ });
  }
  if (aggregated.isVoip === true) {
    cards.push({ label: "VOIP / Internet", value: "CONFIRMED VOIP", icon: <AlertTriangle className="w-3 h-3" />, variant: "warn", index: idx++ });
  }
  if (analysis.isTollFree) {
    cards.push({ label: "Toll-Free", value: "YES — FREE TO CALL", variant: "cyan", index: idx++ });
  }
  if (analysis.isPremiumRate) {
    cards.push({ label: "Premium Rate", value: "YES — CHARGES APPLY", icon: <AlertTriangle className="w-3 h-3" />, variant: "danger", index: idx++ });
  }
  if (analysis.isSharedCost) {
    cards.push({ label: "Shared Cost", value: "YES", variant: "warn", index: idx++ });
  }
  if (analysis.isPersonalNumber) {
    cards.push({ label: "Personal Number", value: "YES", variant: "neutral", index: idx++ });
  }

  // --- API-enriched data (only show if we actually have it) ---
  if (aggregated.callerName) {
    cards.push({ label: "Owner / CNAM", value: aggregated.callerName, icon: <User className="w-3 h-3" />, variant: "cyan", index: idx++ });
  }
  if (aggregated.callerType) {
    cards.push({ label: "Caller Type", value: aggregated.callerType.charAt(0).toUpperCase() + aggregated.callerType.slice(1), icon: <User className="w-3 h-3" />, variant: "neutral", index: idx++ });
  }
  if (aggregated.carrier) {
    cards.push({ label: "Network Carrier", value: aggregated.carrier, icon: <Phone className="w-3 h-3" />, variant: "cyan", index: idx++ });
  }
  if (aggregated.prepaid !== null) {
    cards.push({ label: "Prepaid SIM", value: aggregated.prepaid ? "YES — PREPAID" : "NO — CONTRACT", icon: <CreditCard className="w-3 h-3" />, variant: aggregated.prepaid ? "warn" : "default", index: idx++ });
  }
  if (aggregated.active !== null) {
    cards.push({ label: "Line Active", value: aggregated.active ? "ACTIVE" : "INACTIVE", icon: <Activity className="w-3 h-3" />, variant: aggregated.active ? "default" : "danger", index: idx++ });
  }
  if (aggregated.activeStatus) {
    cards.push({ label: "Active Status", value: aggregated.activeStatus, variant: "neutral", index: idx++ });
  }
  if (aggregated.userActivity) {
    cards.push({ label: "User Activity", value: aggregated.userActivity, variant: "neutral", index: idx++ });
  }
  if (aggregated.region) {
    cards.push({ label: "Region", value: aggregated.region, icon: <MapPin className="w-3 h-3" />, variant: "cyan", index: idx++ });
  }
  if (aggregated.city) {
    cards.push({ label: "City", value: aggregated.city, icon: <MapPin className="w-3 h-3" />, variant: "cyan", index: idx++ });
  }
  if (aggregated.mobileCountryCode && aggregated.mobileNetworkCode) {
    cards.push({ label: "MCC / MNC", value: `${aggregated.mobileCountryCode} / ${aggregated.mobileNetworkCode}`, icon: <Radio className="w-3 h-3" />, variant: "cyan", index: idx++ });
  }
  if (aggregated.recentAbuse === true) {
    cards.push({ label: "Recent Abuse", value: "DETECTED", icon: <Shield className="w-3 h-3" />, variant: "danger", index: idx++ });
  }
  if (aggregated.isRisky === true) {
    cards.push({ label: "Risk Flag", value: "HIGH RISK", icon: <Shield className="w-3 h-3" />, variant: "danger", index: idx++ });
  }

  // How many API sources returned useful data
  const activeSources = [sources.numverify, sources.ipqs, sources.abstract, sources.twilio].filter(
    (s) => s.ok
  ).length;
  const configuredSources = [sources.numverify, sources.ipqs, sources.abstract, sources.twilio].filter(
    (s) => !s.ok && s.error !== "NOT_CONFIGURED"
  ).length + activeSources;

  const hasSimData = !!(
    aggregated.callerName || aggregated.prepaid !== null || aggregated.active !== null ||
    aggregated.mobileCountryCode || aggregated.userActivity || aggregated.city ||
    aggregated.carrier || aggregated.associatedEmails
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="space-y-4 mt-6"
    >
      {/* ── Result header ── */}
      <div className="terminal-card p-5 space-y-3">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-widest text-[#00ff41]/40">LOOKUP RESULT</div>

            {/* Owner name — most prominent element when available */}
            {aggregated.callerName ? (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-[#00d9ff] shrink-0" />
                  <span className="text-2xl font-bold text-[#00d9ff] font-mono tracking-wide">
                    {aggregated.callerName}
                  </span>
                  {aggregated.callerType && (
                    <span className="text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 border text-[#00d9ff]/50 border-[#00d9ff]/25">
                      {aggregated.callerType}
                    </span>
                  )}
                  <span className="text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 border text-[#00ff41] border-[#00ff41]/30 bg-[#00ff41]/5">
                    ✓ CNAM CONFIRMED
                  </span>
                </div>
                <div className="flex items-center gap-3 flex-wrap pl-6">
                  <span className="text-2xl">{flag}</span>
                  <div>
                    <div className="text-xl font-bold glow-green tracking-wider font-mono">{input.e164}</div>
                    <div className="text-sm text-[#00ff41]/60 font-mono">
                      {input.national} · {aggregated.countryName} ({input.countryCallingCode})
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-4xl">{flag}</span>
                <div>
                  <div className="text-2xl font-bold glow-green tracking-wider font-mono">{input.e164}</div>
                  <div className="text-sm text-[#00ff41]/60 mt-0.5 font-mono">
                    {input.national} · {aggregated.countryName} ({input.countryCallingCode})
                  </div>
                  <div className="flex items-center gap-1.5 mt-1 text-[10px] font-mono text-[#555]">
                    <User className="w-3 h-3" />
                    Owner name not found — add Twilio or IPQS key, or use pivot links below
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn(
              "text-xs px-3 py-1 border font-mono font-bold tracking-widest",
              input.isValid ? "badge-valid" : "badge-invalid"
            )}>
              {input.isValid ? "✓ VALID" : "✗ INVALID"}
            </span>
            {aggregated.typeDescription && aggregated.typeDescription !== "Unknown" && (
              <span className="text-xs px-3 py-1 border badge-info font-mono">
                {aggregated.typeDescription.toUpperCase()}
              </span>
            )}
            {aggregated.isAmbiguousType && (
              <span className="text-xs px-2 py-1 border font-mono text-[#888] border-[#888]/30" title="libphonenumber cannot determine if this is mobile or landline from the number structure alone">
                TYPE AMBIGUOUS
              </span>
            )}
            {aggregated.prepaid && (
              <span className="text-xs px-2 py-1 border font-mono text-[#ffaa00] border-[#ffaa00]/40 bg-[#ffaa00]/5">
                PREPAID
              </span>
            )}
            {aggregated.active === false && (
              <span className="text-xs px-2 py-1 border font-mono text-[#ff3e3e] border-[#ff3e3e]/40">
                INACTIVE LINE
              </span>
            )}
            {data.cachedAt && (
              <span className="text-[10px] border badge-neutral px-2 py-1 font-mono">CACHED</span>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 flex-wrap pt-1">
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

        {/* Data source status */}
        <div className="flex items-center gap-3 pt-1 border-t border-[#00ff41]/10">
          <div className="text-[9px] uppercase tracking-widest text-[#00ff41]/25 font-mono">DATA SOURCES</div>
          <div className="flex gap-2">
            {[
              { label: "libphonenumber", ok: true, always: true },
              { label: "NumVerify", ok: sources.numverify.ok, configured: sources.numverify.error !== "NOT_CONFIGURED" },
              { label: "IPQS", ok: sources.ipqs.ok, configured: sources.ipqs.error !== "NOT_CONFIGURED" },
              { label: "Abstract", ok: sources.abstract.ok, configured: sources.abstract.error !== "NOT_CONFIGURED" },
              { label: "Twilio", ok: sources.twilio.ok, configured: sources.twilio.error !== "NOT_CONFIGURED" },
            ].map((s) => (
              <span
                key={s.label}
                className={`text-[9px] font-mono px-1.5 py-0.5 border ${
                  s.ok
                    ? "text-[#00ff41] border-[#00ff41]/30 bg-[#00ff41]/5"
                    : "configured" in s && s.configured
                    ? "text-[#ff3e3e]/60 border-[#ff3e3e]/20"
                    : "text-[#00ff41]/20 border-[#00ff41]/10"
                }`}
              >
                {s.ok ? "✓" : ("always" in s && s.always) ? "✓" : "·"} {s.label}
              </span>
            ))}
          </div>
          {activeSources === 0 && configuredSources === 0 && (
            <span className="text-[9px] text-[#ffaa00]/50 font-mono ml-auto">
              + carrier/fraud data: add keys to .env.local
            </span>
          )}
        </div>
      </div>

      {/* ── Owner identity — find name when CNAM missing ── */}
      {!aggregated.callerName && (
        <div className="terminal-card p-4 space-y-3 border border-[#00d9ff]/15">
          <div className="text-[9px] uppercase tracking-widest text-[#00d9ff]/50 flex items-center gap-1.5">
            <User className="w-3 h-3" /> OWNER IDENTITY LOOKUP
          </div>
          <p className="text-[10px] font-mono text-[#00ff41]/40 leading-relaxed">
            No CNAM data available (requires Twilio or IPQS API key). Use these services to find the owner manually — they work for most countries:
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {[
              { label: "Truecaller", url: `https://www.truecaller.com/search/us/${input.e164.replace("+","")}`, desc: "Largest caller ID database · 350M+ names" },
              { label: "Whitepages", url: `https://www.whitepages.com/phone/${input.e164}`, desc: "US/CA reverse lookup with owner name" },
              { label: "Spokeo", url: `https://www.spokeo.com/search?q=${encodeURIComponent(input.e164)}`, desc: "US people search by phone" },
              { label: "Sync.me", url: `https://sync.me/search/?q=${encodeURIComponent(input.e164)}`, desc: "Social-based caller ID" },
              { label: "That's Them", url: `https://thatsthem.com/phone/${input.e164}`, desc: "US people + address lookup" },
              { label: "NumLookup", url: `https://www.numlookup.com/?number=${encodeURIComponent(input.e164)}`, desc: "Free real-time carrier + name" },
            ].map(({ label, url, desc }) => (
              <a key={label} href={url} target="_blank" rel="noopener noreferrer"
                className="flex flex-col gap-0.5 p-2.5 border border-[#00d9ff]/15 hover:border-[#00d9ff]/50 hover:bg-[#00d9ff]/5 transition-all group">
                <span className="text-xs font-mono font-bold text-[#00d9ff]/70 group-hover:text-[#00d9ff] flex items-center gap-1">
                  {label} <span className="text-[8px] opacity-50">↗</span>
                </span>
                <span className="text-[9px] font-mono text-[#00ff41]/25 leading-tight">{desc}</span>
              </a>
            ))}
          </div>
          <p className="text-[9px] font-mono text-[#00ff41]/20 border-t border-[#00ff41]/10 pt-2">
            Pro tip: Add <code className="text-[#00ff41]/40">TWILIO_ACCOUNT_SID</code> + <code className="text-[#00ff41]/40">TWILIO_AUTH_TOKEN</code> to .env.local for automatic CNAM lookups (~$0.005/query).
          </p>
        </div>
      )}

      {/* ── Pentester intelligence (always shown — core value) ── */}
      <PentesterPanel data={data} />

      {/* ── Metric cards — only populated fields ── */}
      {cards.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {cards.map((c) => (
            <MetricCard
              key={c.label}
              label={c.label}
              value={c.value}
              icon={c.icon}
              variant={c.variant}
              index={c.index}
            />
          ))}
        </div>
      )}

      {/* ── Fraud score (only if we have it) ── */}
      {aggregated.fraudScore !== null && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="terminal-card p-4"
        >
          <FraudScoreBar score={aggregated.fraudScore} />
        </motion.div>
      )}

      {/* ── Number breakdown + Format cross-reference ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <NumberBreakdown analysis={analysis} />
        <FormatPanel data={data} />
      </div>

      {/* ── SIM intelligence + QR code ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {hasSimData && <SimIntelPanel aggregated={aggregated} />}
        <QrCodePanel e164={input.e164} />
      </div>

      {/* ── Country intelligence ── */}
      {countryIntel && <CountryPanel intel={countryIntel} />}

      {/* ── Number permutations + Dork generator ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <NumberPermutations data={data} />
        <DorkGenerator e164={input.e164} national={input.national} />
      </div>

      {/* ── OSINT pivots ── */}
      <OsintPivots e164={input.e164} national={input.national} country={input.country} />

      {/* ── Raw source data ── */}
      <div className="space-y-2">
        <div className="text-[10px] uppercase tracking-widest text-[#00ff41]/40">
          [ RAW SOURCE DATA ] — API responses
        </div>
        <SourceTabs sources={sources} />
      </div>
    </motion.div>
  );
}
