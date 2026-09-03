// ── Optional case-store lock ─────────────────────────────────────────────────
//
// `AUTH_PASSWORD` already gates the WHOLE app, which is all-or-nothing. This is
// the narrower control the case store actually warrants: cases are the only
// thing on disk that accumulates investigation targets (PII) and survives
// restarts, so an operator may want the lookup console open on the LAN while
// the case history stays sealed.
//
// Set `CASE_PASSWORD` to enable it. Unset (the default) is a complete no-op —
// nothing changes for an existing install.
//
// Why a cookie rather than HTTP Basic: the cases UI talks to /api/cases with
// fetch(). A 401 from fetch() does NOT make the browser show a credential
// prompt, so a Basic-auth realm here would simply break the panel. Instead the
// panel posts the password once, receives an HttpOnly token cookie, and sends
// it automatically thereafter.
//
// The token is an HMAC over its own expiry, keyed by the password. That means:
//   • no session table to keep (the token verifies itself),
//   • changing CASE_PASSWORD invalidates every outstanding token,
//   • a token cannot be extended by editing it — the expiry is inside the MAC.
// It is NOT a general-purpose auth system: single shared secret, single user.

import { createHmac, timingSafeEqual, scryptSync } from "node:crypto";
import { intFromEnv } from "./config";

export const CASE_TOKEN_COOKIE = "hv_case";

/** The configured case password, or null when the lock is disabled. */
export function casePassword(): string | null {
  const v = process.env.CASE_PASSWORD;
  return v && v.trim() ? v : null;
}

/** How long an unlock lasts, in ms. */
function ttlMs(): number {
  return intFromEnv("CASE_UNLOCK_TTL_MS", 12 * 60 * 60_000, 60_000, 30 * 24 * 60 * 60_000);
}

function sign(expiresAt: number, secret: string): string {
  return createHmac("sha256", secret).update(String(expiresAt)).digest("hex");
}

/** Mint a token valid until `now + ttl`. Format: "<expiresAtMs>.<hmac>". */
export function issueToken(secret: string, now = Date.now()): { token: string; maxAgeSeconds: number } {
  const ttl = ttlMs();
  const expiresAt = now + ttl;
  return {
    token: `${expiresAt}.${sign(expiresAt, secret)}`,
    maxAgeSeconds: Math.floor(ttl / 1000),
  };
}

/** Constant-time compare of two hex strings of equal length. */
function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/** True when `token` is well-formed, correctly signed, and not expired. */
export function verifyToken(token: string | undefined, secret: string, now = Date.now()): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expiresAt = Number(token.slice(0, dot));
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;
  return safeEqualHex(token.slice(dot + 1), sign(expiresAt, secret));
}

/**
 * Derive a slow, memory-hard key from a secret with scrypt.
 *
 * The unlock endpoint compares a submitted password against CASE_PASSWORD, so
 * this is the one place a guesser can burn attempts. A plain SHA-256 (or an
 * HMAC of it) is far too cheap for that job: it lets an attacker try billions
 * of candidates per second. scrypt is deliberately expensive in both CPU and
 * memory, which turns an online brute-force back into something the timeout and
 * rate limiter can actually contain. Node's defaults (N=16384, r=8, p=1) cost
 * ~16 MB and a few tens of milliseconds per call — negligible for a human
 * unlocking once, ruinous for a script guessing.
 *
 * The salt is the configured secret itself. That is safe here because the two
 * sides are derived and compared in-process and the digest is never stored, so
 * there is no rainbow-table surface to defend; sharing the salt just makes the
 * two derivations directly comparable.
 */
function deriveKey(input: string, secret: string): Buffer {
  return scryptSync(input, secret, 32);
}

/**
 * Compare a submitted password against the configured one in constant time.
 * Both sides run through the same slow KDF, so the comparison never sees the
 * raw passwords, the output is always 32 bytes (no length signal), and each
 * attempt carries scrypt's cost.
 */
export function passwordMatches(submitted: unknown, secret: string): boolean {
  if (typeof submitted !== "string") return false;
  const a = deriveKey(submitted, secret);
  const b = deriveKey(secret, secret);
  return timingSafeEqual(a, b);
}
