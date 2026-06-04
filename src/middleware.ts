import { NextRequest, NextResponse } from "next/server";

// ── Optional auth gate ───────────────────────────────────────────────────────
// DISABLED by default (self-hosted single-user). Set AUTH_PASSWORD (and
// optionally AUTH_USER, default "analyst") to require HTTP Basic auth on the
// whole app + API — recommended before exposing the tool on a public network.
// /api/health is intentionally left open so container/uptime probes still work.

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|api/health).*)"],
};

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export function middleware(req: NextRequest): NextResponse {
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
