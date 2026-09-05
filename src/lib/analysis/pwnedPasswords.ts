// ── Pwned Passwords — "has this password ever leaked?", keyless and private ───
//
// The breach panels answer "is this ACCOUNT in a breach". This answers the other
// half an analyst reaches for: "is this PASSWORD in a breach corpus" — without
// ever sending the password anywhere. It uses Have I Been Pwned's Pwned Passwords
// range API, which is free, needs no key, and is built around k-anonymity:
//
//   1. Hash the password with SHA-1, in the browser (SHA-1 is the API's index,
//      not a security choice — the plaintext is what we are protecting).
//   2. Split the 40-hex-char digest into a 5-char PREFIX and a 35-char SUFFIX.
//   3. Send ONLY the prefix to the range endpoint (relayed through this tool's
//      own server). The endpoint returns every suffix it holds under that prefix
//      — a few hundred to a thousand candidates — with a breach count each.
//   4. Match the suffix LOCALLY. The count for a match is the real exposure; a
//      miss is a true zero.
//
// So the password and its full hash never leave the tab; the only thing that
// transits is a 5-hex prefix that maps to hundreds of possible passwords, which
// is the whole point of the design. This module is the pure half — the hashing,
// the split, the range parsing and the orchestration — with the one network hop
// injected, so every branch is exercised offline in the tests.

import { utf8Encode, bytesToHex } from "./cryptoLab";

/** SHA-1 digests are 40 hex chars; the range API keys on the first 5. */
export const PREFIX_LEN = 5;
export const HASH_LEN = 40;

/**
 * SHA-1 of the UTF-8 text, uppercase hex. Uppercase because the range API emits
 * its suffixes uppercase, and matching is a plain string compare.
 */
export async function sha1HexUpper(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", utf8Encode(text));
  return bytesToHex(new Uint8Array(buf)).toUpperCase();
}

/**
 * Normalise a candidate range prefix to the exact shape the endpoint accepts:
 * five uppercase hex characters. Returns null for anything else, so a caller can
 * reject it before it ever reaches the network. This is the guard that keeps the
 * relay from being turned into an open proxy: only a 5-hex prefix gets through.
 */
export function normalizePrefix(raw: string): string | null {
  const p = raw.trim().toUpperCase();
  return /^[0-9A-F]{5}$/.test(p) ? p : null;
}

export interface HashSplit {
  prefix: string;
  suffix: string;
}

/** Split an uppercase SHA-1 into its range prefix and suffix. Throws on junk. */
export function splitSha1(sha1Upper: string): HashSplit {
  if (!/^[0-9A-F]{40}$/.test(sha1Upper)) throw new Error("Expected a 40-character SHA-1 digest.");
  return { prefix: sha1Upper.slice(0, PREFIX_LEN), suffix: sha1Upper.slice(PREFIX_LEN) };
}

/**
 * Read the breach count for one suffix out of a range response.
 *
 * The body is one `SUFFIX:COUNT` per line (CRLF from the API, tolerant of LF).
 * With padding enabled the API mixes in decoy suffixes at count 0, so a match on
 * a zero-count line means "not actually seen" — the same as no line at all. Any
 * line without a valid `:count` is ignored rather than trusted.
 */
export function parseRangeCount(rangeText: string, suffixUpper: string): number {
  const want = suffixUpper.toUpperCase();
  for (const line of rangeText.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    if (line.slice(0, colon).trim().toUpperCase() !== want) continue;
    const count = Number(line.slice(colon + 1).trim());
    return Number.isFinite(count) && count > 0 ? count : 0;
  }
  return 0;
}

/**
 * Fetch the suffix list for a prefix. Injected into the orchestrator so tests
 * never touch the network; the default hop goes through this tool's own relay
 * (`/api/pwned-password`), which forwards the prefix to Pwned Passwords with the
 * server's identity, not the browser's.
 */
export type RangeFetcher = (prefix: string) => Promise<string>;

export async function defaultRangeFetcher(prefix: string): Promise<string> {
  const res = await fetch("/api/pwned-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prefix }),
  });
  if (!res.ok) {
    // Surface the relay's own reason when it sent one, else a generic message.
    let reason = `The check service returned HTTP ${res.status}.`;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body.error === "string" && body.error) reason = body.error;
    } catch {
      /* non-JSON body — keep the generic reason */
    }
    throw new Error(reason);
  }
  const body = (await res.json()) as { range?: unknown };
  if (typeof body.range !== "string") throw new Error("The check service returned an unexpected response.");
  return body.range;
}

export type PwnedCheck =
  | { ok: true; count: number }
  | { ok: false; error: string };

/**
 * The whole flow for one password: hash locally, split, fetch the range, match
 * the suffix. Never throws — a network or service failure comes back as a typed
 * error the UI shows inline, and is never conflated with a clean "not found".
 */
export async function checkPasswordPwned(
  password: string,
  fetcher: RangeFetcher = defaultRangeFetcher,
): Promise<PwnedCheck> {
  if (!password) return { ok: false, error: "Enter a password to check." };
  try {
    const { prefix, suffix } = splitSha1(await sha1HexUpper(password));
    const range = await fetcher(prefix);
    return { ok: true, count: parseRangeCount(range, suffix) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "The password check failed." };
  }
}
