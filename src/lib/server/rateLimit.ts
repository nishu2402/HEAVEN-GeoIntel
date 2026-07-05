import type { NextRequest } from "next/server";

const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 10;
const CLEANUP_INTERVAL_MS = 5 * 60_000; // clean stale buckets every 5 min

/**
 * Extract client IP for rate-limiting.
 *
 * X-Forwarded-For / X-Real-IP are trivially spoofable. Trust them ONLY when
 * the operator opts in via TRUST_PROXY=1 (e.g. behind Cloudflare, nginx, etc.).
 * Default behavior (local dev / direct exposure) ignores headers entirely.
 */
export function getClientIp(req: NextRequest): string {
  if (process.env.TRUST_PROXY === "1") {
    const xff = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (xff) return xff;
    const xri = req.headers.get("x-real-ip");
    if (xri) return xri;
  }
  // Next 15 removed NextRequest.ip. When not trusting a proxy, all direct
  // clients share one bucket — fine for local/self-host; behind a proxy set
  // TRUST_PROXY=1 to rate-limit per real client IP.
  return "127.0.0.1";
}

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

// Purge IP entries whose window has long since expired to prevent unbounded growth.
export function purgeExpired(now: number = Date.now()): void {
  Array.from(buckets.entries()).forEach(([ip, bucket]) => {
    if (now - bucket.windowStart > WINDOW_MS * 2) {
      buckets.delete(ip);
    }
  });
}
const cleanupTimer = setInterval(purgeExpired, CLEANUP_INTERVAL_MS);
// A background housekeeping timer must not, by itself, keep the process alive.
cleanupTimer.unref?.();

export function checkRateLimit(ip: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const bucket = buckets.get(ip);

  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    buckets.set(ip, { count: 1, windowStart: now });
    return { allowed: true, remaining: MAX_REQUESTS - 1 };
  }

  if (bucket.count >= MAX_REQUESTS) {
    return { allowed: false, remaining: 0 };
  }

  bucket.count += 1;
  return { allowed: true, remaining: MAX_REQUESTS - bucket.count };
}
