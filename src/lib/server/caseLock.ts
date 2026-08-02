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

import { createHmac, timingSafeEqual } from "node:crypto";
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
 * Compare a submitted password against the configured one in constant time.
 * Lengths are compared first and differ non-secretly; the MAC over each side
 * removes the remaining length signal from the byte comparison.
 */
export function passwordMatches(submitted: unknown, secret: string): boolean {
  if (typeof submitted !== "string") return false;
  const a = createHmac("sha256", secret).update(submitted).digest();
  const b = createHmac("sha256", secret).update(secret).digest();
  return timingSafeEqual(a, b);
}
