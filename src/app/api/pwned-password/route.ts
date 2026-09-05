import { NextRequest, NextResponse } from "next/server";
import { guardRateLimit } from "@/lib/server/rateLimit";
import { audit } from "@/lib/server/auditLog";
import { parseBody, pwnedPrefixBody } from "@/lib/server/validation";
import { fetchPwnedRange } from "@/lib/server/pwnedRange";
import { normalizePrefix } from "@/lib/analysis/pwnedPasswords";

// ── Pwned Passwords range relay — keyless, k-anonymity ────────────────────────
// The browser hashes the password locally and posts only the first 5 hex chars
// of the SHA-1. This forwards that prefix to Have I Been Pwned's range endpoint
// and returns the raw suffix list; the browser matches the suffix itself. The
// password and its full hash never reach this server — only the prefix, which
// maps to hundreds of candidates, so no single password is identifiable here.
// What we audit is that same prefix: never a password, never PII.

// Map the relay's internal reason to a user-safe message. The prefix is already
// validated above, so BAD_PREFIX never reaches here: a rate limit and an
// unreachable endpoint are the only failures the analyst can actually hit.
function relayError(code: string): string {
  if (code === "RATE_LIMITED") return "Pwned Passwords is rate-limiting requests right now. Try again shortly.";
  return "The Pwned Passwords range service was unreachable.";
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rl = guardRateLimit(req);
  if (rl.limited) return rl.limited;
  const rlHeaders = rl.headers;
  const client = rl.client;

  const body = await parseBody(req, pwnedPrefixBody);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const prefix = normalizePrefix(body.prefix);
  if (!prefix) {
    return NextResponse.json({ error: "The prefix must be exactly five hex characters." }, { status: 400 });
  }
  void audit("pwned-password", prefix, client, 200);

  const r = await fetchPwnedRange(prefix);
  if (!r.ok) {
    return NextResponse.json({ error: relayError(r.error) }, { status: 502, headers: rlHeaders });
  }
  return NextResponse.json({ range: r.range }, { headers: rlHeaders });
}
