"use client";

import { useSyncExternalStore } from "react";
import { ShieldAlert } from "lucide-react";

// First-run permitted-use gate. Acceptance lives in localStorage (an external
// store), read via useSyncExternalStore: getServerSnapshot returns false so the
// server + first client paint render nothing (no hydration mismatch), then React
// reads the real value after hydration and reveals the gate only if the user
// hasn't accepted before.
const KEY = "hv-consent-v1";
const EVENT = "hv-consent-changed";

// True while the user still needs to see the gate (hasn't accepted yet).
function needsConsent(): boolean {
  try { return localStorage.getItem(KEY) !== "1"; } catch { return false; }
}
function subscribe(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export default function ConsentGate() {
  const show = useSyncExternalStore(subscribe, needsConsent, () => false);

  if (!show) return null;

  function accept() {
    try { localStorage.setItem(KEY, "1"); } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent(EVENT)); // re-read the store → hide
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
