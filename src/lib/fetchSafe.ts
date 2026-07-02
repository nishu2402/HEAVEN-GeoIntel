// ── Resilient outbound fetch ─────────────────────────────────────────────────
// Every third-party OSINT call goes through here so that:
//   • a slow/dead source can NEVER hang a lookup (hard AbortController timeout),
//   • failures are explicit and attributable (we return WHY a source is missing
//     instead of letting the UI show a bare "N/A"),
//   • each result carries provenance: which source, when, how long it took.
//
// This is the runtime half of the project's accuracy rule: we only ever show a
// value we actually received, and we always say where it came from.

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
}

interface Options {
  source: string;
  timeoutMs?: number;
  /** Passed through to fetch (headers, method, body, …). */
  init?: RequestInit;
  /** Treat a non-2xx status as a soft result (still parse) instead of error. */
  allowNon2xx?: boolean;
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
  const { source, timeoutMs = DEFAULT_TIMEOUT, init, allowNon2xx } = opts;
  const started = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const ms = Date.now() - started;
    if (!res.ok && !allowNon2xx) {
      return { ok: false, status: res.status, error: reason(res.status), source, fetchedAt: Date.now(), ms };
    }
    let data: T | undefined;
    try { data = (await res.json()) as T; }
    catch { return { ok: false, status: res.status, error: "invalid JSON from source", source, fetchedAt: Date.now(), ms }; }
    return { ok: res.ok, status: res.status, data, source, fetchedAt: Date.now(), ms };
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
