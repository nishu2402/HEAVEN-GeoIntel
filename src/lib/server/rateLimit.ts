import { NextResponse, type NextRequest } from "next/server";
import { rateLimitConfig } from "./config";

const CLEANUP_INTERVAL_MS = 5 * 60_000; // clean stale buckets every 5 min

/**
 * First-party cookie carrying an opaque random per-browser id, set by
 * `src/proxy.ts`. It exists ONLY to give each browser its own rate-limit
 * bucket — it holds no identity, is never read by client JS (HttpOnly), and is
 * never logged or sent anywhere.
 */
export const CLIENT_ID_COOKIE = "hv_rl";

// Bound what may become a bucket key. Without this, a client that sends a fresh
// 4 KB cookie per request would grow the bucket Map without limit.
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** Read one cookie straight off the header — works with any duck-typed request. */
function cookieValue(req: NextRequest, name: string): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/**
 * Identify the caller for rate-limiting.
 *
 * Next removed `NextRequest.ip`, so there is no socket address available in a
 * route handler. We resolve the best key available, most trustworthy first:
 *
 *  1. `TRUST_PROXY=1` → the real client IP from X-Forwarded-For / X-Real-IP.
 *     These are trivially spoofable, so they are honoured only when the
 *     operator opts in (i.e. there really is a proxy stripping/setting them).
 *  2. The `hv_rl` cookie → one bucket per browser. Clearing it grants a fresh
 *     bucket, which is why a global ceiling also applies (see checkRateLimit).
 *  3. Otherwise a single shared bucket — non-browser clients (curl, scripts).
 */
export function getClientKey(req: NextRequest): string {
  if (process.env.TRUST_PROXY === "1") {
    const xff = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (xff) return `ip:${xff}`;
    const xri = req.headers.get("x-real-ip")?.trim();
    if (xri) return `ip:${xri}`;
  }
  const cid = cookieValue(req, CLIENT_ID_COOKIE);
  if (cid && CLIENT_ID_RE.test(cid)) return `cid:${cid}`;
  return "shared";
}

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

// Purge entries whose window has long since expired to prevent unbounded growth.
export function purgeExpired(now: number = Date.now()): void {
  const { windowMs } = rateLimitConfig();
  Array.from(buckets.entries()).forEach(([key, bucket]) => {
    if (now - bucket.windowStart > windowMs * 2) {
      buckets.delete(key);
    }
  });
}
const cleanupTimer = setInterval(purgeExpired, CLEANUP_INTERVAL_MS);
// A background housekeeping timer must not, by itself, keep the process alive.
cleanupTimer.unref?.();

/** Test seam: drop all buckets so cases start from a known state. */
export function resetRateLimit(): void {
  buckets.clear();
}

export interface RateLimitVerdict {
  allowed: boolean;
  /** Remaining requests in this window for the binding scope. */
  remaining: number;
  /** The limit that was applied (per-client, or the global ceiling). */
  limit: number;
  windowMs: number;
  /** Seconds until the binding window resets — the value for Retry-After. */
  retryAfter: number;
  /** Which limit is currently binding. */
  scope: "client" | "global";
}

/** Fixed-window counter. Returns null when the bucket is exhausted. */
function hit(key: string, max: number, windowMs: number, now: number): Bucket | null {
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart > windowMs) {
    const fresh = { count: 1, windowStart: now };
    buckets.set(key, fresh);
    return fresh;
  }
  if (bucket.count >= max) return null;
  bucket.count += 1;
  return bucket;
}

const GLOBAL_KEY = "\0global";

/**
 * Consume one request against both the per-client bucket and the global
 * ceiling. The client bucket is charged first; if it is exhausted the global
 * counter is deliberately NOT charged, so one noisy client cannot burn down the
 * shared allowance for everyone else.
 */
export function checkRateLimit(key: string, now: number = Date.now()): RateLimitVerdict {
  const { max, windowMs, globalMax } = rateLimitConfig();

  const client = hit(key, max, windowMs, now);
  if (!client) {
    const bucket = buckets.get(key)!;
    return {
      allowed: false,
      remaining: 0,
      limit: max,
      windowMs,
      retryAfter: retryAfterFor(bucket, windowMs, now),
      scope: "client",
    };
  }

  const global = hit(GLOBAL_KEY, globalMax, windowMs, now);
  if (!global) {
    // Refund the client charge — the request never ran, so it should not count
    // against this browser's own allowance.
    client.count -= 1;
    const bucket = buckets.get(GLOBAL_KEY)!;
    return {
      allowed: false,
      remaining: 0,
      limit: globalMax,
      windowMs,
      retryAfter: retryAfterFor(bucket, windowMs, now),
      scope: "global",
    };
  }

  return {
    allowed: true,
    remaining: max - client.count,
    limit: max,
    windowMs,
    retryAfter: retryAfterFor(client, windowMs, now),
    scope: "client",
  };
}

function retryAfterFor(bucket: Bucket, windowMs: number, now: number): number {
  return Math.max(1, Math.ceil((bucket.windowStart + windowMs - now) / 1000));
}

/** Standard rate-limit headers, identical on every route and on both 200 and 429. */
export function rateLimitHeaders(v: RateLimitVerdict): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(v.limit),
    "X-RateLimit-Remaining": String(v.remaining),
    "X-RateLimit-Window": `${Math.round(v.windowMs / 1000)}s`,
    "X-RateLimit-Scope": v.scope,
  };
}

/** The single 429 response shape shared by every rate-limited route. */
export function rateLimitedResponse(v: RateLimitVerdict): NextResponse {
  const perWindow = `${v.limit} requests per ${Math.round(v.windowMs / 1000)}s`;
  return NextResponse.json(
    {
      error:
        v.scope === "global"
          ? `Server-wide rate limit exceeded (${perWindow} across all clients). Raise RATE_LIMIT_GLOBAL_MAX to change.`
          : `Rate limit exceeded. Max ${perWindow}. Raise RATE_LIMIT_MAX to change.`,
      retryAfter: v.retryAfter,
    },
    {
      status: 429,
      headers: { ...rateLimitHeaders(v), "Retry-After": String(v.retryAfter) },
    }
  );
}

/**
 * One-call guard for a route handler: consumes quota and returns either the
 * ready-made 429 or the headers to attach to the real response, plus the
 * client key for the audit log.
 */
export function guardRateLimit(
  req: NextRequest
):
  | { limited: NextResponse; headers?: never; client: string }
  | { limited: null; headers: Record<string, string>; client: string } {
  const client = getClientKey(req);
  const verdict = checkRateLimit(client);
  if (!verdict.allowed) return { limited: rateLimitedResponse(verdict), client };
  return { limited: null, headers: rateLimitHeaders(verdict), client };
}
