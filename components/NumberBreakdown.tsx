"use client";

import { motion } from "framer-motion";
import type { PhoneAnalysis } from "@/lib/phoneAnalysis";

interface Props {
  analysis: PhoneAnalysis;
}

interface Segment {
  label: string;
  value: string;
  color: string;
  description: string;
}

export default function NumberBreakdown({ analysis }: Props) {
  const segments: Segment[] = [
    {
      label: "Country Code",
      value: analysis.countryCallingCode,
      color: "#00d9ff",
      description: `ITU calling code for ${analysis.countryName}`,
    },
    ...(analysis.areaCode
      ? [
          {
            label: "Area Code",
            value: analysis.areaCode,
            color: "#00ff41",
            description: "Geographic or operator prefix",
          },
        ]
      : []),
    {
      label: "Subscriber",
      value: analysis.subscriberNumber,
      color: "#00ff4199",
      description: "Unique subscriber line number",
    },
  ];

  // Only show flags when definitively confirmed — never show both MOBILE and FIXED LINE
  const typeFlags = [
    analysis.isMobile && !analysis.isAmbiguousType ? { label: "MOBILE", color: "#00ff41" } : null,
    analysis.isFixedLine && !analysis.isAmbiguousType ? { label: "FIXED LINE", color: "#00d9ff" } : null,
    analysis.isAmbiguousType ? { label: "MOBILE OR LANDLINE — UNRESOLVED", color: "#888" } : null,
    analysis.isVoip ? { label: "VOIP", color: "#ffaa00" } : null,
    analysis.isTollFree ? { label: "TOLL-FREE", color: "#00d9ff" } : null,
    analysis.isPremiumRate ? { label: "PREMIUM RATE", color: "#ff3e3e" } : null,
    analysis.isSharedCost ? { label: "SHARED COST", color: "#ffaa00" } : null,
    analysis.isPager ? { label: "PAGER", color: "#888" } : null,
    analysis.isPersonalNumber ? { label: "PERSONAL NUMBER", color: "#888" } : null,
  ].filter((f): f is { label: string; color: string } => f !== null);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="terminal-card p-4 space-y-4"
    >
      <div className="text-[10px] uppercase tracking-widest text-[#00ff41]/50 border-b border-[#00ff41]/15 pb-2">
        [ NUMBER STRUCTURE ]
      </div>

      {/* Visual number breakdown */}
      <div className="space-y-3">
        <div className="flex items-center gap-1 font-mono text-lg flex-wrap">
          {segments.map((seg, i) => (
            <span key={i} style={{ color: seg.color }} className="font-bold">
              {seg.value}
              {i < segments.length - 1 && <span className="text-[#00ff41]/20 mx-1">·</span>}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          {segments.map((seg, i) => (
            <div key={i} className="border border-[#00ff41]/10 p-2 space-y-0.5">
              <div className="text-[9px] uppercase tracking-widest text-[#00ff41]/40">{seg.label}</div>
              <div className="font-mono font-bold text-sm" style={{ color: seg.color }}>
                {seg.value}
              </div>
              <div className="text-[9px] text-[#00ff41]/30">{seg.description}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Length indicator */}
      <div className="space-y-1">
        <div className="flex justify-between text-[10px] text-[#00ff41]/40">
          <span>SUBSCRIBER DIGITS</span>
          <span>
            {analysis.numberLength} digits
            {analysis.expectedLengths.length > 0 &&
              ` (expected: ${analysis.expectedLengths.join(", ")})`}
          </span>
        </div>
        <div className="flex gap-0.5">
          {Array.from({ length: Math.max(analysis.numberLength, 10) }).map((_, i) => (
            <div
              key={i}
              className={`h-1.5 flex-1 ${
                i < analysis.numberLength
                  ? "bg-[#00ff41]"
                  : "bg-[#00ff41]/10"
              }`}
            />
          ))}
        </div>
      </div>

      {/* Type flags */}
      {typeFlags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {typeFlags.map((f) => (
            <span
              key={f.label}
              className="text-[9px] px-2 py-0.5 border font-mono font-bold"
              style={{ borderColor: `${f.color}50`, color: f.color, background: `${f.color}10` }}
            >
              {f.label}
            </span>
          ))}
        </div>
      )}

      {/* Central office / carrier prefix */}
      {analysis.carrierPrefix && (
        <div className="text-[10px] text-[#00ff41]/40 font-mono">
          CENTRAL OFFICE CODE:{" "}
          <span className="text-[#00d9ff]">{analysis.carrierPrefix}</span>
          <span className="ml-2 text-[#00ff41]/25">
            (NXX — identifies the switching exchange / carrier block)
          </span>
        </div>
      )}
    </motion.div>
  );
}
