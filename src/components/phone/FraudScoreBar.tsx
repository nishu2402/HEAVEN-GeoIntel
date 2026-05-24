"use client";

import { motion } from "framer-motion";

interface Props {
  score: number;
}

function getColor(score: number) {
  if (score >= 75) return "#ff3e3e";
  if (score >= 40) return "#ffaa00";
  return "#00ff41";
}

export default function FraudScoreBar({ score }: Props) {
  const color = getColor(score);
  const label = score >= 75 ? "HIGH RISK" : score >= 40 ? "MODERATE" : "LOW RISK";

  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="text-[#00ff41]/50 uppercase tracking-widest">Fraud Score</span>
        <span style={{ color }} className="font-bold">
          {score}/100 — {label}
        </span>
      </div>
      <div className="h-2 w-full bg-[#0a0a0a] border border-[#00ff41]/20 relative overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="h-full"
          style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}80` }}
        />
      </div>
    </div>
  );
}
