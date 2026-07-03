"use client";

import { motion } from "framer-motion";
import type { CountryIntel } from "@/lib/data/countryIntel";

interface Props {
  intel: CountryIntel;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-start py-1.5 border-b border-[#00ff41]/[0.08] last:border-b-0">
      <span className="text-[13px] uppercase tracking-widest text-[#00ff41]/60 shrink-0 w-32">{label}</span>
      <span className="text-xs font-mono text-right text-[#00ff41]/90">{value}</span>
    </div>
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toString();
}

export default function CountryPanel({ intel }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.1 }}
      className="terminal-card p-4 space-y-3"
    >
      <div className="text-[13px] uppercase tracking-widest text-[#00ff41]/50 border-b border-[#00ff41]/15 pb-2">
        [ COUNTRY INTELLIGENCE ]
      </div>

      {/* Country header */}
      <div className="flex items-center gap-3">
        <span className="text-4xl">{intel.flagEmoji}</span>
        <div>
          <div className="text-lg font-bold text-[#00ff41] glow-green">{intel.name}</div>
          <div className="text-xs text-[#00ff41]/50">{intel.officialName}</div>
        </div>
      </div>

      {/* Data rows */}
      <div className="space-y-0">
        <Row label="Capital" value={intel.capital} />
        <Row label="Continent" value={intel.continent} />
        <Row label="Region" value={`${intel.region} — ${intel.subregion}`} />
        <Row label="Population" value={formatNumber(intel.population)} />
        <Row
          label="Currency"
          value={`${intel.currency.symbol} ${intel.currency.code} — ${intel.currency.name}`}
        />
        <Row label="Languages" value={intel.languages.join(", ")} />
        <Row label="Calling Code" value={intel.callingCode} />
        <Row label="TLD" value={intel.tld.join(", ")} />
        <Row label="Driving Side" value={intel.drivingSide === "left" ? "← Left side" : "→ Right side"} />
        <Row label="Emergency No." value={intel.emergencyNumber} />
        <Row label="Internet Users" value={intel.internetUsers} />
        <Row label="GDP / Capita" value={intel.gdpPerCapita} />
      </div>

      {/* Timezones */}
      <div className="space-y-1">
        <div className="text-[13px] uppercase tracking-widest text-[#00ff41]/60">TIMEZONES</div>
        <div className="flex flex-wrap gap-1.5">
          {intel.timezones.map((tz) => (
            <span
              key={tz}
              className="text-[13px] px-2 py-0.5 border border-[#00d9ff]/30 text-[#00d9ff] font-mono"
            >
              {tz}
            </span>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
