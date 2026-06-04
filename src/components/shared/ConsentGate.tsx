"use client";

import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";

// First-run permitted-use gate. Renders nothing on the server and on the first
// client paint (state starts false → no hydration mismatch); an effect reveals
// it only if the user hasn't accepted before. Acceptance is remembered locally.
const KEY = "hv-consent-v1";

export default function ConsentGate() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try { if (localStorage.getItem(KEY) !== "1") setShow(true); } catch { /* ignore */ }
  }, []);

  if (!show) return null;

  function accept() {
    try { localStorage.setItem(KEY, "1"); } catch { /* ignore */ }
    setShow(false);
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" role="dialog" aria-modal="true" aria-label="Permitted use">
      <div className="terminal-card max-w-lg w-full p-6 space-y-4" style={{ borderColor: "var(--hv-glass-hi)" }}>
        <div className="flex items-center gap-2 text-[var(--hv-amber)]">
          <ShieldAlert className="w-5 h-5" />
          <span className="font-mono uppercase tracking-widest text-sm font-bold">Authorized use only</span>
        </div>
        <div className="text-sm font-mono text-[var(--hv-ink-dim)] space-y-2 leading-relaxed">
          <p>HEAVEN-GeoIntel aggregates <span className="text-[var(--hv-ink)]">publicly available metadata</span> for lawful OSINT — security research, fraud investigation, and authorized assessments.</p>
          <p>By continuing you confirm you will use it <span className="text-[var(--hv-ink)]">only where you have a lawful basis</span>, and never for stalking, harassment, doxxing, or any unlawful purpose. It provides <span className="text-[var(--hv-ink)]">no real-time location or device tracking</span>.</p>
        </div>
        <div className="flex justify-end">
          <button onClick={accept} className="btn-neon px-4 py-2 text-xs font-mono font-bold uppercase tracking-widest">
            I Understand — Continue
          </button>
        </div>
      </div>
    </div>
  );
}
