"use client";

import { useEffect, useState } from "react";
import { Sparkles, SparkleIcon } from "lucide-react";
import { effectsEnabled, setEffects, FX_EVENT } from "@/lib/client/effects";

// Header toggle for the decorative animations (matrix rain, etc.). Starts
// unmounted-safe: renders a stable icon on first paint, then syncs to the real
// setting after mount so there's no hydration mismatch.
export default function EffectsToggle() {
  const [on, setOn] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setOn(effectsEnabled());
    setMounted(true);
    const sync = () => setOn(effectsEnabled());
    window.addEventListener(FX_EVENT, sync);
    return () => window.removeEventListener(FX_EVENT, sync);
  }, []);

  const toggle = () => {
    const next = !on;
    setOn(next);
    setEffects(next);
  };

  return (
    <button
      onClick={toggle}
      aria-pressed={mounted ? on : undefined}
      title={on ? "Visual effects: ON — click to reduce motion" : "Visual effects: OFF — click to enable"}
      aria-label={on ? "Turn off visual effects" : "Turn on visual effects"}
      className={`p-1.5 rounded-md border transition-colors ${
        mounted && !on
          ? "border-[var(--hv-glass-border)] text-[var(--hv-ink-dim)] hover:text-[var(--hv-ink)]"
          : "border-[var(--hv-glass-border)] text-[var(--hv-cyan)] hover:border-[var(--hv-glass-hi)]"
      }`}
    >
      {mounted && !on ? <SparkleIcon className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
    </button>
  );
}
