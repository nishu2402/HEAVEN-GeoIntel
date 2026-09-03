// ── Upstream quota budget ────────────────────────────────────────────────────
//
// Some free providers tell you how much quota you have left, in the response to
// every call. ip-api.com is the one that matters here: it allows 45 requests
// per minute per source IP and returns `X-Rl` (requests remaining in this
// window) and `X-Ttl` (seconds until the window resets) on every response.
//
// Through 2.0.1 the app ignored both, and that is the bug behind "the tool keeps
// giving server errors". The failure escalates on its own:
//
//   1. A run of IP lookups crosses 45/min. ip-api starts answering 429.
//   2. Every IP lookup now fails — the route treated the geo source as
//      mandatory, so Shodan and GreyNoise answering changed nothing.
//   3. The analyst does what anyone does with a failing button: presses it
//      again. ip-api's documented response to sustained over-limit traffic is
//      to ban the source IP for an HOUR.
//
// Step 3 is the expensive one, and it is entirely self-inflicted: the quota was
// in our hands the whole time. So we remember what the provider last told us
// and simply stop calling it once the budget is gone, until the window resets.
// A request we never send cannot earn a ban, and the caller falls through to a
// second provider instead of showing a failure.
//
// Deliberately in-process and unsynchronised. This is a self-hosted
// single-process tool; the budget mirrors what one Node process has spent, and
// the cost of being wrong is one 429 that the caller already handles. Nothing
// here is a security control.

import { fetchJson, type FetchResult } from "./fetchSafe";

interface Budget {
  /** Requests the provider said were left, decremented as we spend them. */
  remaining: number;
  /** Epoch ms when the provider said the window resets. */
  resetsAt: number;
}

const budgets = new Map<string, Budget>();

/**
 * How close to the limit we stop. The provider's count and ours drift — a
 * retry, another process, or a second browser all spend from the same per-IP
 * pool — so the last couple of requests are left unspent rather than gambled.
 */
const RESERVE = 2;

/** Test seam, and the reset a key change or a restart implies. */
export function resetBudgets(): void {
  budgets.clear();
}

/**
 * May we call this provider right now?
 *
 * Unknown providers are always allowed: absence of information is not evidence
 * of an exhausted quota, and a gate that defaults to "no" would break every
 * source that does not publish its budget.
 */
export function canSpend(provider: string, now: number = Date.now()): boolean {
  const b = budgets.get(provider);
  if (!b) return true;
  if (now >= b.resetsAt) {
    budgets.delete(provider);
    return true;
  }
  return b.remaining > RESERVE;
}

/** Seconds until the provider's window resets, or null if it isn't throttled. */
export function retryAfter(provider: string, now: number = Date.now()): number | null {
  const b = budgets.get(provider);
  if (!b || now >= b.resetsAt || b.remaining > RESERVE) return null;
  return Math.max(1, Math.ceil((b.resetsAt - now) / 1000));
}

/**
 * Record what a provider reported about its own quota.
 *
 * `remaining` and `ttlSeconds` come straight off the response headers, so both
 * are strings of unknown quality — a provider that changes its header format,
 * or a proxy that strips it, must not be able to corrupt the budget. Anything
 * unparseable is ignored, which returns us to the previous behaviour (call it
 * and see) rather than to a wrong answer.
 */
export function record(
  provider: string,
  remaining: string | number | null | undefined,
  ttlSeconds: string | number | null | undefined,
  now: number = Date.now(),
): void {
  const left = toInt(remaining);
  const ttl = toInt(ttlSeconds);
  if (left === null || ttl === null) return;

  budgets.set(provider, {
    remaining: left,
    // A provider reporting 0 remaining with a 0 ttl means the window is turning
    // over right now; windowSeconds' floor of one second keeps that from
    // becoming an already-expired budget we immediately discard.
    resetsAt: now + windowSeconds(ttl, now) * 1000,
  });
}

/**
 * Note a request we are about to make, so N calls in flight at once cannot all
 * read the same "1 remaining" and all decide to go.
 */
export function spend(provider: string): void {
  const b = budgets.get(provider);
  if (b) b.remaining = Math.max(0, b.remaining - 1);
}

/**
 * Treat the provider as exhausted for `seconds`, whatever its headers said.
 *
 * For the case where a provider answers 429 without a usable quota header: it
 * has told us to back off in the clearest terms available, and continuing to
 * call it is what turns throttling into a ban.
 */
export function backOff(provider: string, seconds: number, now: number = Date.now()): void {
  budgets.set(provider, { remaining: 0, resetsAt: now + windowSeconds(seconds, now) * 1000 });
}

function toInt(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Anything at or above this is an absolute epoch-seconds timestamp, not a
 * duration. 10^9 seconds is 2001; no provider means "come back in 31 years".
 */
const EPOCH_THRESHOLD = 1_000_000_000;

/**
 * Never hold a source down for longer than this, whatever its headers claim.
 *
 * The two conventions are indistinguishable without a heuristic — ip-api's
 * `X-Ttl` counts seconds down, GreyNoise's `x-ratelimit-reset` is an epoch
 * timestamp — and reading one as the other is how a live source got parked for
 * 56 years in testing. The heuristic above handles the normal cases; this is
 * the backstop, because the cost of being wrong is asymmetric. Retrying an
 * hour early costs one 429 that is already handled; retrying a week late means
 * a working provider silently stopped being used.
 */
const MAX_WINDOW_SECONDS = 3600;

/** Normalise "seconds from now" and "epoch timestamp" onto the former. */
function windowSeconds(raw: number, now: number): number {
  const seconds = raw >= EPOCH_THRESHOLD ? raw - Math.floor(now / 1000) : raw;
  return Math.min(Math.max(1, seconds), MAX_WINDOW_SECONDS);
}

// ── Applying the budget to a call ────────────────────────────────────────────

/**
 * Quota headers worth reading. No provider sends all of them; each sends at
 * most one pair, and unrecognised names cost nothing.
 *
 *   x-rl / x-ttl                              ip-api.com
 *   x-ratelimit-remaining / x-ratelimit-reset  the de-facto convention
 *   retry-after                                RFC 9110, sent with a 429
 */
const QUOTA_HEADERS = [
  "x-rl", "x-ttl",
  "x-ratelimit-remaining", "x-ratelimit-reset",
  "retry-after",
] as const;

/** Fallback back-off when a source says 429 but not for how long. */
const DEFAULT_BACKOFF_SECONDS = 60;

/**
 * `fetchJson` that respects — and learns — the provider's rate limit.
 *
 * A source that has already told us it is out of budget is not called at all;
 * the caller gets a synthetic 429 result that reads like any other failure, so
 * nothing downstream needs to know the difference. This is what keeps a
 * one-minute throttle from becoming an hour-long ban: the requests that would
 * have earned the ban are never sent.
 */
export async function fetchBudgeted<T>(
  url: string,
  opts: Parameters<typeof fetchJson<T>>[1],
): Promise<FetchResult<T>> {
  const provider = opts.source;

  const wait = retryAfter(provider);
  if (wait !== null) {
    return {
      ok: false,
      status: 429,
      error: `rate-limited by source: retrying in ${wait}s`,
      source: provider,
      fetchedAt: Date.now(),
      ms: 0,
    };
  }

  spend(provider);
  const res = await fetchJson<T>(url, {
    ...opts,
    readHeaders: [...new Set([...QUOTA_HEADERS, ...(opts.readHeaders ?? [])])],
  });

  const h = res.headers ?? {};
  // The provider's own count beats our tally of it.
  record(provider, h["x-rl"] ?? h["x-ratelimit-remaining"], h["x-ttl"] ?? h["x-ratelimit-reset"]);
  if (res.status === 429) {
    backOff(provider, toInt(h["retry-after"] ?? h["x-ttl"]) ?? DEFAULT_BACKOFF_SECONDS);
  }
  return res;
}
