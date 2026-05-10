"use client";

import { motion } from "framer-motion";

const lines = [
  "[+] HEAVEN-GeoIntel v2.0 — Phone Intelligence Platform",
  "[+] Loading libphonenumber-js database (240+ countries)...",
  "[+] Bundled country intelligence dataset: OK",
  "[+] Offline analysis engine: READY",
  "[+] NumVerify API   [ STANDBY — optional ]",
  "[+] IPQualityScore  [ STANDBY — optional ]",
  "[+] AbstractAPI     [ STANDBY — optional ]",
  "[+] Twilio Lookup   [ STANDBY — optional ]",
  "[*] CRT display layer initialized",
  "[*] Matrix rain canvas: active",
  "",
  "[✓] SYSTEM READY — Enter phone number to begin.",
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
              : line.includes("STANDBY")
              ? "text-[#00d9ff]"
              : "text-[#00ff41]/80"
          }
        >
          {line || " "}
        </motion.div>
      ))}
    </div>
  );
}
