import { NextResponse } from "next/server";
import { configuredMap } from "@/lib/server/keyStore";
import { SOURCES, type SourceTier } from "@/lib/sources/manifest";
import { healthSnapshot } from "@/lib/server/sourceHealth";
import { cacheStats } from "@/lib/server/cache";
import { rateLimitConfig, phoneCacheConfig, emailCacheConfig } from "@/lib/server/config";

// Reports which data sources are active, which optional API keys are configured
// (and HOW — added in the app vs. via .env), and what each source actually did
// the last time it was called. Never returns key values.
//
// The source list is DERIVED from src/lib/sources/manifest.ts rather than
// duplicated here, so adding a provider can't leave this endpoint stale.

export const dynamic = "force-dynamic";

interface SourceInfo {
  id: string;
  name: string;
  tier: SourceTier;
  configured: boolean;
  via?: "ui" | "env" | null;
  keys?: string[];
  unlocks: string;
  modes: string[];
  signup?: string;
  /** What happened on the most recent call — absent until the source is used. */
  lastSeen?: {
    ok: boolean;
    ms: number;
    at: number;
    error?: string;
    /** True when the source was skipped because its key isn't configured. */
    skipped?: boolean;
  };
}

export async function GET(): Promise<NextResponse> {
  const cfg = await configuredMap();
  const health = healthSnapshot();

  // A multi-key source (Twilio) is configured only when EVERY key is present;
  // its provenance is the "weakest" of them.
  const provenance = (names: (keyof typeof cfg)[]): "ui" | "env" | null => {
    if (names.some((n) => cfg[n] === null)) return null;
    return names.some((n) => cfg[n] === "ui") ? "ui" : "env";
  };

  const sources: SourceInfo[] = SOURCES.map((s) => {
    const keys = s.keys ?? [];
    const configured = s.tier === "free" || keys.every((k) => cfg[k] !== null);
    const observed = health[s.id];
    return {
      id: s.id,
      name: s.name,
      tier: s.tier,
      configured,
      ...(s.tier === "key" ? { via: provenance(keys), keys } : {}),
      unlocks: s.unlocks,
      modes: s.modes,
      ...(s.signup ? { signup: s.signup } : {}),
      ...(observed
        ? {
            lastSeen: {
              ok: observed.ok,
              ms: observed.ms,
              at: observed.fetchedAt,
              ...(observed.error ? { error: observed.error } : {}),
              ...(observed.skipped ? { skipped: true } : {}),
            },
          }
        : {}),
    };
  });

  const keyTotal = sources.filter((s) => s.tier === "key").length;
  const keyActive = sources.filter((s) => s.tier === "key" && s.configured).length;

  const rl = rateLimitConfig();
  return NextResponse.json(
    {
      sources,
      keyTotal,
      keyActive,
      // The live values of the runtime knobs, so the UI can show the real limit
      // instead of a number baked into a help string.
      runtime: {
        rateLimit: { max: rl.max, windowMs: rl.windowMs, globalMax: rl.globalMax },
        cache: { phone: phoneCacheConfig(), email: emailCacheConfig(), entries: cacheStats() },
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
