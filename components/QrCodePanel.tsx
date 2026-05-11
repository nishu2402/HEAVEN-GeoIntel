"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Download } from "lucide-react";
import QRCode from "qrcode";

interface Props {
  e164: string;
}

export default function QrCodePanel({ e164 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState(false);

  useEffect(() => {
    setReady(false);
    setErr(false);
    const canvas = canvasRef.current;
    if (!canvas) return;
    QRCode.toCanvas(canvas, `tel:${e164}`, {
      width: 180,
      margin: 2,
      color: { dark: "#00ff41", light: "#0a0a0a" },
      errorCorrectionLevel: "M",
    })
      .then(() => setReady(true))
      .catch(() => setErr(true));
  }, [e164]);

  function downloadQr() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `${e164.replace("+", "")}_qr.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.2 }}
      className="terminal-card p-4 space-y-3"
    >
      <div className="text-[10px] uppercase tracking-widest text-[#00ff41]/50 border-b border-[#00ff41]/15 pb-2">
        [ QR CODE — SCAN TO DIAL ]
      </div>

      <div className="flex flex-col items-center gap-3">
        <div className={`border border-[#00ff41]/20 p-2 transition-opacity ${ready ? "opacity-100" : "opacity-0"}`}>
          <canvas ref={canvasRef} />
        </div>

        {!ready && !err && (
          <div className="w-[196px] h-[196px] border border-[#00ff41]/15 flex items-center justify-center">
            <span className="text-[10px] text-[#00ff41]/55 font-mono animate-pulse">GENERATING...</span>
          </div>
        )}

        {err && (
          <div className="text-[10px] text-[#ff3e3e]/60 font-mono">QR generation failed</div>
        )}

        <div className="text-center space-y-1">
          <div className="text-[10px] text-[#00ff41]/60 font-mono">
            tel:{e164}
          </div>
          {ready && (
            <button
              onClick={downloadQr}
              className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-[#00d9ff]/50 hover:text-[#00d9ff] transition-colors mx-auto font-mono"
            >
              <Download className="w-3 h-3" /> SAVE PNG
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
