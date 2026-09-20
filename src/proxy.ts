import { NextRequest, NextResponse } from "next/server";
import { CLIENT_ID_COOKIE } from "@/lib/server/rateLimit";
import { maxBodyBytes } from "@/lib/server/bodyLimits";
import { authFailureDelayMs, clearAuthFailures, delay } from "@/lib/server/authThrottle";

// ── CSRF guard + optional auth gate (Next 16 `proxy` convention) ─────────────
// This is the file formerly known as `middleware.ts`; Next 16 renamed the
// convention to `proxy.ts` with a `proxy()` export (same request-interception
// semantics, same `config.matcher`).
//
// The auth gate is DISABLED by default (self-hosted single-user). Set
// AUTH_PASSWORD (and optionally AUTH_USER, default "analyst") to require HTTP
// Basic auth on the whole app + API. /api/health is left open for probes.
//
// The CSRF guard is ALWAYS on: it rejects state-changing requests from any other
// origin so a malicious page in the user's browser can't POST to localhost
// (e.g. set an API key or modify cases). Same-origin app calls and non-browser
// clients (curl, server-to-server) are unaffected.
//
// The host check closes what the CSRF guard cannot see. With DNS rebinding a
// page on attacker.example re-points its own name at 127.0.0.1, and from then on
// its requests to this app are SAME-origin: they pass the CSRF guard and the
// browser lets the page read the answers, so GET /api/cases hands over every
// case file. The one thing such a request cannot fake is the Host header, which
// still names the attacker's domain. So when no password stands in front of the
// app, a Host this deployment was never reached by is refused.

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|api/health).*)"],
};

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// A state-changing request is refused unless it comes from this origin. The
// browser says so via Sec-Fetch-Site, or (older browsers) the Origin host is
// compared with the request host. No Origin header at all ⇒ a non-browser client
// (curl) ⇒ not a CSRF vector.
//
// "same-site" is refused too. The app only ever calls its own origin, and
// same-site is wider than it sounds: every other port on localhost, and every
// sibling subdomain of a hosted deployment, counts as the same site.
function isForeignWrite(req: NextRequest): boolean {
  if (!UNSAFE_METHODS.has(req.method)) return false;
  const site = req.headers.get("sec-fetch-site");
  if (site) return site !== "same-origin" && site !== "none";
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).host !== req.headers.get("host"); }
  catch { return true; }
}

// Names nobody can register in public DNS, so no attacker can rebind them.
const PRIVATE_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

/** The hostname part of a Host header, lower-cased, without port or brackets. */
function hostnameOf(host: string): string {
  const h = host.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(1).split("]")[0]; // [::1]:3000 → ::1
  return h.split(":")[0].replace(/\.$/, "");
}

/** Hostnames the operator has named in ALLOWED_HOSTS, e.g. "osint.example.com,*.ts.net". */
function operatorHosts(): string[] {
  return (process.env.ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase().replace(/\.$/, ""))
    .filter(Boolean);
}

/**
 * Whether a Host header names this deployment rather than someone else's domain.
 *
 * An IP address is always allowed: it is how the LAN reaches the app, and a
 * rebinding attack needs a domain name by definition. So are localhost, a bare
 * machine name (resolved by the local network, not by public DNS), and the
 * reserved private suffixes. Anything else has to be listed in ALLOWED_HOSTS,
 * where a leading "*." matches any subdomain.
 */
export function isOwnHost(host: string | null): boolean {
  if (!host) return true; // every browser sends Host; its absence is not a browser
  const name = hostnameOf(host);
  if (/^[\d.]+$/.test(name) || name.includes(":")) return true; // IPv4 or IPv6 literal
  if (name === "localhost" || !name.includes(".")) return true;
  if (PRIVATE_SUFFIXES.some((s) => name.endsWith(s))) return true;
  return operatorHosts().some((allowed) =>
    allowed.startsWith("*.") ? name.endsWith(allowed.slice(1)) : name === allowed,
  );
}

/**
 * Compare two secrets without short-circuiting.
 *
 * The length check this used to open with returned before the loop ran at all,
 * which is the one difference in this function big enough to be worth measuring:
 * it separates "wrong length" from "right length, wrong characters" in a single
 * request. Folding the lengths into the accumulator instead keeps both cases on
 * the same path, and reading past the end of a string yields NaN, which `| 0`
 * turns into a 0 that still costs an iteration.
 *
 * It is not constant-time in the secret's length — nothing written in JavaScript
 * strings can be — and it does not need to be: the gate below is an optional,
 * single-user, self-hosted lock, and a length is not the secret.
 */
function safeEqual(a: string, b: string): boolean {
  const width = Math.max(a.length, b.length);
  let r = a.length ^ b.length;
  for (let i = 0; i < width; i++) r |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0);
  return r === 0;
}

/**
 * Pass the request through, minting the rate-limit client id if this browser
 * doesn't have one yet.
 *
 * The value is opaque and random — it identifies a BUCKET, not a person. It
 * carries no lookup history, is HttpOnly (invisible to page JS), SameSite=Lax,
 * and is never logged or transmitted off the box. Without it every browser on
 * the LAN shares one bucket and throttles the others.
 */
function passThrough(req: NextRequest): NextResponse {
  const res = NextResponse.next();
  if (!req.cookies.get(CLIENT_ID_COOKIE)) {
    res.cookies.set(CLIENT_ID_COOKIE, crypto.randomUUID().replace(/-/g, ""), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      // The app is served over plain HTTP by default (localhost + LAN). Marking
      // the cookie Secure there would stop it ever being stored, so it is only
      // set when the operator has declared a real TLS deployment.
      secure: process.env.FORCE_HTTPS === "1",
    });
  }
  return res;
}

export async function proxy(req: NextRequest): Promise<NextResponse> {
  if (isForeignWrite(req)) {
    return NextResponse.json({ error: "Cross-site request blocked" }, { status: 403 });
  }

  const pass = process.env.AUTH_PASSWORD;
  // Behind a password a rebound page gets the credential prompt for its own
  // domain and nothing else, so the host check is only needed without one.
  if (!pass && !isOwnHost(req.headers.get("host"))) {
    const name = hostnameOf(req.headers.get("host")!);
    return NextResponse.json(
      {
        error: `Host "${name}" is not allowed. If this is your own address for the app, add it to ALLOWED_HOSTS (or set AUTH_PASSWORD).`,
      },
      { status: 421 },
    );
  }

  // Early-out on an oversized body, so the runtime never buffers one it is only
  // going to throw away. This can only read Content-Length, which a client
  // chooses whether to send, so it is the courtesy check — `parseBody` counts
  // the bytes themselves and is the gate that actually holds. The ceiling is
  // per-route: a flat one rejected every evidence capture over 512 KB, which is
  // an eighth of the artifact the locker says it stores. See bodyLimits.ts.
  if (UNSAFE_METHODS.has(req.method)) {
    const len = Number(req.headers.get("content-length") || 0);
    if (len > maxBodyBytes(req.nextUrl.pathname)) {
      return NextResponse.json({ error: "Request body too large" }, { status: 413 });
    }
  }

  if (!pass) return passThrough(req); // auth disabled → no behaviour change

  const user = process.env.AUTH_USER || "analyst";
  const header = req.headers.get("authorization") || "";
  if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const idx = decoded.indexOf(":");
      if (idx !== -1) {
        const u = decoded.slice(0, idx);
        const p = decoded.slice(idx + 1);
        // Evaluate BOTH comparisons before combining — a plain `&&` short-circuits,
        // so a wrong username would skip the password check and response timing
        // could reveal that the username alone was correct.
        const okUser = safeEqual(u, user);
        const okPass = safeEqual(p, pass);
        if (okUser && okPass) {
          clearAuthFailures();
          return passThrough(req);
        }
      }
    } catch { /* malformed header → fall through to 401 */ }
  }
  // Hold the refusal back for a moment once the guesses start stacking up. The
  // first few cost nothing, so mistyping a password is not punished, and a
  // correct password is never delayed at all. See authThrottle.ts for why this
  // is a delay and not a lockout.
  await delay(authFailureDelayMs());
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="HEAVEN-GeoIntel", charset="UTF-8"' },
  });
}
