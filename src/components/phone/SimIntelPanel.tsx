"use client";

import { motion } from "framer-motion";
import type { AggregatedResult } from "@/lib/types";

interface Props {
  aggregated: AggregatedResult;
}

function Row({
  label,
  value,
  highlight,
}: {
  label: string;
  value: React.ReactNode;
  highlight?: "green" | "cyan" | "warn" | "danger" | "neutral";
}) {
  const colorMap = {
    green: "text-[#00ff41]",
    cyan: "text-[#00d9ff]",
    warn: "text-[#ffaa00]",
    danger: "text-[#ff3e3e]",
    neutral: "text-[#888]",
  };
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-[#00ff41]/[0.08] last:border-b-0">
      <span className="text-[13px] uppercase tracking-widest text-[#00ff41]/60 shrink-0 w-36">
        {label}
      </span>
      <span className={`text-xs font-mono text-right ${highlight ? colorMap[highlight] : "text-[#00ff41]/80"}`}>
        {value}
      </span>
    </div>
  );
}

function Badge({ active }: { active: boolean | null }) {
  /* v8 ignore next -- both call sites are guarded by `!== null`; the N/A branch is defensive for the reusable contract */
  if (active === null) return <span className="text-[13px] text-[#00ff41]/54 border border-[#00ff41]/15 px-2 py-0.5 font-mono">N/A</span>;
  return (
    <span
      className={`text-[13px] px-2 py-0.5 border font-mono font-bold ${
        active
          ? "text-[#00ff41] border-[#00ff41]/40 bg-[#00ff41]/5"
          : "text-[#888] border-[#888]/30"
      }`}
    >
      {active ? "YES" : "NO"}
    </span>
  );
}

export default function SimIntelPanel({ aggregated }: Props) {
  const {
    carrier,
    callerName,
    callerType,
    prepaid,
    active,
    activeStatus,
    userActivity,
    mobileCountryCode,
    mobileNetworkCode,
    city,
    associatedEmails,
  } = aggregated;

  const hasData =
    callerName || prepaid !== null || active !== null || mobileCountryCode || userActivity || city;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.15 }}
      className="terminal-card p-4 space-y-3"
    >
      <div className="text-[13px] uppercase tracking-widest text-[#00ff41]/54 border-b border-[#00ff41]/15 pb-2">
        [ SIM &amp; CARRIER INTELLIGENCE ]
      </div>

      {!hasData && (
        <div className="text-[11px] text-[#00ff41]/55 italic font-mono py-2">
          Add IPQS or Twilio API keys to .env.local for SIM intelligence data.
        </div>
      )}

      <div className="space-y-0">
        {/* Caller identity */}
        {callerName && (
          <Row
            label="Owner / CNAM"
            value={callerName}
            highlight="cyan"
          />
        )}
        {callerType && (
          <Row
            label="Caller Type"
            value={callerType.charAt(0).toUpperCase() + callerType.slice(1)}
          />
        )}
        {carrier && (
          <Row label="Network Carrier" value={carrier} highlight="green" />
        )}

        {/* SIM status */}
        {active !== null && (
          <Row
            label="Line Active"
            value={<Badge active={active} />}
            highlight={active ? "green" : "neutral"}
          />
        )}
        {activeStatus && (
          <Row
            label="Active Status"
            value={activeStatus}
            highlight={activeStatus.toLowerCase().includes("active") ? "green" : "warn"}
          />
        )}
        {prepaid !== null && (
          <Row
            label="Prepaid SIM"
            value={<Badge active={prepaid} />}
            highlight={prepaid ? "warn" : "green"}
          />
        )}
        {userActivity && (
          <Row
            label="User Activity"
            value={userActivity}
            highlight={
              userActivity.toLowerCase().includes("high")
                ? "green"
                : userActivity.toLowerCase().includes("low")
                ? "warn"
                : "neutral"
            }
          />
        )}

        {/* Network codes */}
        {mobileCountryCode && (
          <Row label="MCC (Country)" value={mobileCountryCode} highlight="cyan" />
        )}
        {mobileNetworkCode && (
          <Row label="MNC (Network)" value={mobileNetworkCode} highlight="cyan" />
        )}
        {mobileCountryCode && mobileNetworkCode && (
          <Row
            label="PLMN Code"
            value={`${mobileCountryCode}-${mobileNetworkCode}`}
            highlight="cyan"
          />
        )}

        {/* Location */}
        {city && <Row label="City" value={city} />}
      </div>

      {/* Associated emails */}
      {associatedEmails && associatedEmails.length > 0 && (
        <div className="space-y-1.5 pt-1 border-t border-[#00ff41]/10">
          <div className="text-[13px] uppercase tracking-widest text-[#ffaa00]/64">
            ASSOCIATED EMAIL ADDRESSES
          </div>
          <div className="space-y-1">
            {associatedEmails.map((email, i) => (
              <div key={`${email}-${i}`} className="text-xs font-mono text-[#ffaa00]/80">
                {email}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MCC/MNC explanation */}
      {(mobileCountryCode || mobileNetworkCode) && (
        <div className="text-[12px] text-[#00ff41]/54 font-mono pt-1">
          MCC = Mobile Country Code · MNC = Mobile Network Code · PLMN = Public Land Mobile Network
        </div>
      )}
    </motion.div>
  );
}
