"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Copy, Check } from "lucide-react";
import type { LookupResponse } from "@/lib/types";
import { copyText } from "@/lib/utils";

interface Props {
  data: LookupResponse;
}

interface FormatRow {
  label: string;
  value: string;
  description: string;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    void copyText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={handleCopy}
      className="text-[#00ff41]/55 hover:text-[#00ff41] transition-colors shrink-0"
      title="Copy"
    >
      {copied ? <Check className="w-3 h-3 text-[#00ff41]" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

export default function FormatPanel({ data }: Props) {
  const { aggregated, analysis } = data;

  const formats: FormatRow[] = [
    {
      label: "E.164",
      value: aggregated.formatE164,
      description: "International standard — leading + with country code",
    },
    {
      label: "International",
      value: aggregated.formatInternational,
      description: "Formatted for display with spaces and separators",
    },
    {
      label: "National",
      value: aggregated.formatNational,
      description: "Local format without country code",
    },
    {
      label: "RFC 3966",
      value: aggregated.formatRfc3966,
      description: "URI format for tel: links in HTML/SIP",
    },
  ];

  const validityItems = [
    { label: "isValid()", value: analysis.isValid, description: "Passes libphonenumber-js strict validation" },
    { label: "isPossible()", value: analysis.isPossible, description: "Correct digit count for country" },
    { label: "isValidForRegion()", value: analysis.isValidForRegion, description: "Valid within detected region" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.15 }}
      className="terminal-card p-4 space-y-4"
    >
      <div className="text-[13px] uppercase tracking-widest text-[#00ff41]/50 border-b border-[#00ff41]/15 pb-2">
        [ FORMAT CROSS-REFERENCE ]
      </div>

      <div className="space-y-2">
        {formats.map((f) => (
          <div key={f.label} className="border border-[#00ff41]/10 p-2.5 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[13px] uppercase tracking-widest text-[#00ff41]/50">{f.label}</span>
              <CopyButton text={f.value} />
            </div>
            <div className="font-mono text-sm text-[#00d9ff] font-bold">{f.value}</div>
            <div className="text-[12px] text-[#00ff41]/55">{f.description}</div>
          </div>
        ))}
      </div>

      {/* Validity matrix */}
      <div className="space-y-1.5">
        <div className="text-[13px] uppercase tracking-widest text-[#00ff41]/60">VALIDATION MATRIX</div>
        {validityItems.map((v) => (
          <div key={v.label} className="flex items-center gap-3">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                v.value ? "bg-[#00ff41]" : "bg-[#ff3e3e]"
              }`}
            />
            <span className="font-mono text-xs text-[#00ff41]/70">{v.label}</span>
            <span
              className={`text-[13px] font-mono ml-auto ${
                v.value ? "text-[#00ff41]" : "text-[#ff3e3e]"
              }`}
            >
              {v.value ? "TRUE" : "FALSE"}
            </span>
          </div>
        ))}
      </div>

      {/* tel: link */}
      <div className="border border-[#00ff41]/10 p-2.5 space-y-1">
        <div className="text-[13px] uppercase tracking-widest text-[#00ff41]/60">HTML TEL LINK</div>
        <div className="font-mono text-xs text-[#00ff41]/60 break-all">
          <span className="text-[#888]">{"<a href="}</span>
          <span className="text-[#00d9ff]">&quot;{aggregated.formatRfc3966}&quot;</span>
          <span className="text-[#888]">{">"}</span>
          <span className="text-[#00ff41]">{aggregated.formatInternational}</span>
          <span className="text-[#888]">{"</a>"}</span>
        </div>
      </div>
    </motion.div>
  );
}
