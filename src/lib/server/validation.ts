import { z } from "zod";
import { isIP } from "node:net";
import { DEFAULT_MAX_BODY_BYTES } from "./bodyLimits";

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
/**
 * Bulk accepts `items` (any identifier, any mode) and still accepts the original
 * phone-only `numbers` array, so an existing script keeps working. One of the
 * two must be present; the route says which when neither is.
 */
export const bulkBody = z.object({
  items: z.array(z.string().max(256)).min(1).max(1000).optional(),
  mode: z.enum(["auto", "phone", "email", "username", "ip", "domain", "wallet", "hash"]).optional(),
  numbers: z.array(z.string().max(40)).min(1).max(1000).optional(),
});
export const walletBody = z.object({ address: z.string().min(1).max(120) });
export const hashBody = z.object({ hash: z.string().min(1).max(80) });
// The deep username sweep is paged: the client walks `offset` through the
// catalog so progress is visible and the sweep can be stopped part-way.
export const sweepBody = z.object({
  username: z.string().min(1).max(64),
  offset: z.number().int().min(0).max(5000).optional(),
  limit: z.number().int().min(1).max(80).optional(),
  /**
   * Also probe the sites whose detection markers failed the last validation
   * run. Off by default: they mostly cannot be classified from a server-side
   * probe at all, so they would fill the result with "unknown".
   */
  includeUnvalidated: z.boolean().optional(),
});
// Evidence capture carries a whole lookup response, so its bound is generous;
// the store applies the real byte cap after serialising.
export const evidenceBody = z.object({
  action: z.enum(["capture", "verify"]),
  caseId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  mode: z.string().max(32).optional(),
  identifier: z.string().max(512).optional(),
  note: z.string().max(2000).optional(),
  payload: z.unknown().optional(),
});
// The typosquat scan resolves generated look-alikes of one domain. `limit` caps
// how many candidates are resolved, so a caller can trade coverage for speed.
export const typosquatBody = z.object({
  domain: z.string().min(1).max(253),
  limit: z.number().int().min(1).max(300).optional(),
});
// Only ever a SHA-1 range prefix (five hex chars). Bounded tight on purpose: the
// route relays this straight to Pwned Passwords, so nothing password-shaped or
// hash-length should be accepted here. The exact 5-hex check runs after parsing.
export const pwnedPrefixBody = z.object({ prefix: z.string().min(1).max(16) });

// The AI-analyst relay carries a provider choice, a model name, and the two
// grounded prompt halves the client built from the on-screen analysis. It may
// also carry an optional bring-your-own key for a cloud provider, entered in the
// panel: it is used for this one request only and never stored or logged. All of
// it is bounded so an oversized body is rejected before it is relayed anywhere.
export const aiAnalystBody = z.object({
  provider: z.enum(["ollama", "openai", "anthropic", "gemini", "groq", "deepseek", "mistral", "openrouter"]),
  model: z.string().min(1).max(100),
  system: z.string().min(1).max(20000),
  user: z.string().min(1).max(20000),
  apiKey: z.string().max(500).optional(),
});

// ── Rejections that say what is wrong ────────────────────────────────────────
//
// Every 400 from a lookup route used to read `{"error":"Invalid request body"}`
// and nothing else. Posting `{"phone":"+12024561111"}` to the phone endpoint —
// whose field is `number` — got that, and the caller had no way to tell a
// misspelled field from a rejected value. So a rejection now names the field and
// says what it expected, which is the difference between a usable API and one
// you debug by reading the source.

export interface BodyProblem {
  /** Human-readable, safe to show: names the field and what was wrong with it. */
  error: string;
  /** Dotted path of the offending field, absent when the whole body is wrong. */
  field?: string;
}

export type ParsedBody<T> =
  | { ok: true; data: T }
  /** `status` is the code the route should answer with; it defaults to 400. */
  | { ok: false; problem: BodyProblem; status?: 413 };

/** A body that was read within its limit, or the reason it was not. */
export type CappedBody =
  | { ok: true; json: unknown }
  | { ok: false; tooLarge: boolean };

/**
 * Read and parse a JSON body, refusing at `limit` bytes.
 *
 * The bytes are counted as they arrive, which is the only check a client cannot
 * opt out of — see bodyLimits.ts for what a chunked request does to the
 * Content-Length check upstream.
 *
 * A request with no `body` stream falls back to the runtime's own `json()`:
 * that is a request that carried no body at all, and it is also the shape the
 * suites build, where there is no stream to meter and nothing to protect.
 */
export async function readJsonCapped(req: Request, limit: number): Promise<CappedBody> {
  if (!req.body) {
    try { return { ok: true, json: await req.json() }; }
    catch { return { ok: false, tooLarge: false }; }
  }
  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) return { ok: false, tooLarge: true };
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch {
    return { ok: false, tooLarge: false }; // a body that died mid-flight is not a body
  } finally {
    void reader.cancel().catch(() => {});
  }
  try { return { ok: true, json: JSON.parse(text) }; }
  catch { return { ok: false, tooLarge: false }; }
}

/** The value at a zod issue path inside the raw body, or undefined. */
function valueAt(body: unknown, path: readonly PropertyKey[]): unknown {
  let cur: unknown = body;
  for (const key of path) {
    /* v8 ignore next -- zod only reports a path it could actually walk, so a
       primitive mid-path is unreachable from a schema violation. */
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<PropertyKey, unknown>)[key];
  }
  return cur;
}

/** What was wrong with one field, phrased for the caller rather than for zod. */
function describeIssue(issue: z.core.$ZodIssue, body: unknown): string {
  switch (issue.code) {
    case "invalid_type":
      return valueAt(body, issue.path) === undefined
        ? "is required"
        : `must be a ${issue.expected}`;
    case "too_small":
      return issue.origin === "array"
        /* v8 ignore next -- every array schema here has a minimum of one, so
           the plural arm is unreachable until one does not. */
        ? `needs at least ${issue.minimum} ${issue.minimum === 1 ? "entry" : "entries"}`
        : `must be at least ${issue.minimum} characters`;
    case "too_big":
      return issue.origin === "array"
        ? `accepts at most ${issue.maximum} entries`
        : `must be at most ${issue.maximum} characters`;
    case "invalid_value":
      return `must be one of: ${issue.values.map(String).join(", ")}`;
    /* v8 ignore next 2 -- every schema here yields one of the codes above; this
       keeps a future schema from reporting nothing at all. */
    default:
      return issue.message;
  }
}

/**
 * Parse a Request body against a schema. Never throws: an oversized body,
 * malformed JSON and a schema violation all come back as
 * `{ ok: false, problem }`, ready to be the response body. `status` says when
 * that response should be a 413 rather than the usual 400.
 */
export async function parseBody<T>(
  req: Request,
  schema: z.ZodType<T>,
  limit: number = DEFAULT_MAX_BODY_BYTES,
): Promise<ParsedBody<T>> {
  const read = await readJsonCapped(req, limit);
  if (!read.ok) {
    return read.tooLarge
      ? { ok: false, problem: { error: "Request body too large" }, status: 413 }
      : { ok: false, problem: { error: "Request body must be valid JSON" } };
  }
  const json = read.json;
  const r = schema.safeParse(json);
  if (r.success) return { ok: true, data: r.data };

  const issue = r.error.issues[0] as z.core.$ZodIssue;
  const field = issue.path.map(String).join(".");
  const what = describeIssue(issue, json);
  return field
    ? { ok: false, problem: { error: `Invalid request body: \`${field}\` ${what}`, field } }
    : { ok: false, problem: { error: `Invalid request body: the body ${what}` } };
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
