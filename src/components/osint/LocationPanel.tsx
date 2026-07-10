"use client";

import { motion } from "framer-motion";
import { MapPin, Clock, Globe } from "lucide-react";
import type { LookupResponse } from "@/lib/types";

interface Props {
  data: LookupResponse;
}

function Row({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-[#00ff41]/[0.08] last:border-b-0">
      <span className="text-[12px] uppercase tracking-widest text-[#00ff41]/55 w-32 shrink-0 pt-0.5">
        {label}
      </span>
      <span className="font-mono text-xs flex-1" style={{ color: accent }}>
        {value}
      </span>
    </div>
  );
}

export default function LocationPanel({ data }: Props) {
  const { aggregated, analysis, input, countryIntel } = data;

  // Deduplicate location rows: walk from most-specific to least, skip falsy/duplicate
  // values. Compare against the RAW state name, not the "California (CA)" display
  // string — an API region of "California" and an NPA metro equal to the state name
  // both mean the same place and must not be repeated as their own rows.
  const city   = aggregated.city ?? null;
  const region = aggregated.region ?? null;
  const stateName = analysis.npaInfo?.state ?? null;
  const state  = analysis.npaInfo ? `${analysis.npaInfo.state} (${analysis.npaInfo.stateAbbr})` : null;
  const metro  = analysis.npaInfo?.region ?? null;
  const areaCode = aggregated.areaCode ?? null;
  const country  = aggregated.countryName;

  // Merge timezone + UTC offset into one line so we don't show two cards
  const ianaTz = aggregated.timezone?.[0] ?? countryIntel?.timezones?.[0] ?? null;
  const utc    = aggregated.utcOffsets?.[0] ?? null;
  const tzDisplay =
    ianaTz && utc ? `${ianaTz} (${utc})` :
    ianaTz ? ianaTz :
    utc ? utc : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.12 }}
      className="terminal-card p-4 space-y-1"
    >
      <div className="text-[12px] uppercase tracking-widest text-[#00ff41]/70 mb-3 flex items-center gap-1.5">
        <Globe className="w-3 h-3" /> LOCATION INTELLIGENCE
      </div>

      <Row label="Country" value={`${country} (${input.countryCallingCode})`} accent="#00ff41" />

      {state  && <Row label="State / Province" value={state}  accent="#00d9ff" />}
      {metro  && metro !== stateName && <Row label="Metro / Region" value={metro} accent="#00d9ff" />}
      {region && region !== city && region !== stateName && region !== metro && (
        <Row label="Region (API)" value={region} accent="#00d9ff" />
      )}
      {city   && <Row label="City"            value={city}  accent="#00d9ff" />}
      {areaCode && (
        <Row label="Area Code" value={areaCode} accent="#00d9ff" />
      )}
      {tzDisplay && (
        <div className="flex items-start gap-2 py-1.5">
          <span className="text-[12px] uppercase tracking-widest text-[#00ff41]/55 w-32 shrink-0 pt-0.5 flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" /> Timezone
          </span>
          <span className="font-mono text-xs flex-1 text-[#00ff41]">{tzDisplay}</span>
        </div>
      )}

      {!state && !metro && !region && !city && !areaCode && (
        <div className="pt-2 flex items-start gap-2 text-[12px] font-mono text-[#00ff41]/55">
          <MapPin className="w-3 h-3 mt-0.5 shrink-0" />
          Only country-level geography available. Add IPQS or Twilio keys for city/region.
        </div>
      )}
    </motion.div>
  );
}
