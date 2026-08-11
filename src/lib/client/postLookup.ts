// ── The client half of every lookup ──────────────────────────────────────────
//
// All five modes used to inline the same seven lines, and all five carried the
// same two faults:
//
//   const json = await res.json();          // ← throws on a non-JSON body
//   if (!res.ok) setErr(json.error ?? …);
//   …
//   catch { setErr("Couldn't reach the server. Check your connection…") }
//
//   1. `res.json()` ran BEFORE `res.ok` was checked. A 500 whose body is an
//      HTML error page, a 502 from a reverse proxy, or any empty body throws
//      inside the try — so the catch fires and the user is told to check their
//      internet connection. Their connection is fine; the server answered. The
//      one message that sends someone to reboot their router was the message
//      shown when the fault was ours.
//
//   2. A 429 was rendered as its raw sentence, which mentions the environment
//      variable that sets the limit. Correct, and useless to someone who just
//      wants to know that waiting will fix it.
//
// So: read the body as text first, then decide. The distinction this preserves
// is the one the user acts on — "the network is down" and "the server failed"
// need different responses from them.

export type LookupOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/** Shape every route uses for an error body. */
interface ApiError {
  error?: string;
  retryAfter?: number;
}

/**
 * Turn a failed response into one sentence a person can act on.
 *
 * Prefers the server's own message — the routes write good ones ("Invalid or
 * unparseable phone number") and they say more than a status code can.
 */
function describe(status: number, body: ApiError | null, retryAfterHeader: string | null): string {
  if (status === 429) {
    // The route's own text names RATE_LIMIT_MAX, which is the operator's
    // concern, not the analyst's. What they need is the number of seconds.
    // No `?? 0` tail: Number(null) is 0, not nullish, so it would be dead code.
    const secs = body?.retryAfter ?? Number(retryAfterHeader);
    return Number.isFinite(secs) && secs > 0
      ? `Too many lookups in a row. Try again in ${secs}s.`
      : "Too many lookups in a row. Try again shortly.";
  }
  if (body?.error) return body.error;
  if (status >= 500) return `The server failed to complete the lookup (HTTP ${status}).`;
  return `The request was rejected (HTTP ${status}).`;
}

/**
 * POST a lookup and return either the parsed result or a sentence explaining
 * why there isn't one. Never throws.
 */
export async function postLookup<T>(url: string, body: unknown): Promise<LookupOutcome<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // The only branch that is genuinely about the user's connection.
    return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
  }

  // Text first: a body that is not JSON must not be able to throw us into a
  // handler that blames the network.
  const text = await res.text().catch(() => "");
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }

  if (!res.ok) {
    return { ok: false, error: describe(res.status, parsed as ApiError | null, res.headers.get("retry-after")) };
  }
  if (parsed === null) {
    return { ok: false, error: "The server returned a malformed response." };
  }
  return { ok: true, data: parsed as T };
}
