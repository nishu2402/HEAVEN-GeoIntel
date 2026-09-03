// ── HTTP posture: security headers, disclosure leaks, technology fingerprint ──
//
// Everything in this module is a PURE function over a header map and an
// optional HTML prefix. The network half lives in server/httpProbe.ts. Keeping
// the judgement separate from the fetching is what makes the judgement
// testable: the interesting cases here are malformed headers a live site will
// not reliably serve on demand (an HSTS max-age of `0`, a CSP that whitelists
// `unsafe-eval`, a Set-Cookie missing every flag), and those are worth pinning
// down in tests rather than hoping to encounter them.
//
// The project's accuracy rule applies unchanged: a header that is absent is
// reported as absent. Nothing here infers a control from the look of a site.

import type {
  SecurityHeaderCheck, SecurityPosture, TechFingerprint, CookieFinding, HeaderMap,
} from "../types";

/** Case-insensitive read against an already-lower-cased header map. */
function h(headers: HeaderMap, name: string): string | null {
  return headers[name.toLowerCase()] ?? null;
}

/**
 * Decode the character references a <title> actually carries.
 *
 * wordpress.org's title is "Blog Tool, Publishing Platform, and CMS &#8211;
 * WordPress.org", and printing that raw put "&#8211;" on screen where an en
 * dash belongs. Numeric references matter more than named ones here: a CMS
 * emits &#8211; and &#8217; constantly, because that is what its typographic
 * filter produces.
 *
 * Deliberately not a general HTML parser. This decodes text destined for a text
 * node, never markup, so there is nothing to sanitise.
 */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&nbsp;/g, " ")
    .replace(/&(?:quot|#34);/g, '"')
    .replace(/&(?:apos|#39);/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    // Ampersand last: decoding it first would let "&amp;lt;" become "<".
    .replace(/&amp;/g, "&");
}

// ── Security headers ─────────────────────────────────────────────────────────
//
// Weights are deliberately uneven. HSTS and CSP are the two that change what an
// attacker can actually do (strip TLS, land injected script); nosniff and
// frame-ancestors close specific well-known classes; Referrer-Policy and
// Permissions-Policy are hygiene. A site scoring in the 60s therefore has the
// structural controls and is missing the hygiene ones, which is a materially
// different report from the reverse.

const HSTS_STRONG_MAX_AGE = 15768000; // 6 months: the preload list's floor

function checkHsts(headers: HeaderMap): SecurityHeaderCheck {
  const raw = h(headers, "strict-transport-security");
  if (!raw) {
    return {
      name: "Strict-Transport-Security", present: false, value: null, score: 0, max: 20,
      note: "Absent: a first visit over http:// can be intercepted and downgraded",
    };
  }
  const maxAge = Number(raw.match(/max-age\s*=\s*"?(\d+)"?/i)?.[1] ?? "0");
  const subdomains = /includesubdomains/i.test(raw);
  const preload = /preload/i.test(raw);
  if (maxAge === 0) {
    return {
      name: "Strict-Transport-Security", present: true, value: raw, score: 0, max: 20,
      note: "max-age=0 actively switches HSTS OFF: present in name only",
    };
  }
  let score = maxAge >= HSTS_STRONG_MAX_AGE ? 14 : 8;
  if (subdomains) score += 4;
  if (preload) score += 2;
  const parts = [`max-age=${maxAge}`];
  if (subdomains) parts.push("includeSubDomains");
  if (preload) parts.push("preload");
  return {
    name: "Strict-Transport-Security", present: true, value: raw, score, max: 20,
    note: maxAge >= HSTS_STRONG_MAX_AGE
      ? `Enforced (${parts.join(", ")})`
      : `Short max-age (${maxAge}s): under the 6-month preload floor`,
  };
}

function checkCsp(headers: HeaderMap): SecurityHeaderCheck {
  const raw = h(headers, "content-security-policy");
  const reportOnly = h(headers, "content-security-policy-report-only");
  if (!raw) {
    return {
      name: "Content-Security-Policy", present: false, value: reportOnly, score: 0, max: 20,
      note: reportOnly
        ? "Report-Only only: violations are logged but nothing is blocked"
        : "Absent: no restriction on where script may be loaded from",
    };
  }
  const unsafeInline = /'unsafe-inline'/i.test(raw);
  const unsafeEval = /'unsafe-eval'/i.test(raw);
  const wildcard = /(^|[\s;])(default-src|script-src)\s[^;]*\*/i.test(raw);
  let score = 20;
  const weak: string[] = [];
  if (unsafeInline) { score -= 7; weak.push("'unsafe-inline'"); }
  if (unsafeEval)   { score -= 7; weak.push("'unsafe-eval'"); }
  if (wildcard)     { score -= 3; weak.push("wildcard source"); }
  return {
    name: "Content-Security-Policy", present: true, value: raw, score: Math.max(score, 0), max: 20,
    note: weak.length ? `Present but weakened by ${weak.join(" + ")}` : "Present with no obviously weakening source",
  };
}

function checkFraming(headers: HeaderMap): SecurityHeaderCheck {
  const xfo = h(headers, "x-frame-options");
  const csp = h(headers, "content-security-policy") ?? "";
  const frameAncestors = /frame-ancestors/i.test(csp);
  if (frameAncestors) {
    return {
      name: "Frame protection", present: true, value: `CSP frame-ancestors${xfo ? ` (+ X-Frame-Options: ${xfo})` : ""}`,
      score: 15, max: 15, note: "CSP frame-ancestors set: the modern, per-origin control",
    };
  }
  if (!xfo) {
    return {
      name: "Frame protection", present: false, value: null, score: 0, max: 15,
      note: "Neither X-Frame-Options nor CSP frame-ancestors: clickjacking is unmitigated",
    };
  }
  const strong = /^(deny|sameorigin)$/i.test(xfo.trim());
  return {
    name: "Frame protection", present: true, value: xfo, score: strong ? 12 : 6, max: 15,
    note: strong
      ? `X-Frame-Options: ${xfo.trim().toUpperCase()}: works, though frame-ancestors supersedes it`
      : `X-Frame-Options: ${xfo} is not a value browsers still honour (ALLOW-FROM was dropped)`,
  };
}

function checkNosniff(headers: HeaderMap): SecurityHeaderCheck {
  const raw = h(headers, "x-content-type-options");
  const ok = raw?.trim().toLowerCase() === "nosniff";
  return {
    name: "X-Content-Type-Options", present: !!raw, value: raw, score: ok ? 15 : 0, max: 15,
    note: ok ? "nosniff: MIME confusion blocked"
             : raw ? `Set to "${raw}", which is not the only valid value ("nosniff")`
                   : "Absent: the browser may re-interpret a response as script",
  };
}

function checkReferrer(headers: HeaderMap): SecurityHeaderCheck {
  const raw = h(headers, "referrer-policy");
  // `unsafe-url` and `no-referrer-when-downgrade` still leak the full URL to
  // third parties, so presence alone is not worth full marks.
  const leaky = raw ? /unsafe-url|no-referrer-when-downgrade/i.test(raw) : false;
  return {
    name: "Referrer-Policy", present: !!raw, value: raw, score: raw ? (leaky ? 4 : 10) : 0, max: 10,
    note: !raw ? "Absent: full URLs may be sent to third-party origins"
               : leaky ? `"${raw}" still forwards the full URL cross-origin`
                       : `Restricting referrer leakage ("${raw}")`,
  };
}

function checkPermissions(headers: HeaderMap): SecurityHeaderCheck {
  const raw = h(headers, "permissions-policy") ?? h(headers, "feature-policy");
  return {
    name: "Permissions-Policy", present: !!raw, value: raw, score: raw ? 10 : 0, max: 10,
    note: raw ? "Camera/mic/geolocation access is scoped" : "Absent: powerful browser APIs are unrestricted by policy",
  };
}

function checkCoop(headers: HeaderMap): SecurityHeaderCheck {
  const raw = h(headers, "cross-origin-opener-policy");
  const strong = raw ? /same-origin/i.test(raw) : false;
  return {
    name: "Cross-Origin-Opener-Policy", present: !!raw, value: raw, score: strong ? 10 : raw ? 5 : 0, max: 10,
    note: !raw ? "Absent: a cross-origin opener keeps a handle on this window"
               : strong ? `Isolating the browsing context ("${raw}")`
                        : `"${raw}" is weaker than same-origin`,
  };
}

function grade(pct: number): SecurityPosture["grade"] {
  if (pct >= 90) return "A";
  if (pct >= 75) return "B";
  if (pct >= 60) return "C";
  if (pct >= 40) return "D";
  return "F";
}

export function gradeSecurityHeaders(headers: HeaderMap): SecurityPosture {
  const checks = [
    checkHsts(headers), checkCsp(headers), checkFraming(headers), checkNosniff(headers),
    checkReferrer(headers), checkPermissions(headers), checkCoop(headers),
  ];
  const score = checks.reduce((n, c) => n + c.score, 0);
  const max = checks.reduce((n, c) => n + c.max, 0);
  const pct = Math.round((score / max) * 100);
  return { checks, score, max, percent: pct, grade: grade(pct) };
}

// ── Disclosure headers ───────────────────────────────────────────────────────
//
// A pentester cares about these for one reason: a version string turns "some
// nginx" into a CVE search. Only report a version when the header actually
// carries digits, because `Server: nginx` on its own discloses nothing useful
// and flagging it trains the reader to ignore the section.

const DISCLOSURE_HEADERS = [
  "server", "x-powered-by", "x-aspnet-version", "x-aspnetmvc-version",
  "x-generator", "x-drupal-cache", "x-runtime", "x-version", "x-backend-server",
] as const;

export function findDisclosures(headers: HeaderMap): { header: string; value: string; hasVersion: boolean }[] {
  const out: { header: string; value: string; hasVersion: boolean }[] = [];
  for (const name of DISCLOSURE_HEADERS) {
    const v = h(headers, name);
    if (!v) continue;
    out.push({ header: name, value: v, hasVersion: /\d+\.\d+/.test(v) });
  }
  return out;
}

// ── Cookies ──────────────────────────────────────────────────────────────────

/**
 * Flag audit over Set-Cookie.
 *
 * `fetch` folds repeated Set-Cookie headers into one comma-joined string, and a
 * cookie's own Expires attribute contains a comma ("Expires=Wed, 09 Jun 2027").
 * Splitting on every comma therefore shreds a perfectly normal cookie into
 * fragments and reports each as flagless. Splitting only where a comma is
 * followed by `token=` — the start of a new cookie pair — keeps Expires intact.
 */
export function analyzeCookies(setCookie: string | null): CookieFinding[] {
  if (!setCookie) return [];
  return setCookie
    .split(/,(?=\s*[A-Za-z0-9!#$%&'*+.^_`|~-]+=)/)
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => {
      const name = raw.split("=")[0].trim();
      const sameSite = raw.match(/samesite\s*=\s*(\w+)/i)?.[1] ?? null;
      return {
        name,
        secure: /;\s*secure(\s*;|\s*$)/i.test(raw),
        httpOnly: /;\s*httponly(\s*;|\s*$)/i.test(raw),
        sameSite: sameSite ? sameSite.toLowerCase() : null,
      };
    });
}

// ── Technology fingerprint ───────────────────────────────────────────────────
//
// Signals are recorded with the evidence that produced them so the panel can
// show WHY something was detected. A fingerprint with no visible evidence is
// indistinguishable from a guess, and this tool does not guess.

interface Rule { name: string; kind: TechFingerprint["kind"]; test: RegExp; from: string }

const HEADER_RULES: Rule[] = [
  { name: "Cloudflare",     kind: "cdn",       test: /./,                     from: "cf-ray" },
  { name: "Amazon CloudFront", kind: "cdn",    test: /./,                     from: "x-amz-cf-id" },
  { name: "Fastly",         kind: "cdn",       test: /./,                     from: "x-served-by" },
  { name: "Vercel",         kind: "hosting",   test: /./,                     from: "x-vercel-id" },
  { name: "Netlify",        kind: "hosting",   test: /./,                     from: "x-nf-request-id" },
  // "GitHub", not "GitHub Pages": github.com itself sets x-github-request-id, so
  // the narrower label was a false positive on the flagship domain.
  { name: "GitHub",         kind: "hosting",   test: /./,                     from: "x-github-request-id" },
  { name: "Shopify",        kind: "cms",       test: /./,                     from: "x-shopify-stage" },
  { name: "Akamai",         kind: "cdn",       test: /akamai/i,               from: "server" },
  { name: "nginx",          kind: "server",    test: /nginx|openresty/i,      from: "server" },
  { name: "Apache",         kind: "server",    test: /apache/i,               from: "server" },
  { name: "Microsoft IIS",  kind: "server",    test: /microsoft-iis/i,        from: "server" },
  { name: "LiteSpeed",      kind: "server",    test: /litespeed/i,            from: "server" },
  { name: "Caddy",          kind: "server",    test: /caddy/i,                from: "server" },
  { name: "PHP",            kind: "language",  test: /php/i,                  from: "x-powered-by" },
  { name: "ASP.NET",        kind: "framework", test: /asp\.net/i,             from: "x-powered-by" },
  { name: "Express",        kind: "framework", test: /express/i,              from: "x-powered-by" },
  { name: "Next.js",        kind: "framework", test: /next\.js/i,             from: "x-powered-by" },
  { name: "Drupal",         kind: "cms",       test: /./,                     from: "x-drupal-cache" },
  { name: "Ruby on Rails",  kind: "framework", test: /./,                     from: "x-runtime" },
];

const COOKIE_RULES: { name: string; kind: TechFingerprint["kind"]; test: RegExp }[] = [
  { name: "WordPress",   kind: "cms",       test: /wordpress_|wp-settings/i },
  { name: "Laravel",     kind: "framework", test: /laravel_session|XSRF-TOKEN/i },
  { name: "Django",      kind: "framework", test: /csrftoken|django/i },
  { name: "Ruby on Rails", kind: "framework", test: /_rails_session|_session_id/i },
  { name: "Java",        kind: "language",  test: /JSESSIONID/i },
  { name: "ASP.NET",     kind: "framework", test: /ASP\.NET_SessionId/i },
  { name: "PHP",         kind: "language",  test: /PHPSESSID/i },
  { name: "Express",     kind: "framework", test: /connect\.sid/i },
];

const BODY_RULES: { name: string; kind: TechFingerprint["kind"]; test: RegExp; why: string }[] = [
  { name: "WordPress", kind: "cms",       test: /\/wp-content\/|\/wp-includes\//i, why: "/wp-content/ asset path" },
  { name: "Next.js",   kind: "framework", test: /\/_next\/static|__NEXT_DATA__/,   why: "/_next/ build output" },
  { name: "Nuxt",      kind: "framework", test: /__NUXT__|\/_nuxt\//,              why: "__NUXT__ payload" },
  { name: "Angular",   kind: "framework", test: /ng-version=/i,                    why: "ng-version attribute" },
  { name: "React",     kind: "framework", test: /data-reactroot|react(?:-dom)?\.production/i, why: "React root marker" },
  { name: "Vue",       kind: "framework", test: /data-v-[0-9a-f]{8}/i,             why: "scoped-style attribute" },
  { name: "Drupal",    kind: "cms",       test: /Drupal\.settings|\/sites\/default\/files/i, why: "Drupal asset path" },
  { name: "Joomla",    kind: "cms",       test: /\/media\/jui\/|Joomla!/i,         why: "Joomla asset path" },
  { name: "Shopify",   kind: "cms",       test: /cdn\.shopify\.com|Shopify\.theme/i, why: "Shopify CDN reference" },
  { name: "Squarespace", kind: "cms",     test: /squarespace\.com|Static\.SQUARESPACE/i, why: "Squarespace static host" },
  { name: "Wix",       kind: "cms",       test: /wix\.com|wixstatic/i,             why: "Wix static host" },
  { name: "Cloudflare Turnstile", kind: "security", test: /challenges\.cloudflare\.com\/turnstile/i, why: "Turnstile widget" },
  { name: "Google reCAPTCHA", kind: "security", test: /google\.com\/recaptcha/i,   why: "reCAPTCHA widget" },
];

/** Version out of a `Server:`-style value, e.g. `nginx/1.24.0` → `1.24.0`. */
function versionOf(value: string): string | null {
  return value.match(/(\d+\.[\d.]+)/)?.[1] ?? null;
}

export function fingerprintTech(headers: HeaderMap, bodyPrefix: string): TechFingerprint[] {
  const found = new Map<string, TechFingerprint>();
  const add = (t: TechFingerprint) => {
    // First evidence wins, except that a later hit carrying a version upgrades
    // an earlier versionless one — the version is the part a pentester acts on.
    const prev = found.get(t.name);
    if (!prev || (!prev.version && t.version)) found.set(t.name, t);
  };

  for (const r of HEADER_RULES) {
    const v = h(headers, r.from);
    if (v === null || !r.test.test(v)) continue;
    add({ name: r.name, kind: r.kind, version: versionOf(v), evidence: `${r.from}: ${v}` });
  }

  const cookies = h(headers, "set-cookie");
  if (cookies) {
    for (const r of COOKIE_RULES) {
      const m = cookies.match(r.test);
      if (m) add({ name: r.name, kind: r.kind, version: null, evidence: `Set-Cookie contains ${m[0]}` });
    }
  }

  // <meta name="generator"> is the one body signal that names its own version.
  const generator = bodyPrefix.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']/i)?.[1];
  if (generator) {
    add({ name: generator.split(/[\s/]/)[0], kind: "cms", version: versionOf(generator), evidence: `<meta generator> ${generator}` });
  }

  for (const r of BODY_RULES) {
    if (r.test.test(bodyPrefix)) add({ name: r.name, kind: r.kind, version: null, evidence: r.why });
  }

  return Array.from(found.values()).sort((a, b) => a.name.localeCompare(b.name));
}
