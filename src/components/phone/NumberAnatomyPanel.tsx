"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Wifi, CheckCircle2, AlertTriangle, Copy, Check, Hash,
  Phone as PhoneIcon, Building2, Smartphone, Radio,
} from "lucide-react";
import type { LookupResponse } from "@/lib/types";
import { copyText } from "@/lib/utils";

interface Props {
  data: LookupResponse;
}

function CopyBtn({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => {
        void copyText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
      className="shrink-0 p-1 text-[#00ff41]/54 hover:text-[#00ff41] transition-colors"
      title="Copy"
    >
      {done ? <Check className="w-3 h-3 text-[#00ff41]" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

interface TypeMeta {
  label: string;
  color: string;
  icon: React.ReactNode;
  description: string;
}

function getPrimaryType(data: LookupResponse): TypeMeta {
  const { aggregated, analysis } = data;
  if (aggregated.isVoip === true)        return { label: "VOIP / INTERNET",  color: "#ffaa00", icon: <Wifi className="w-4 h-4" />,        description: "Hosted by a VoIP provider (Twilio, Google Voice, SIP). Easily spoofable; common for businesses and call centers." };
  if (aggregated.isPremiumRate === true) return { label: "PREMIUM RATE",     color: "#ff3e3e", icon: <AlertTriangle className="w-4 h-4" />, description: "Callers are charged a premium rate. Frequently used in revenue-generating scams." };
  if (analysis.isTollFree)               return { label: "TOLL-FREE",        color: "#00d9ff", icon: <Building2 className="w-4 h-4" />,    description: "Inbound calls billed to the organization, not the caller. Almost always a business or service line." };
  if (analysis.isSharedCost)             return { label: "SHARED COST",      color: "#ffaa00", icon: <Building2 className="w-4 h-4" />,    description: "Caller and recipient share the cost. Common for support and helpdesk lines." };
  if (analysis.isPersonalNumber)         return { label: "PERSONAL NUMBER",  color: "#888",    icon: <PhoneIcon className="w-4 h-4" />,    description: "A reroute-anywhere personal number. Owner controls forwarding behind the scenes." };
  if (analysis.isPager)                  return { label: "PAGER",            color: "#888",    icon: <Radio className="w-4 h-4" />,        description: "Legacy pager number — extremely rare in 2026." };
  if (aggregated.isMobile === true)      return { label: "MOBILE",           color: "#00ff41", icon: <Smartphone className="w-4 h-4" />,   description: "Confirmed mobile SIM. Reachable 24/7. SMS deliverable, SIM-swap surface present." };
  if (aggregated.isFixedLine === true)   return { label: "FIXED LINE",       color: "#00d9ff", icon: <Building2 className="w-4 h-4" />,    description: "Confirmed landline. Reachable at a static location. Frequently a residence or office." };
  if (aggregated.isAmbiguousType)        return { label: "MOBILE OR FIXED",  color: "#888",    icon: <PhoneIcon className="w-4 h-4" />,    description: "libphonenumber cannot tell mobile from landline by structure in this country. Carrier-API check needed." };
  return                                       { label: aggregated.typeDescription || "UNKNOWN", color: "#888", icon: <PhoneIcon className="w-4 h-4" />, description: "Type unresolved." };
}

interface Segment {
  label: string;
  value: string;
  color: string;
  description: string;
}

function buildSegments(data: LookupResponse): Segment[] {
  const { analysis } = data;
  const out: Segment[] = [
    { label: "Country Code", value: analysis.countryCallingCode, color: "#00d9ff", description: `ITU dialing prefix for ${analysis.countryName}` },
  ];
  if (analysis.areaCode) {
    out.push({ label: "Area Code", value: analysis.areaCode, color: "#00ff41", description: "Geographic or operator prefix (NPA)" });
  }
  out.push({ label: "Subscriber", value: analysis.subscriberNumber, color: "#00ff4199", description: "Unique subscriber line digits" });
  return out;
}

export default function NumberAnatomyPanel({ data }: Props) {
  const { aggregated, analysis } = data;
  const type = getPrimaryType(data);
  const segments = buildSegments(data);

  // Combined validity row — show 3 libphonenumber checks
  const checks = [
    { label: "isValid", value: analysis.isValid,         note: "Strict libphonenumber validation" },
    { label: "isPossible", value: analysis.isPossible,   note: "Correct digit count for country" },
    { label: "validForRegion", value: analysis.isValidForRegion, note: "Valid inside detected region" },
  ];

  // Format rows — primary 4 + permutations rolled into one collapsible block via tabs
  const formats: { label: string; value: string; note?: string }[] = [
    { label: "E.164",              value: aggregated.formatE164,          note: "ITU canonical — use in APIs" },
    { label: "International",      value: aggregated.formatInternational, note: "Display with spaces" },
    { label: "National",           value: aggregated.formatNational,      note: "Local format" },
    { label: "RFC 3966",           value: aggregated.formatRfc3966,       note: "tel: URI for click-to-call" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="terminal-card p-4 sm:p-5 space-y-5"
    >
      <div className="text-[12px] uppercase tracking-widest text-[#00ff41]/65 border-b border-[#00ff41]/15 pb-2 flex items-center gap-2">
        <Hash className="w-3.5 h-3.5" /> [ NUMBER ANATOMY ] — structure, type, formats
      </div>

      {/* ── TYPE banner ─────────────────────────────────────────────── */}
      <div
        className="p-3.5 border space-y-1.5"
        style={{ borderColor: type.color + "55", backgroundColor: type.color + "08" }}
      >
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <span style={{ color: type.color }}>{type.icon}</span>
            <span className="font-mono font-bold text-base sm:text-lg tracking-wider" style={{ color: type.color }}>
              {type.label}
            </span>
            {aggregated.lineType && aggregated.lineType.toUpperCase() !== type.label && (
              <span className="text-[11px] font-mono text-[#00ff41]/54 px-1.5 py-0.5 border border-[#00ff41]/15">
                API: {aggregated.lineType}
              </span>
            )}
          </div>
          <span
            className="text-[12px] font-mono font-bold px-2 py-0.5 border tracking-widest flex items-center gap-1"
            style={{
              color: aggregated.isValid ? "#00ff41" : "#ff3e3e",
              borderColor: (aggregated.isValid ? "#00ff41" : "#ff3e3e") + "60",
              backgroundColor: (aggregated.isValid ? "#00ff41" : "#ff3e3e") + "15",
            }}
          >
            {aggregated.isValid
              ? <><CheckCircle2 className="w-3 h-3" /> VALID</>
              : <><AlertTriangle className="w-3 h-3" /> INVALID</>}
          </span>
        </div>
        <p className="text-[13px] font-mono leading-snug" style={{ color: type.color + "cc" }}>
          {type.description}
        </p>
      </div>

      {/* ── VISUAL DIGIT BREAKDOWN ──────────────────────────────────── */}
      <div className="space-y-3">
        <div className="text-[12px] uppercase tracking-widest text-[#00ff41]/55">Digit structure</div>
        <div className="flex items-center gap-1 font-mono text-xl flex-wrap">
          {segments.map((seg, i) => (
            <span key={i} style={{ color: seg.color }} className="font-bold">
              {seg.value}
              {i < segments.length - 1 && <span className="text-[#00ff41]/54 mx-1">·</span>}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {segments.map((seg, i) => (
            <div key={i} className="border border-[#00ff41]/10 p-2 space-y-0.5">
              <div className="text-[11px] uppercase tracking-widest text-[#00ff41]/55">{seg.label}</div>
              <div className="font-mono font-bold text-sm" style={{ color: seg.color }}>{seg.value}</div>
              <div className="text-[11px] text-[#00ff41]/54">{seg.description}</div>
            </div>
          ))}
        </div>

        {/* Length bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-[12px] text-[#00ff41]/55 font-mono">
            <span>SUBSCRIBER DIGITS</span>
            <span>
              {analysis.numberLength} digits
              {analysis.expectedLengths.length > 0 &&
                ` · expected ${analysis.expectedLengths.join(" or ")}`}
            </span>
          </div>
          <div className="flex gap-0.5">
            {Array.from({ length: Math.max(analysis.numberLength, 10) }).map((_, i) => (
              <div
                key={i}
                className={`h-1.5 flex-1 ${i < analysis.numberLength ? "bg-[#00ff41]" : "bg-[#00ff41]/10"}`}
              />
            ))}
          </div>
        </div>

        {analysis.carrierPrefix && (
          <div className="text-[12px] text-[#00ff41]/60 font-mono">
            Central office (NXX): <span className="text-[#00d9ff] font-semibold">{analysis.carrierPrefix}</span>
            <span className="ml-2 text-[#00ff41]/54">— switching exchange / carrier block</span>
          </div>
        )}
      </div>

      {/* ── VALIDITY CHECKS ─────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="text-[12px] uppercase tracking-widest text-[#00ff41]/55">libphonenumber checks</div>
        <div className="flex flex-wrap gap-2">
          {checks.map((c) => (
            <span
              key={c.label}
              className={`text-[12px] font-mono px-2 py-1 border flex items-center gap-1.5 ${
                c.value
                  ? "border-[#00ff41]/35 text-[#00ff41] bg-[#00ff41]/5"
                  : "border-[#ff3e3e]/35 text-[#ff3e3e]/92 bg-[#ff3e3e]/5"
              }`}
              title={c.note}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${c.value ? "bg-[#00ff41]" : "bg-[#ff3e3e]"}`} />
              {c.label}() = {c.value ? "TRUE" : "FALSE"}
            </span>
          ))}
        </div>
      </div>

      {/* ── FORMAT CROSS-REFERENCE ──────────────────────────────────── */}
      <div className="space-y-2">
        <div className="text-[12px] uppercase tracking-widest text-[#00ff41]/55">Standard formats</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {formats.map((f) => (
            <div
              key={f.label}
              className="flex items-center gap-2 border border-[#00ff41]/10 px-2.5 py-1.5 hover:border-[#00ff41]/30 hover:bg-[#00ff41]/[0.04] transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[11px] uppercase tracking-widest text-[#00ff41]/54 leading-tight">{f.label}</div>
                <div className="font-mono text-sm text-[#00d9ff] truncate" title={f.value}>{f.value}</div>
                {f.note && <div className="text-[11px] text-[#00ff41]/54 leading-tight">{f.note}</div>}
              </div>
              <CopyBtn value={f.value} />
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
