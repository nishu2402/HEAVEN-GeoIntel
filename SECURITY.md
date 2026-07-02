# Security Policy

## Supported versions

| Version | Supported          |
| ------- | ------------------ |
| 1.3.x   | :white_check_mark: |
| < 1.3   | :x:                |

## Reporting a vulnerability

If you believe you have found a security vulnerability in HEAVEN-GeoIntel,
please report it privately so it can be fixed before public disclosure.

**Preferred channel:** open a [GitHub Security Advisory](https://github.com/nishu2402/HEAVEN-GeoIntel/security/advisories/new)
on this repository. GitHub will keep the report private until a fix is ready.

**Email fallback:** if GitHub is unavailable to you, email the maintainers at
the address listed on the [project's GitHub profile](https://github.com/nishu2402).
Please prefix the subject with `[SECURITY]`.

When reporting, include:

1. A clear description of the issue and the impact.
2. Steps to reproduce — the smallest possible PoC.
3. The version / commit SHA you tested against.
4. Your suggested fix, if you have one.

You should receive an acknowledgement within **72 hours**. If the issue is
confirmed, we aim to ship a fix within **14 days** for critical issues and
**30 days** for lower-severity issues.

## Scope

In scope:

- The Next.js application itself (`src/app/`, `src/components/`, `src/lib/`).
- The Docker image (`Dockerfile`, `docker-compose.yml`).
- The API routes: `/api/lookup`, `/api/email-lookup`, `/api/username-lookup`,
  `/api/ip-lookup`, `/api/domain-lookup`, `/api/bulk-lookup`, `/api/cases`,
  `/api/keys`, `/api/sources`, `/api/docs`.

Out of scope (please report these to the upstream maintainers):

- Vulnerabilities in upstream npm packages (use `npm audit` / Dependabot).
- Issues with third-party OSINT services we link out to (Truecaller, Hudson
  Rock, etc.). Report to those services directly.

## Hardening notes (deployment)

- **Input validation**: every lookup route validates its input before any
  outbound request — phone via libphonenumber, IP via IPv4/IPv6 regex, domain
  via a strict label regex, username via `[A-Za-z0-9._-]{2,40}`. User input is
  only ever interpolated (URL-encoded) into **fixed** third-party hosts, so the
  routes are not an SSRF vector — a caller cannot choose which host the server
  connects to.
- **CSRF protection**: the proxy middleware (`src/proxy.ts`) rejects cross-site
  state-changing requests
  (POST/PUT/PATCH/DELETE) using `Sec-Fetch-Site` with an `Origin`-vs-`Host`
  fallback, so a malicious page in the user's browser can't drive `/api/keys` or
  `/api/cases`. Same-origin app calls and non-browser clients (curl) are
  unaffected; reads (GET) are not blocked (and have no `Access-Control-Allow-Origin`).
- **Request-body cap**: state-changing API requests over 512 KB are rejected
  (HTTP 413) before the body is buffered — defense-in-depth against memory DoS.
- **Content-Security-Policy**: production `script-src` is `'self' 'unsafe-inline'`
  — `'unsafe-eval'` is dev-only (HMR); the production bundle uses no `eval()` /
  `new Function()`. Plus `object-src 'none'`, `frame-ancestors 'none'`,
  `base-uri 'self'`, `form-action 'self'`.
- **Rendered-link safety (no `javascript:` hrefs)**: results include URLs that a
  *target* can control (a Gravatar profile/linked-account URL, a FullContact
  "social profile" URL). React does not block `javascript:`/`data:` URLs in an
  `href`, and CSP keeps `script-src 'unsafe-inline'` for the anti-flash theme
  script, so such a URL would be click-to-XSS on our own origin. Every
  remote-supplied `href` is therefore passed through `safeExternalUrl()`
  (`src/lib/utils.ts`), which admits only absolute `http(s)` URLs and renders
  anything else inert. Text is React-escaped; HTML/CSV exports are entity-escaped
  and CSV-formula-guarded.
- **Minimal probe disclosure**: `/api/health` stays reachable even with the auth
  gate on (for liveness probes) and deliberately reports no runtime/interpreter
  version — only status, app version, uptime, and whether the auth gate is set.
- **No secrets in the client bundle**: all API keys are read from
  `process.env` inside server route handlers only. Verify with
  `grep -r "process.env" .next/static/` (returns nothing).
- **Rate limiting**: lookup routes are capped at 10 requests/min/IP.
- **Persistent cases** (`/api/cases`, file-backed at `.data/cases.json`) are
  **unauthenticated** — the tool assumes a trusted, single-user / self-hosted
  deployment. If you expose the app publicly, put an auth proxy
  (e.g. Cloudflare Access, basic-auth nginx) in front of it, or disable the
  cases route. The store performs no path interpolation from user input, so it
  is not a path-traversal vector.
- **In-app API keys** (`/api/keys`, file-backed at `.data/keys.json`): optional
  provider keys added from the UI are stored server-side with mode `0600`,
  git-ignored, behind an **allow-listed** name set (the endpoint cannot write
  arbitrary values). Keys are **never returned to the browser** — `/api/keys` and
  `/api/sources` expose only a configured/source flag, never the value. Values
  are stored in plaintext (same trust level as `.env.local`), so on a shared or
  exposed deployment set `AUTH_PASSWORD` (or an auth proxy) so the key endpoints
  aren't world-reachable.

## Known dependency advisories

We track `npm audit` and keep the framework on the latest stable (Next.js 16).
**Current status: `npm audit` reports 0 vulnerabilities.**

Two advisories were resolved and are documented here for the record:

- **`postcss` `</style>` XSS** (GHSA-qx2v-qp2m-jg93) — Next pins an older
  `postcss@8.4.31` as a nested dependency. We pin it forward to the patched
  `8.5.x` line with an npm `overrides` entry (`"postcss": "$postcss"`), which
  dedupes it to the already-patched top-level copy. Build-time only; the app
  never stringifies untrusted CSS.
- **`esbuild` / `vitest` dev-server advisory** — cleared by upgrading the test
  runner to `vitest@4`. Dev-only; never shipped to production.

Run `npm audit` (or `npm audit --omit=dev` for the production-only picture) to
confirm.

## Known limitations (accepted risk)

- **Two free-tier upstreams are HTTP-only.** NumVerify (`apilayer.net`) and
  `ip-api.com` serve HTTPS only on their **paid** plans; their free tiers are
  plain HTTP. That means, on the free tier, the NumVerify request carries your
  `access_key` in the query string in **cleartext**, and the ip-api request
  carries the looked-up IP in cleartext, on the wire between the server and the
  provider. All other providers (IPQualityScore, Twilio, AbstractAPI, Hunter,
  FullContact, RapidAPI, Gravatar, XposedOrNot, Hudson Rock, RDAP, crt.sh,
  Cloudflare DoH) use HTTPS. For sensitive work, use a paid HTTPS plan for those
  two providers or simply don't configure them. This is a provider constraint,
  not something the app can fix without breaking free-tier users.
- **Provider error strings** shown per-source in the UI are normalised to a small
  set of safe reasons (`timed out`, `aborted`, `request failed`, `NOT_CONFIGURED`,
  `RATE_LIMITED`, `NOT_FOUND`, `HTTP <code>`) — raw exception text is never
  returned to the browser.

## Coordinated disclosure

We follow a 90-day coordinated-disclosure timeline. If a vulnerability cannot
be remediated within 90 days, the reporter and the maintainers will agree on
an extended deadline before any public details are shared.
