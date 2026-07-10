"use client";

import { motion } from "framer-motion";

const lines = [
  "[+] HEAVEN-GeoIntel v1.3 — Unified OSINT Platform",
  "[+] Loading libphonenumber-js database (240+ countries)...",
  "[+] Bundled datasets: country · NPA · MCC/MNC · disposable domains [ OK ]",
  "[+] Offline analysis engine: READY",
  "[+] Phone · Email · Username · IP · Domain modules: LOADED",
  "[+] Free no-key sources: Hudson Rock · XposedOrNot · ip-api · DoH [ ACTIVE ]",
  "[+] Breach module: XposedOrNot (free) · BreachDirectory          [ READY  ]",
  "[*] Link-analysis graph + persistent cases: initialized",
  "[*] Matrix rain canvas: active",
  "",
  "[✓] SYSTEM READY — pick a mode or press ⌘K to begin.",
];

export default function BootSequence({ onDone }: { onDone: () => void }) {
  return (
    <div className="font-mono text-sm text-[#00ff41] space-y-0.5 min-h-[240px]">
      {lines.map((line, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.12, duration: 0.08 }}
          onAnimationComplete={i === lines.length - 1 ? onDone : undefined}
          className={
            line.startsWith("[✓]")
              ? "text-[#00ff41] glow-green font-bold mt-2"
              : line === ""
              ? "h-3"
              : "text-[#00ff41]/80"
          }
        >
          {line || " "}
        </motion.div>
      ))}
    </div>
  );
}
