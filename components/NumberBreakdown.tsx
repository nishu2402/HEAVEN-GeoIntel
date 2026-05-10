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

  const typeFlags = [
    { label: "MOBILE", active: analysis.isMobile, color: "#00ff41" },
    { label: "FIXED LINE", active: analysis.isFixedLine, color: "#00d9ff" },
    { label: "VOIP", active: analysis.isVoip, color: "#ffaa00" },
    { label: "TOLL-FREE", active: analysis.isTollFree, color: "#00d9ff" },
    { label: "PREMIUM", active: analysis.isPremiumRate, color: "#ff3e3e" },
    { label: "SHARED COST", active: analysis.isSharedCost, color: "#ffaa00" },
    { label: "PAGER", active: analysis.isPager, color: "#888" },
    { label: "PERSONAL", active: analysis.isPersonalNumber, color: "#888" },
  ].filter((f) => f.active);

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

      {/* Carrier prefix */}
      {analysis.carrierPrefix && (
        <div className="text-[10px] text-[#00ff41]/40 font-mono">
          CARRIER PREFIX BLOCK:{" "}
          <span className="text-[#00d9ff]">{analysis.carrierPrefix}XXXXXXX</span>
          <span className="ml-2 text-[#00ff41]/25">
            (first {analysis.carrierPrefix.length} digits identify the operator block)
          </span>
        </div>
      )}
    </motion.div>
  );
}
