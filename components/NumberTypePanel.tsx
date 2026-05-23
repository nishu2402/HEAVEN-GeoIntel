"use client";

import { motion } from "framer-motion";
import { Wifi, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { LookupResponse } from "@/lib/types";

interface Props {
  data: LookupResponse;
}

function Row({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-[#00ff41]/[0.08] last:border-b-0">
      <span className="text-[12px] uppercase tracking-widest text-[#00ff41]/55 w-32 shrink-0 pt-0.5">
        {label}
      </span>
      <span className="font-mono text-xs flex-1" style={{ color: accent ?? "#00ff41" }}>
        {value}
      </span>
    </div>
  );
}

export default function NumberTypePanel({ data }: Props) {
  const { aggregated, analysis } = data;

  // Pick a single dominant type label — instead of rendering up to 4 cards.
  // Priority: VOIP (warn) > Premium (danger) > Toll-Free > Mobile > Fixed Line > Ambiguous > Unknown
  const primaryType = (() => {
    if (aggregated.isVoip === true)        return { label: "VOIP / INTERNET",    accent: "#ffaa00" };
    if (aggregated.isPremiumRate === true) return { label: "PREMIUM RATE",       accent: "#ff3e3e" };
    if (analysis.isTollFree)               return { label: "TOLL-FREE",          accent: "#00d9ff" };
    if (analysis.isSharedCost)             return { label: "SHARED COST",        accent: "#ffaa00" };
    if (analysis.isPersonalNumber)         return { label: "PERSONAL NUMBER",    accent: "#888" };
    if (aggregated.isMobile === true)      return { label: "MOBILE",             accent: "#00ff41" };
    if (aggregated.isFixedLine === true)   return { label: "FIXED LINE",         accent: "#00d9ff" };
    if (aggregated.isAmbiguousType)        return { label: "MOBILE OR FIXED",    accent: "#888" };
    return { label: aggregated.typeDescription || "UNKNOWN", accent: "#888" };
  })();

  const digitInfo = aggregated.numberLength
    ? `${aggregated.numberLength} digits` +
      (analysis.expectedLengths.length > 0
        ? ` (expected ${analysis.expectedLengths.join("/")})`
        : "")
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.12 }}
      className="terminal-card p-4 space-y-1"
    >
      <div className="text-[12px] uppercase tracking-widest text-[#00ff41]/70 mb-3 flex items-center gap-1.5">
        <Wifi className="w-3 h-3" /> NUMBER TYPE & VALIDITY
      </div>

      <Row label="Line Type" value={primaryType.label} accent={primaryType.accent} />
      {aggregated.lineType && aggregated.lineType.toUpperCase() !== primaryType.label && (
        <Row label="API Type" value={aggregated.lineType} accent="#888" />
      )}

      <div className="flex items-start gap-2 py-1.5 border-b border-[#00ff41]/[0.08]">
        <span className="text-[12px] uppercase tracking-widest text-[#00ff41]/55 w-32 shrink-0 pt-0.5">
          Validity
        </span>
        <span className="font-mono text-xs flex-1 flex items-center gap-1.5"
          style={{ color: aggregated.isValid ? "#00ff41" : "#ff3e3e" }}>
          {aggregated.isValid
            ? <><CheckCircle2 className="w-3 h-3" /> VALID</>
            : <><AlertTriangle className="w-3 h-3" /> INVALID NUMBER STRUCTURE</>
          }
        </span>
      </div>

      {digitInfo && <Row label="Digit Count" value={digitInfo} accent="#888" />}

      {aggregated.isAmbiguousType && (
        <div className="pt-2 text-[12px] font-mono text-[#00ff41]/55 italic">
          libphonenumber cannot tell mobile from landline by structure alone in this country.
          Carrier API confirmation is needed.
        </div>
      )}
    </motion.div>
  );
}
