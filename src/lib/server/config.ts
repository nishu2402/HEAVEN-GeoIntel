// ── Runtime configuration ────────────────────────────────────────────────────
// Every operational knob that used to be a compile-time constant lives here and
// reads from the environment, with the historical hardcoded value as its
// default. Nothing changes behaviour out of the box — but an operator can now
// tune limits, TTLs and timeouts for a real investigation without editing
// TypeScript and rebuilding.
//
// Values are read on EVERY call rather than frozen at module load: `next start`
// is long-lived, and reading late means a value is never captured before the
// process env is fully populated. The cost is a `Number()` per lookup.

/** Parse an integer env var, clamped to a sane range. Junk falls back silently. */
export function intFromEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** Parse a boolean env var. Only "1"/"true" (case-insensitive) enable it. */
export function boolFromEnv(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface RateLimitConfig {
  /** Requests allowed per window, per client. */
  max: number;
  /** Window length in ms. */
  windowMs: number;
  /**
   * Ceiling across ALL clients in the same window. Protects free-tier upstream
   * quotas from a runaway script that discards its client cookie each request.
   * Set generously so it never bites a human analyst.
   */
  globalMax: number;
}

export function rateLimitConfig(): RateLimitConfig {
  return {
    // 10/min (the pre-1.4 value) throttled a single multi-pivot investigation.
    // 60/min is one lookup per second sustained — comfortable for a human,
    // still far below what would exhaust a free upstream tier.
    max: intFromEnv("RATE_LIMIT_MAX", 60, 1, 100_000),
    windowMs: intFromEnv("RATE_LIMIT_WINDOW_MS", MINUTE, 1_000, 60 * MINUTE),
    globalMax: intFromEnv("RATE_LIMIT_GLOBAL_MAX", 600, 1, 1_000_000),
  };
}

export interface CacheConfig {
  ttlMs: number;
  maxEntries: number;
}

/** Phone-lookup result cache. */
export function phoneCacheConfig(): CacheConfig {
  return {
    ttlMs: intFromEnv("CACHE_TTL_MS", DAY, 0, 30 * DAY),
    maxEntries: intFromEnv("CACHE_MAX_ENTRIES", 1000, 1, 1_000_000),
  };
}

/** Email-lookup result cache. Falls back to the phone cache vars when unset. */
export function emailCacheConfig(): CacheConfig {
  return {
    ttlMs: intFromEnv("EMAIL_CACHE_TTL_MS", phoneCacheConfig().ttlMs, 0, 30 * DAY),
    maxEntries: intFromEnv("EMAIL_CACHE_MAX_ENTRIES", 500, 1, 1_000_000),
  };
}

/**
 * IP-lookup result cache.
 *
 * Shorter by default than phone or email (1 h vs 24 h) because an IP's
 * *exposure* is the volatile part of the answer: a host's open ports and
 * GreyNoise classification can change within a day, while a phone number's
 * carrier and country do not. Long enough to cover a working session — which
 * is what protects ip-api.com's 45-requests-per-minute budget from a repeated
 * lookup, a page refresh, or a shared result link being opened again.
 */
export function ipCacheConfig(): CacheConfig {
  return {
    ttlMs: intFromEnv("IP_CACHE_TTL_MS", HOUR, 0, 30 * DAY),
    maxEntries: intFromEnv("IP_CACHE_MAX_ENTRIES", 500, 1, 1_000_000),
  };
}

/** Per-source upstream fetch timeout, in ms. */
export function fetchTimeoutMs(): number {
  return intFromEnv("SOURCE_TIMEOUT_MS", 8_000, 500, 120_000);
}

/**
 * Concurrency cap for the username site sweep and the domain fanout. Higher is
 * faster but more likely to trip an upstream's own per-IP throttle.
 */
export function fanoutConcurrency(): number {
  return intFromEnv("FANOUT_CONCURRENCY", 12, 1, 128);
}

/**
 * How many lookup snapshots a case keeps PER identifier. Each one is a small
 * bag of scalars, but a case re-run daily would otherwise grow without bound.
 * Five gives a usable trend while keeping the on-disk case small.
 */
export function snapshotHistory(): number {
  return intFromEnv("CASE_SNAPSHOT_HISTORY", 5, 1, 200);
}
