// ── Have I Been Pwned — per-account breaches (optional API key) ───────────────
//
// The keyless breach indexes (XposedOrNot, LeakCheck) each know a slice of the
// breach world, and for many addresses they agree. HIBP's per-account API knows
// the widest slice, but it is gated on a paid key, so this source is optional:
// with no key it reports NOT_CONFIGURED and contributes nothing (the free union
// stands on its own); with a key its breaches join the same deduplicated union
// as every other source, which is what lets the tool match HIBP's own count.
//
// Accuracy discipline (the project's no-false-positives rule):
//   • 404 is HIBP's "this account is in no known breach" — a real, clean answer,
//     rendered as zero breaches, never as an outage.
//   • 401 (bad or missing key) and 429 (rate limited) are failures, not clean
//     results: they surface as errors so a key problem never reads as "no breaches".
//   • It returns breach METADATA only (names, dates, data classes, counts) — no
//     passwords or record contents. A "Passwords" data class is password evidence
//     for that breach, consistent with how the other sources are treated.

import { resolveKey } from "./keyStore";
import { describeError } from "./fetchSafe";
import { fetchTimeoutMs } from "./config";
import { USER_AGENT } from "../version";
import type { HibpData, HibpBreach, SourceResult } from "../types";

const ENDPOINT = "https://haveibeenpwned.com/api/v3/breachedaccount";

interface HibpRaw {
  Name?: unknown;
  Title?: unknown;
  Domain?: unknown;
  BreachDate?: unknown;
  PwnCount?: unknown;
  DataClasses?: unknown;
  IsVerified?: unknown;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Turn HIBP's breachedaccount array into typed breaches, dropping junk rows. */
export function parseHibpBreaches(raw: unknown): HibpBreach[] {
  if (!Array.isArray(raw)) return [];
  const out: HibpBreach[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as HibpRaw;
    const name = str(r.Name) || str(r.Title);
    if (!name) continue;
    out.push({
      name,
      title: str(r.Title) || name,
      domain: str(r.Domain),
      breachDate: str(r.BreachDate),
      pwnCount: num(r.PwnCount),
      dataClasses: Array.isArray(r.DataClasses)
        ? r.DataClasses.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        : [],
      verified: r.IsVerified === true,
    });
  }
  return out;
}

export async function fetchHibp(email: string): Promise<SourceResult<HibpData>> {
  // Same "no key → skip" contract as the other optional keyed sources, so the
  // dashboard shows it as NOT_CONFIGURED rather than a permanent error row.
  const key = await resolveKey("HIBP_API_KEY");
  if (!key) return { ok: false, error: "NOT_CONFIGURED" };

  try {
    const res = await fetch(`${ENDPOINT}/${encodeURIComponent(email)}?truncateResponse=false`, {
      headers: { "hibp-api-key": key, "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(fetchTimeoutMs()),
      next: { revalidate: 0 },
    });

    if (res.status === 404) return { ok: true, data: { breachCount: 0, breaches: [] } };
    if (res.status === 401) return { ok: false, error: "UNAUTHORIZED" };
    if (res.status === 429) return { ok: false, error: "RATE_LIMITED" };
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };

    const breaches = parseHibpBreaches(await res.json());
    return { ok: true, data: { breachCount: breaches.length, breaches } };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}
