// ── Resilient outbound fetch ─────────────────────────────────────────────────
// Every third-party OSINT call goes through here so that:
//   • a slow/dead source can NEVER hang a lookup (hard AbortController timeout),
//   • failures are explicit and attributable (we return WHY a source is missing
//     instead of letting the UI show a bare "N/A"),
//   • each result carries provenance: which source, when, how long it took.
//
// This is the runtime half of the project's accuracy rule: we only ever show a
// value we actually received, and we always say where it came from.

import { USER_AGENT } from "../version";

/**
 * Merge the outbound User-Agent into a caller's headers without overriding one
 * they set deliberately.
 *
 * This is a default rather than a courtesy. Node's `fetch` sends NO User-Agent
 * at all, and several sources this tool depends on refuse an unidentified
 * client outright: rdap.org (Cloudflare) answers a UA-less request with 403,
 * which silently killed WHOIS for every domain and made the UI report
 * "WHOIS unavailable for this TLD via RDAP" for .com. Setting it here — rather
 * than at each call site, which is how that gap opened — means a new source
 * gets it by default and cannot regress the same way.
 */
export function withUserAgent(init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers);
  if (!headers.has("user-agent")) headers.set("User-Agent", USER_AGENT);
  return { ...init, headers };
}

export interface SourceMeta {
  /** Human-readable source name, e.g. "Shodan InternetDB". */
  source: string;
  /** Epoch ms when the response was received. */
  fetchedAt: number;
  /** Round-trip time in ms. */
  ms: number;
}

export interface FetchResult<T> extends SourceMeta {
  ok: boolean;
  status: number;          // HTTP status, or 0 on network/timeout error
  data?: T;
  /** Set when ok === false: a short, user-safe reason (never a stack trace). */
  error?: string;
  /**
   * Only the response headers the caller named in `readHeaders`, lower-cased.
   *
   * Opt-in rather than "all of them": several providers put quota state in
   * headers we genuinely need (see upstreamBudget), but response headers can
   * also carry cookies and provider-side identifiers, and this object gets
   * passed around inside route handlers. Naming the headers keeps that to
   * exactly what was asked for.
   */
  headers?: Record<string, string>;
}

interface Options {
  source: string;
  timeoutMs?: number;
  /** Passed through to fetch (headers, method, body, …). */
  init?: RequestInit;
  /** Treat a non-2xx status as a soft result (still parse) instead of error. */
  allowNon2xx?: boolean;
  /** Response headers to capture into `FetchResult.headers`, case-insensitive. */
  readHeaders?: readonly string[];
}

const DEFAULT_TIMEOUT = 7000;

function reason(status: number, err?: unknown): string {
  if (err instanceof DOMException && err.name === "TimeoutError") return "timed out";
  if (err instanceof DOMException && err.name === "AbortError") return "aborted";
  if (status === 0) return "unreachable";
  if (status === 404) return "not found";
  if (status === 429) return "rate-limited by source";
  if (status >= 500) return `source error (HTTP ${status})`;
  if (status >= 400) return `rejected (HTTP ${status})`;
  return `HTTP ${status}`;
}

/**
 * Map a caught exception to a short, user-safe reason string. Used by route
 * handlers that fetch providers directly (with the API key embedded in the URL)
 * so a network/parse error is surfaced WITHOUT ever stringifying the raw Error
 * — a raw `String(err)` can carry request URLs or internal detail to the client.
 */
export function describeError(err: unknown): string {
  if (err instanceof DOMException && err.name === "TimeoutError") return "timed out";
  if (err instanceof DOMException && err.name === "AbortError") return "aborted";
  return "request failed";
}

/**
 * Fetch + JSON-parse with a hard timeout and structured provenance. Never
 * throws — failures come back as { ok:false, error, source, fetchedAt, ms }.
 */
export async function fetchJson<T>(url: string, opts: Options): Promise<FetchResult<T>> {
  const { source, timeoutMs = DEFAULT_TIMEOUT, init, allowNon2xx, readHeaders } = opts;
  const started = Date.now();
  try {
    const res = await fetch(url, { ...withUserAgent(init), signal: AbortSignal.timeout(timeoutMs) });
    const ms = Date.now() - started;
    // Captured before any early return: a 429 is exactly when a provider's
    // quota headers matter most, and that is the path that returns first.
    //
    // `res.headers &&` because the body is the point and the headers are
    // garnish — a duck-typed response that carries only `status` and `json`
    // must still deliver its data rather than failing as "unreachable".
    const headers = readHeaders?.length && res.headers
      ? Object.fromEntries(
          readHeaders
            .map((h) => [h.toLowerCase(), res.headers.get(h)] as const)
            .filter((e): e is readonly [string, string] => e[1] !== null),
        )
      : undefined;
    if (!res.ok && !allowNon2xx) {
      return { ok: false, status: res.status, error: reason(res.status), source, fetchedAt: Date.now(), ms, headers };
    }
    let data: T | undefined;
    try { data = (await res.json()) as T; }
    catch {
      // A body that will not parse is a symptom, not the cause, whenever the
      // status already explains itself: ip-api answers its 429 with plain text,
      // and reporting "invalid JSON from source" sent the reader looking for a
      // parser bug instead of a rate limit. The status wins when it has
      // something to say.
      const error = res.ok ? "invalid JSON from source" : reason(res.status);
      return { ok: false, status: res.status, error, source, fetchedAt: Date.now(), ms, headers };
    }
    return {
      ok: res.ok,
      status: res.status,
      data,
      source,
      fetchedAt: Date.now(),
      ms,
      // `allowNon2xx` means "parse it anyway", not "pretend it was fine". Without
      // this the caller got ok:false and no reason, and the UI rendered a dead
      // source with an empty explanation — the exact silent N/A this module
      // exists to prevent. Callers that treat a given non-2xx as success (a 404
      // from GreyNoise means "not observed") simply ignore it.
      error: res.ok ? undefined : reason(res.status),
      headers,
    };
  } catch (err) {
    const ms = Date.now() - started;
    return { ok: false, status: 0, error: reason(0, err), source, fetchedAt: Date.now(), ms };
  }
}

/**
 * Run many source calls in parallel; never rejects. Returns each settled
 * FetchResult in input order (failed sources included, with their reason).
 */
export async function fetchAll<T>(jobs: Array<Promise<FetchResult<T>>>): Promise<Array<FetchResult<T>>> {
  const settled = await Promise.allSettled(jobs);
  return settled.map((s) =>
    s.status === "fulfilled"
      ? s.value
      : { ok: false, status: 0, error: "unexpected failure", source: "unknown", fetchedAt: Date.now(), ms: 0 } as FetchResult<T>
  );
}
