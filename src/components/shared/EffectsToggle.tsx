"use client";

import { useSyncExternalStore } from "react";
import { Sparkles, SparkleIcon } from "lucide-react";
import { effectsEnabled, setEffects, FX_EVENT } from "@/lib/client/effects";

// Header toggle for the decorative animations (matrix rain, etc.). The setting
// lives in localStorage (an external store), so we read it via
// useSyncExternalStore: getServerSnapshot returns the stable default (on) so the
// server + first client paint match, then React swaps in the real value after
// hydration. No mount effect, no synchronous setState, no hydration mismatch.
function subscribe(cb: () => void): () => void {
  window.addEventListener(FX_EVENT, cb);
  window.addEventListener("storage", cb); // pick up changes from other tabs
  return () => {
    window.removeEventListener(FX_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export default function EffectsToggle() {
  const on = useSyncExternalStore(subscribe, effectsEnabled, () => true);

  return (
    <button
      onClick={() => setEffects(!on)}
      aria-pressed={on}
      title={on ? "Visual effects: ON: click to reduce motion" : "Visual effects: OFF: click to enable"}
      aria-label={on ? "Turn off visual effects" : "Turn on visual effects"}
      className={`p-1.5 rounded-md border transition-colors ${
        !on
          ? "border-[var(--hv-glass-border)] text-[var(--hv-ink-dim)] hover:text-[var(--hv-ink)]"
          : "border-[var(--hv-glass-border)] text-[var(--hv-cyan)] hover:border-[var(--hv-glass-hi)]"
      }`}
    >
      {!on ? <SparkleIcon className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
    </button>
  );
}
