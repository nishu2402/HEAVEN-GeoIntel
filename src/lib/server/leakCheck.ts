// ── LeakCheck public breach index (free, no API key) ─────────────────────────
//
// One keyless source that answers for THREE of the five lookup modes — email,
// phone and username — which is why it lives here rather than inline in a
// route. It reports how many indexed breach records mention an identifier,
// which field types were exposed, and the named breaches.
//
// It returns NO credentials. The public tier deliberately omits passwords and
// record contents (those are the paid API), so everything we surface is
// exposure metadata: counts, field names, breach names and dates.
//
// Accuracy notes, in keeping with the project's no-false-positives rule:
//   • `found: 0` is a real answer ("indexed, nothing matched") and is rendered
//     as a clean result — not as an outage.
//   • The endpoint auto-detects the search type, but a phone in +E.164 form is
//     rejected with "Could not determine search type automatically". We send
//     bare digits plus an explicit `type=phone`, which is verified to work.
//   • A 429 is reported as RATE_LIMITED. The public tier is shared per source
//     IP, so a busy instance can exhaust it; that must read as "we could not
//     ask", never as "this identifier is clean".

import { describeError } from "./fetchSafe";
import { fetchTimeoutMs } from "./config";
import { USER_AGENT } from "../version";
import type { LeakCheckData, LeakCheckSource, SourceResult } from "../types";

const ENDPOINT = "https://leakcheck.io/api/public";

/** Which identifier is being checked — decides the `type` hint we send. */
export type LeakCheckKind = "email" | "phone" | "username";

const EMPTY: LeakCheckData = { found: 0, fields: [], sources: [] };

interface LeakCheckRaw {
  success?: boolean;
  found?: number;
  fields?: unknown;
  sources?: unknown;
  error?: string;
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
}

function parseSources(v: unknown): LeakCheckSource[] {
  if (!Array.isArray(v)) return [];
  const out: LeakCheckSource[] = [];
  for (const row of v) {
    if (!row || typeof row !== "object") continue;
    const r = row as { name?: unknown; date?: unknown };
    if (typeof r.name !== "string" || !r.name.trim()) continue;
    // The index stores "" for breaches with no known date — carry that through
    // as null rather than printing an empty cell.
    const date = typeof r.date === "string" && r.date.trim() ? r.date.trim() : null;
    out.push({ name: r.name.trim(), date });
  }
  return out;
}

/**
 * Build the query string for an identifier. Phones go as bare digits with an
 * explicit type; email/username rely on the endpoint's own detection, which is
 * unambiguous for both.
 */
export function leakCheckQuery(identifier: string, kind: LeakCheckKind): string {
  if (kind === "phone") {
    const digits = identifier.replace(/\D/g, "");
    return `check=${encodeURIComponent(digits)}&type=phone`;
  }
  return `check=${encodeURIComponent(identifier)}`;
}

export async function fetchLeakCheck(
  identifier: string,
  kind: LeakCheckKind,
): Promise<SourceResult<LeakCheckData>> {
  try {
    const res = await fetch(`${ENDPOINT}?${leakCheckQuery(identifier, kind)}`, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(fetchTimeoutMs()),
      next: { revalidate: 0 },
    });

    if (res.status === 429) return { ok: false, error: "RATE_LIMITED" };
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };

    const raw = (await res.json()) as LeakCheckRaw;

    // The endpoint answers 200 with `success: false` for "no records" AND for
    // real refusals ("Could not determine search type automatically"). Only the
    // not-found message is a clean result; anything else is a failed call, so a
    // malformed query can never be shown to the analyst as "no exposure".
    if (raw.success === false) {
      const err = (raw.error ?? "").toLowerCase();
      if (err.includes("not found") || err.includes("no results")) {
        return { ok: true, data: EMPTY };
      }
      return { ok: false, error: raw.error ?? "rejected by source" };
    }

    const found = typeof raw.found === "number" && Number.isFinite(raw.found) ? raw.found : 0;
    return {
      ok: true,
      data: { found, fields: strings(raw.fields), sources: parseSources(raw.sources) },
    };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}
