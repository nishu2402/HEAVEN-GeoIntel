import { z } from "zod";
import { isIP } from "node:net";

// ── Request-body schemas (defense in depth) ──────────────────────────────────
// These enforce SHAPE + sane length bounds before any work happens, so a
// malformed or oversized body (e.g. a multi-megabyte "username") is rejected
// cheaply. Domain-specific validation (libphonenumber, IP/domain regex, the
// username charset, …) still runs afterwards in each route.

export const phoneBody = z.object({ number: z.string().min(1).max(32) });
export const emailBody = z.object({ email: z.string().min(3).max(254) });
export const usernameBody = z.object({ username: z.string().min(1).max(64) });
export const ipBody = z.object({ ip: z.string().min(1).max(64) });
export const domainBody = z.object({ domain: z.string().min(1).max(253) });
export const bulkBody = z.object({ numbers: z.array(z.string().max(40)).min(1).max(25) });
export const walletBody = z.object({ address: z.string().min(1).max(120) });
export const hashBody = z.object({ hash: z.string().min(1).max(80) });

/**
 * Parse a Request body against a schema. Returns the typed data or null — the
 * caller turns null into a 400. Never throws (bad JSON → null).
 */
export async function parseBody<T>(req: Request, schema: z.ZodType<T>): Promise<T | null> {
  let json: unknown;
  try { json = await req.json(); } catch { return null; }
  const r = schema.safeParse(json);
  return r.success ? r.data : null;
}

// ── IP validation ────────────────────────────────────────────────────────────
// Node's built-in resolver is fully RFC-correct — it accepts compressed IPv6
// (hex groups on BOTH sides of "::", e.g. 2606:4700:4700::1111) that a naive
// regex misses, and rejects malformed input. Returns 4, 6, or 0.

/** 4 for IPv4, 6 for IPv6, 0 for neither. */
export function ipVersion(ip: string): 0 | 4 | 6 {
  return isIP(ip) as 0 | 4 | 6;
}

/** True for any valid IPv4 or IPv6 literal. */
export function isValidIp(ip: string): boolean {
  return isIP(ip) !== 0;
}
