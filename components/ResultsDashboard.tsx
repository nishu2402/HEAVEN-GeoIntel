"use client";

import { motion } from "framer-motion";
import {
  Wifi, WifiOff, Phone, MapPin, Clock, Shield,
  Copy, Download, Hash, Globe, User, CreditCard,
  Activity, Radio,
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
import { cn } from "@/lib/utils";

interface Props {
  data: LookupResponse;
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(console.error);
}

function downloadJson(data: LookupResponse) {
  const e164 = data.input.e164.replace("+", "");
  const ts = Date.now();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${e164}_${ts}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ResultsDashboard({ data }: Props) {
  const { input, aggregated, sources, analysis, countryIntel } = data;
  const flag = countryToFlagEmoji(input.country);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="space-y-4 mt-6"
    >
      {/* ── Header card ── */}
      <div className="terminal-card p-5 space-y-3">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-widest text-[#00ff41]/40">LOOKUP RESULT</div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-4xl">{flag}</span>
              <div>
                <div className="text-2xl font-bold glow-green tracking-wider font-mono">
                  {input.e164}
                </div>
                <div className="text-sm text-[#00ff41]/60 mt-0.5 font-mono">
                  {input.national} · {aggregated.countryName} ({input.countryCallingCode})
                </div>
                {/* Caller name — shown in header if available */}
                {aggregated.callerName && (
                  <div className="flex items-center gap-1.5 mt-1">
                    <User className="w-3 h-3 text-[#00d9ff]/70" />
                    <span className="text-sm font-bold text-[#00d9ff] font-mono">
                      {aggregated.callerName}
                    </span>
                    {aggregated.callerType && (
                      <span className="text-[10px] text-[#00d9ff]/50 uppercase tracking-widest">
                        [{aggregated.callerType}]
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={cn(
                "text-xs px-3 py-1 border font-mono font-bold tracking-widest",
                input.isValid ? "badge-valid" : "badge-invalid"
              )}
            >
              {input.isValid ? "✓ VALID" : "✗ INVALID"}
            </span>
            {aggregated.typeDescription && (
              <span className="text-xs px-3 py-1 border badge-info font-mono">
                {aggregated.typeDescription.toUpperCase()}
              </span>
            )}
            {aggregated.prepaid && (
              <span className="text-xs px-2 py-1 border font-mono text-[#ffaa00] border-[#ffaa00]/40 bg-[#ffaa00]/5">
                PREPAID
              </span>
            )}
            {aggregated.active === false && (
              <span className="text-xs px-2 py-1 border font-mono text-[#ff3e3e] border-[#ff3e3e]/40">
                INACTIVE
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
        </div>
      </div>

      {/* ── Core metric cards (row 1 — identity + line) ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        <MetricCard
          label="Owner / CNAM"
          value={aggregated.callerName}
          icon={<User className="w-3 h-3" />}
          variant="cyan"
          index={0}
        />
        <MetricCard
          label="Carrier"
          value={aggregated.carrier}
          icon={<Phone className="w-3 h-3" />}
          variant="cyan"
          index={1}
        />
        <MetricCard
          label="Line Type"
          value={aggregated.typeDescription}
          icon={<Wifi className="w-3 h-3" />}
          variant={aggregated.isVoip ? "warn" : "default"}
          index={2}
        />
        <MetricCard
          label="Prepaid SIM"
          value={
            aggregated.prepaid === null ? null : aggregated.prepaid ? "YES — PREPAID" : "NO — CONTRACT"
          }
          icon={<CreditCard className="w-3 h-3" />}
          variant={aggregated.prepaid ? "warn" : "default"}
          index={3}
        />
        <MetricCard
          label="Line Active"
          value={
            aggregated.active === null
              ? null
              : aggregated.active
              ? "ACTIVE"
              : "INACTIVE"
          }
          icon={<Activity className="w-3 h-3" />}
          variant={aggregated.active === false ? "danger" : "default"}
          index={4}
        />
        <MetricCard
          label="Country"
          value={aggregated.countryName}
          icon={<Globe className="w-3 h-3" />}
          index={5}
        />
        <MetricCard
          label="Region / Area"
          value={aggregated.region ?? aggregated.city ?? aggregated.areaCode ?? null}
          icon={<MapPin className="w-3 h-3" />}
          variant="cyan"
          index={6}
        />
        <MetricCard
          label="Timezone"
          value={
            aggregated.utcOffsets?.[0] ??
            (aggregated.timezone?.[0]
              ? aggregated.timezone[0].length > 20
                ? aggregated.timezone[0].split("/").pop() ?? null
                : aggregated.timezone[0]
              : null)
          }
          icon={<Clock className="w-3 h-3" />}
          index={7}
        />
        <MetricCard
          label="VOIP"
          value={aggregated.isVoip === null ? null : aggregated.isVoip ? "YES — VOIP" : "NO"}
          icon={<WifiOff className="w-3 h-3" />}
          variant={aggregated.isVoip ? "warn" : "default"}
          index={8}
        />
        <MetricCard
          label="MCC / MNC"
          value={
            aggregated.mobileCountryCode && aggregated.mobileNetworkCode
              ? `${aggregated.mobileCountryCode} / ${aggregated.mobileNetworkCode}`
              : aggregated.mobileCountryCode ?? null
          }
          icon={<Radio className="w-3 h-3" />}
          variant="cyan"
          index={9}
        />
        <MetricCard
          label="Recent Abuse"
          value={
            aggregated.recentAbuse === null
              ? null
              : aggregated.recentAbuse
              ? "DETECTED"
              : "NONE"
          }
          icon={<Shield className="w-3 h-3" />}
          variant={aggregated.recentAbuse ? "danger" : "default"}
          index={10}
        />
        <MetricCard
          label="Risk Flag"
          value={
            aggregated.isRisky === null
              ? null
              : aggregated.isRisky
              ? "HIGH RISK"
              : "LOW RISK"
          }
          variant={aggregated.isRisky ? "danger" : "default"}
          index={11}
        />
        <MetricCard
          label="Number Length"
          value={aggregated.numberLength ? `${aggregated.numberLength} digits` : null}
          icon={<Hash className="w-3 h-3" />}
          variant="neutral"
          index={12}
        />
        <MetricCard
          label="Mobile"
          value={aggregated.isMobile ? "YES" : "NO"}
          variant={aggregated.isMobile ? "default" : "neutral"}
          index={13}
        />
        <MetricCard
          label="Toll-Free"
          value={aggregated.isTollFree ? "YES" : "NO"}
          variant={aggregated.isTollFree ? "cyan" : "neutral"}
          index={14}
        />
        <MetricCard
          label="Premium Rate"
          value={aggregated.isPremiumRate ? "YES — CAUTION" : "NO"}
          variant={aggregated.isPremiumRate ? "danger" : "neutral"}
          index={15}
        />
      </div>

      {/* ── Fraud score ── */}
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

      {/* ── Number breakdown + Format panel ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <NumberBreakdown analysis={analysis} />
        <FormatPanel data={data} />
      </div>

      {/* ── SIM intelligence + QR code ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SimIntelPanel aggregated={aggregated} />
        <QrCodePanel e164={input.e164} />
      </div>

      {/* ── Country intelligence ── */}
      {countryIntel && <CountryPanel intel={countryIntel} />}

      {/* ── OSINT pivots ── */}
      <OsintPivots
        e164={input.e164}
        national={input.national}
        country={input.country}
      />

      {/* ── Raw source data ── */}
      <div className="space-y-2">
        <div className="text-[10px] uppercase tracking-widest text-[#00ff41]/40">
          [ RAW SOURCE DATA ] — Optional API enrichment
        </div>
        <SourceTabs sources={sources} />
      </div>
    </motion.div>
  );
}
