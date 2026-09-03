// ── ProxyNova COMB — credential-pair exposure (free, no API key) ─────────────
//
// COMB ("Compilation of Many Breaches") is a corpus of billions of
// email:password pairs. ProxyNova exposes a keyless search over it. It is the
// strongest keyless evidence that a specific password was exposed — and the
// most dangerous source to render naively, for two reasons this module exists
// to handle:
//
//   1. It matches SUBSTRINGS, not the exact identifier. A query for a made-up
//      address comes back full of unrelated logins that merely share a fragment
//      ("9931@wes.com" for "…-9931@…"). Rendering those would be exactly the
//      false positive the project forbids. `parseComb` keeps ONLY lines whose
//      login equals the queried email, so a fuzzy index can never be read as
//      "this address was breached".
//   2. It returns CLEARTEXT passwords. They are masked here, on the server, the
//      moment they are parsed — the route only ever sees a count and masked
//      previews. A real password is never placed in a response, a case, or a
//      pivot, matching the Hudson Rock masking rule.
//
// Email only. An exact-login match is well defined for an email; a bare
// username is not (COMB logins are addresses), so applying this to a handle
// would reintroduce the fuzzy match it exists to prevent.

import { describeError } from "./fetchSafe";
import { fetchTimeoutMs } from "./config";
import { USER_AGENT } from "../version";
import type { CombExposure, SourceResult } from "../types";

const ENDPOINT = "https://api.proxynova.com/comb";

/** How many rows to request. A page, not the whole corpus — COMB caps anyway. */
const DEFAULT_LIMIT = 100;

/** How many masked previews to keep. */
const MAX_SAMPLES = 6;

const EMPTY: CombExposure = { pairs: 0, distinctPasswords: 0, capped: false, samples: [] };

/**
 * Mask a secret so its shape is visible but it is never usable. Short strings
 * are fully starred; longer ones keep only the first and last character, with
 * the star run capped so an unusually long password does not leak its length.
 */
export function maskSecret(secret: string): string {
  if (secret.length <= 4) return "*".repeat(secret.length || 1);
  const stars = Math.min(secret.length - 2, 8);
  return `${secret[0]}${"*".repeat(stars)}${secret[secret.length - 1]}`;
}

/**
 * Keep only exact-login pairs for `email`, count distinct passwords, and return
 * masked previews. Pure — the fetch wrapper below hands it the raw `lines`.
 *
 * `requested` is the page size that was asked for; when the source returned a
 * full page, more matches may exist past it, which `capped` records.
 */
export function parseComb(lines: unknown, email: string, requested: number): CombExposure {
  const rows = Array.isArray(lines) ? lines.filter((l): l is string => typeof l === "string") : [];
  const target = email.trim().toLowerCase();
  const passwords: string[] = [];
  for (const line of rows) {
    const sep = line.indexOf(":");
    if (sep <= 0) continue; // no login, or no separator at all
    const login = line.slice(0, sep).trim().toLowerCase();
    if (login !== target) continue; // the exact-login discipline: no fuzzy hits
    const pw = line.slice(sep + 1);
    if (pw) passwords.push(pw);
  }
  const distinct = [...new Set(passwords)];
  return {
    pairs: passwords.length,
    distinctPasswords: distinct.length,
    capped: rows.length >= requested,
    samples: distinct.slice(0, MAX_SAMPLES).map(maskSecret),
  };
}

/** Query COMB for an email's exposed credential pairs. Never throws. */
export async function fetchComb(email: string, limit = DEFAULT_LIMIT): Promise<SourceResult<CombExposure>> {
  try {
    const res = await fetch(`${ENDPOINT}?query=${encodeURIComponent(email)}&limit=${limit}`, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(fetchTimeoutMs()),
      next: { revalidate: 0 },
    });

    if (res.status === 429) return { ok: false, error: "RATE_LIMITED" };
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };

    const raw = (await res.json()) as { lines?: unknown; error?: string };
    // COMB rejects a query shorter than four characters. An email is always
    // longer, so this is defensive: a rejection is a failed call, never a clean
    // "nothing found" that would hide exposure.
    if (raw.error) return { ok: false, error: "rejected by source" };

    return { ok: true, data: raw.lines === undefined ? EMPTY : parseComb(raw.lines, email, limit) };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}
