import { NextRequest, NextResponse } from "next/server";

// ── CSRF guard + optional auth gate (Next 16 `proxy` convention) ─────────────
// This is the file formerly known as `middleware.ts`; Next 16 renamed the
// convention to `proxy.ts` with a `proxy()` export (same request-interception
// semantics, same `config.matcher`).
//
// The auth gate is DISABLED by default (self-hosted single-user). Set
// AUTH_PASSWORD (and optionally AUTH_USER, default "analyst") to require HTTP
// Basic auth on the whole app + API. /api/health is left open for probes.
//
// The CSRF guard is ALWAYS on: it rejects cross-site state-changing requests so
// a malicious page in the user's browser can't POST to localhost (e.g. set an
// API key or modify cases). Same-origin app calls and non-browser clients
// (curl, server-to-server) are unaffected.

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|api/health).*)"],
};

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const MAX_BODY_BYTES = 512 * 1024; // 512 KB — far above any legitimate request

// A state-changing request is "cross-site" when the browser says so via
// Sec-Fetch-Site, or (older browsers) when the Origin host ≠ the request host.
// No Origin header at all ⇒ a non-browser client (curl) ⇒ not a CSRF vector.
function isCrossSiteWrite(req: NextRequest): boolean {
  if (!UNSAFE_METHODS.has(req.method)) return false;
  const site = req.headers.get("sec-fetch-site");
  if (site) return site === "cross-site";
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).host !== req.headers.get("host"); }
  catch { return true; }
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export function proxy(req: NextRequest): NextResponse {
  if (isCrossSiteWrite(req)) {
    return NextResponse.json({ error: "Cross-site request blocked" }, { status: 403 });
  }

  // Best-effort body-size cap (defense-in-depth against memory-exhaustion DoS).
  // Field-level limits still apply after parsing; this just rejects obviously
  // oversized payloads before the body is buffered.
  if (UNSAFE_METHODS.has(req.method)) {
    const len = Number(req.headers.get("content-length") || 0);
    if (len > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Request body too large" }, { status: 413 });
    }
  }

  const pass = process.env.AUTH_PASSWORD;
  if (!pass) return NextResponse.next(); // auth disabled → no behaviour change

  const user = process.env.AUTH_USER || "analyst";
  const header = req.headers.get("authorization") || "";
  if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const idx = decoded.indexOf(":");
      if (idx !== -1) {
        const u = decoded.slice(0, idx);
        const p = decoded.slice(idx + 1);
        if (safeEqual(u, user) && safeEqual(p, pass)) return NextResponse.next();
      }
    } catch { /* malformed header → fall through to 401 */ }
  }
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="HEAVEN-GeoIntel", charset="UTF-8"' },
  });
}
