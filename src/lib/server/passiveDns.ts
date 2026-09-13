// ── Passive DNS + reverse IP (keyless) ───────────────────────────────────────
//
// The roadmap recorded passive DNS as "mostly keyed upstreams" and parked it.
// That is no longer true, and it is worth correcting with the measurement:
//
//   api.mnemonic.no/pdns/v3/wordpress.org   → 1,000 records, keyless, each with
//                                             an rrtype and first/last-seen
//   api.hackertarget.com/reverseiplookup    → 499 hostnames on its A record
//
// Live DNS says what a name resolves to right now. Passive DNS says what it USED
// to resolve to, which is the half an investigation actually turns on: when the
// mail exchanger changed, which IP the phishing host sat on last month, what
// else lives on that address. Neither source needs a key.
//
// Both are quota'd, so both go through the same budget gate as every other free
// upstream, and a quota message is read as a quota message rather than parsed as
// data. Nothing here is inferred: a host only appears if a source named it.

import { backOff, canSpend, fetchBudgeted, retryAfter } from "./upstreamBudget";
import { withUserAgent } from "./fetchSafe";
import { isIP } from "node:net";
import { isValidAsciiHost } from "../analysis/idn";
import type { SourceProvenance } from "../types";

export const PDNS_SOURCE = "Mnemonic PDNS";
export const REVERSE_IP_SOURCE = "HackerTarget reverse IP";

/** One historical resolution, as passive DNS records them. */
export interface PassiveDnsRecord {
  /** The name that was queried (may be a subdomain of the input). */
  query: string;
  /** What it resolved to: an address, a hostname, or a TXT/MX value. */
  answer: string;
  /** Record type, upper-cased: A, AAAA, CNAME, MX, NS, TXT … */
  rrtype: string;
  /** ISO date the pair was first observed; null when the source omits it. */
  firstSeen: string | null;
  lastSeen: string | null;
  /** How many times the source observed the pair. */
  times: number | null;
}

export interface PassiveDnsResult {
  records: PassiveDnsRecord[];
  /** Total the source says it holds, which can exceed what we asked for. */
  total: number;
  /** True when `total` is larger than the records returned. */
  capped: boolean;
  /**
   * True when the source answered with flattened rows (see isDegraded), so
   * record types are only present where the answer itself proved them. The UI
   * says so rather than showing every record as an A.
   */
  degraded: boolean;
}

interface MnemonicRow {
  query?: string;
  answer?: string;
  rrtype?: string;
  times?: number;
  firstSeenTimestamp?: number;
  lastSeenTimestamp?: number;
  /** When the source created / last touched its own row for this pair. */
  createdTimestamp?: number;
  lastUpdatedTimestamp?: number;
}

interface MnemonicBody {
  responseCode?: number;
  count?: number;
  data?: MnemonicRow[];
}

/** Epoch millis → ISO date, or null for anything unusable. */
function isoDay(ms: number | undefined): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The anonymous tier sometimes answers with DEGRADED rows: every
 * `firstSeenTimestamp` and `lastSeenTimestamp` zeroed, and every `rrtype`
 * flattened to "a" — including rows whose answer is plainly an IPv6 address or
 * a hostname. Measured on wordpress.org: `limit=50` and `limit=100` returned
 * full rows, while `limit=25` and `limit=200` came back flattened, from the
 * same client seconds apart. It is a property of the response, not of the
 * request size.
 *
 * That matters because a flattened row is not merely thin, it is WRONG: an AAAA
 * observation labelled A is a false statement about the record. So a degraded
 * response is detected, retried once, and if it persists the labels are only
 * kept where the answer itself proves them.
 */
function isDegraded(rows: MnemonicRow[]): boolean {
  return rows.length >= 5 && rows.every((r) => !r.firstSeenTimestamp && !r.lastSeenTimestamp);
}

/** A record type the answer itself proves, or null when it proves nothing. */
function typeFromAnswer(answer: string): string | null {
  const v = isIP(answer);
  return v === 4 ? "A" : v === 6 ? "AAAA" : null;
}

/**
 * Passive-DNS history for a domain or an IP. Returns null when the source did
 * not answer — never an empty result, which would read as "this name has no
 * history".
 */
export async function fetchPassiveDns(
  query: string,
  limit = 150,
  timeoutMs = 7000,
): Promise<{ result: PassiveDnsResult | null; provenance: SourceProvenance }> {
  const url = `https://api.mnemonic.no/pdns/v3/${encodeURIComponent(query)}?limit=${limit}`;
  const opts = { source: PDNS_SOURCE, timeoutMs, allowNon2xx: true } as const;

  let res = await fetchBudgeted<MnemonicBody>(url, opts);
  let rows = res.status === 200 && res.data?.responseCode === 200 ? (res.data.data ?? []) : null;

  // One retry, because the flattening is per-response rather than per-query.
  let degraded = rows !== null && isDegraded(rows);
  if (degraded) {
    const retry = await fetchBudgeted<MnemonicBody>(url, opts);
    const retryRows = retry.status === 200 && retry.data?.responseCode === 200 ? (retry.data.data ?? []) : null;
    if (retryRows !== null && !isDegraded(retryRows)) {
      res = retry;
      rows = retryRows;
      degraded = false;
    }
  }

  if (rows === null) {
    return {
      result: null,
      provenance: {
        source: PDNS_SOURCE, ok: false, ms: res.ms, fetchedAt: res.fetchedAt,
        error: res.error ?? `passive DNS declined (code ${res.data?.responseCode ?? "unknown"})`,
      },
    };
  }

  const records: PassiveDnsRecord[] = rows
    .filter((r): r is MnemonicRow & { answer: string } => typeof r.answer === "string" && r.answer.length > 0)
    .map((r) => {
      const proven = typeFromAnswer(r.answer);
      return {
        query: r.query ?? query,
        // In a degraded response the label is only trusted when the answer
        // proves it; otherwise the type is reported as unknown rather than
        // asserted wrongly.
        rrtype: degraded
          ? (proven ?? "UNKNOWN")
          : ((r.rrtype ?? "").toUpperCase() || "UNKNOWN"),
        answer: r.answer,
        // The explicit first/last-seen fields when the source sends them,
        // otherwise its own row create/update stamps — which, measured against a
        // full response for the same pairs, matched the explicit values exactly.
        firstSeen: isoDay(r.firstSeenTimestamp) ?? isoDay(r.createdTimestamp),
        lastSeen: isoDay(r.lastSeenTimestamp) ?? isoDay(r.lastUpdatedTimestamp),
        times: typeof r.times === "number" ? r.times : null,
      };
    });

  const total = typeof res.data?.count === "number" ? res.data.count : records.length;
  return {
    result: { records, total, capped: total > records.length, degraded },
    provenance: { source: PDNS_SOURCE, ok: true, ms: res.ms, fetchedAt: res.fetchedAt },
  };
}

// ── Reverse IP ───────────────────────────────────────────────────────────────

/** The quota notice HackerTarget serves instead of results, in its own words. */
const QUOTA_MARKERS = ["api count exceeded", "error getting results", "input string"];
/** A day, because that is the window HackerTarget's free quota resets on. */
const QUOTA_BACKOFF_SECONDS = 3600;

/**
 * Every hostname the source has seen on one address.
 *
 * The response is plain text, one host per line, and its failure modes are also
 * plain text. Reading "API count exceeded" as a hostname is exactly the kind of
 * false positive this codebase refuses, so each line has to survive hostname
 * validation and a quota notice parks the source rather than being parsed.
 */
export async function fetchReverseIp(
  ip: string,
  timeoutMs = 7000,
): Promise<{ hosts: string[] | null; provenance: SourceProvenance }> {
  const started = Date.now();
  const wait = retryAfter(REVERSE_IP_SOURCE);
  /* v8 ignore next -- backOff sets both halves of the budget together, so
     "cannot spend" without a retry time is not reachable in practice; the
     second half of the condition is a belt-and-braces guard. */
  if (wait !== null || !canSpend(REVERSE_IP_SOURCE)) {
    return {
      hosts: null,
      provenance: {
        source: REVERSE_IP_SOURCE, ok: false, ms: 0, fetchedAt: Date.now(),
        error: `rate-limited by source: retrying in ${wait ?? QUOTA_BACKOFF_SECONDS}s`,
      },
    };
  }

  try {
    const res = await fetch(
      `https://api.hackertarget.com/reverseiplookup/?q=${encodeURIComponent(ip)}`,
      withUserAgent({ signal: AbortSignal.timeout(timeoutMs), next: { revalidate: 0 } }),
    );
    const ms = Date.now() - started;
    if (!res.ok) {
      return {
        hosts: null,
        provenance: { source: REVERSE_IP_SOURCE, ok: false, ms, fetchedAt: Date.now(), error: `rejected (HTTP ${res.status})` },
      };
    }
    const text = (await res.text()).slice(0, 200_000);
    const lower = text.toLowerCase();
    if (QUOTA_MARKERS.some((m) => lower.includes(m))) {
      backOff(REVERSE_IP_SOURCE, QUOTA_BACKOFF_SECONDS);
      return {
        hosts: null,
        provenance: { source: REVERSE_IP_SOURCE, ok: false, ms, fetchedAt: Date.now(), error: "daily quota exhausted at source" },
      };
    }
    const hosts = [
      ...new Set(
        text
          .split("\n")
          .map((l) => l.trim().toLowerCase().replace(/\.$/, ""))
          .filter((l) => isValidAsciiHost(l)),
      ),
    ].sort();
    return {
      hosts,
      provenance: { source: REVERSE_IP_SOURCE, ok: true, ms, fetchedAt: Date.now() },
    };
  } catch {
    return {
      hosts: null,
      provenance: { source: REVERSE_IP_SOURCE, ok: false, ms: Date.now() - started, fetchedAt: Date.now(), error: "unreachable or timed out" },
    };
  }
}
