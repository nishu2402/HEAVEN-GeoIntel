// ── Pwned Passwords range relay ──────────────────────────────────────────────
//
// The browser computes a password's SHA-1 and sends only the 5-char prefix; this
// forwards that prefix to Have I Been Pwned's Pwned Passwords range endpoint and
// returns the raw suffix list for the browser to match locally. Two reasons the
// hop is server-side rather than a direct browser call:
//   • the range endpoint then sees this server's identity, not the analyst's IP;
//   • it goes through the same timeout + User-Agent discipline as every other
//     upstream, so a slow endpoint can never hang the tab.
//
// It is keyless. `Add-Padding: true` asks the endpoint to pad every response with
// decoy suffixes at count 0, so the size of the reply reveals nothing about the
// prefix — the parser on the client treats a padded zero exactly like an absence.
//
// Accuracy discipline: only a real suffix list is returned as ok. A 429 or any
// other non-2xx is an explicit failure, never an empty list that would read as
// "this password is clean".

import { describeError } from "./fetchSafe";
import { fetchTimeoutMs } from "./config";
import { USER_AGENT } from "../version";
import { normalizePrefix } from "../analysis/pwnedPasswords";

const ENDPOINT = "https://api.pwnedpasswords.com/range";

export type RangeResult =
  | { ok: true; range: string }
  | { ok: false; error: string };

export async function fetchPwnedRange(prefix: string): Promise<RangeResult> {
  // Defence in depth: the route validates too, but this module is the thing that
  // actually reaches the network, so it refuses to send anything but a 5-hex
  // prefix. That is what stops it being usable as a general-purpose relay.
  const clean = normalizePrefix(prefix);
  if (!clean) return { ok: false, error: "BAD_PREFIX" };

  try {
    const res = await fetch(`${ENDPOINT}/${clean}`, {
      headers: { "User-Agent": USER_AGENT, "Add-Padding": "true", Accept: "text/plain" },
      signal: AbortSignal.timeout(fetchTimeoutMs()),
      next: { revalidate: 0 },
    });
    if (res.status === 429) return { ok: false, error: "RATE_LIMITED" };
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, range: await res.text() };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}
