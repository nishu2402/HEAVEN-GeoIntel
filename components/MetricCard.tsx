"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface Props {
  label: string;
  value: string | null | undefined;
  icon?: React.ReactNode;
  variant?: "default" | "warn" | "danger" | "cyan" | "neutral";
  index?: number;
}

const variantMap = {
  default: "text-[#00ff41]",
  warn: "text-[#ffaa00]",
  danger: "text-[#ff3e3e]",
  cyan: "text-[#00d9ff]",
  neutral: "text-[#888]",
};

export default function MetricCard({ label, value, icon, variant = "default", index = 0 }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.25 }}
      className="terminal-card p-4 flex flex-col gap-1.5"
    >
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[#00ff41]/50">
        {icon && <span className="w-3 h-3">{icon}</span>}
        {label}
      </div>
      <div className={cn("text-base font-bold font-mono truncate", variantMap[variant])}>
        {value ?? <span className="text-[#00ff41]/25 italic">N/A</span>}
      </div>
    </motion.div>
  );
}
