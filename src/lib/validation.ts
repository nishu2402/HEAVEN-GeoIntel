import { z } from "zod";

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
