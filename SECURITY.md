# Security Policy

## Supported versions

| Version | Supported          |
| ------- | ------------------ |
| 3.2.x   | :white_check_mark: |
| 3.1.x   | :white_check_mark: |
| 3.0.x   | :white_check_mark: |
| 2.x     | :x:                |
| 1.3.x   | :x:                |
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
2. Steps to reproduce: the smallest possible PoC.
3. The version / commit SHA you tested against.
4. Your suggested fix, if you have one.

You should receive an acknowledgement within **72 hours**. If the issue is
confirmed, we aim to ship a fix within **14 days** for critical issues and
**30 days** for lower-severity issues.

## Scope

In scope:

- The Next.js application itself (`src/app/`, `src/components/`, `src/lib/`).
- The Docker image (`Dockerfile`, `docker-compose.yml`).
- Every route under `src/app/api/`: 21 of them, 30 operations. The authoritative
  list is the registry in `src/lib/api/endpoints.ts`, which also generates the
  OpenAPI spec served at `/api/docs`, so this section cannot fall behind the code.
  The routes that keep state or reach a third party on your behalf are
  `/api/cases`, `/api/evidence`, `/api/keys`, `/api/datasets` and
  `/api/ai-analyst`.
- The headless CLI (`scripts/cli.mjs`) and the launcher (`scripts/start.sh`).

Out of scope (please report these to the upstream maintainers):

- Vulnerabilities in upstream npm packages (use `npm audit` / Dependabot).
- Issues with third-party OSINT services we link out to (Truecaller, Hudson
  Rock, etc.). Report to those services directly.

## Hardening notes (deployment)

- **Input validation**: every lookup route validates its input before any
  outbound request: phone via libphonenumber, IP via IPv4/IPv6 regex, domain
  via a strict label regex, username via `[A-Za-z0-9._-]{2,40}`. On the
  enrichment routes, user input is only ever interpolated (URL-encoded) into
  **fixed** third-party hosts, so a caller cannot choose which host the server
  connects to.
- **Probes that do connect to a target-controlled host** are the exception, and
  each is guarded: the domain HTTP/TLS probe, the subdomain-takeover check,
  avatar downloads, and the username lookup and deep sweep (hundreds of
  third-party sites, any of which can lapse and be re-registered by someone
  else). Every host they connect to, every redirect hop included, must resolve
  (with the system resolver fetch itself uses) to globally routable addresses
  only, so an address literal, `localhost`, a name such as `instance-data` or
  `metadata.google.internal`, or a public name aimed at 127.0.0.1 is refused
  before anything is fetched. Redirects are followed by hand (at most five hops,
  `http(s)` only), and bodies are read up to a fixed cap. This is a check rather
  than a pinned connection, so a name whose answer changes between the check and
  the connection (an active DNS-rebinding race) can still get through: if the
  tool is exposed to untrusted users, egress-filter the container too.
- **CSRF protection**: the proxy middleware (`src/proxy.ts`) rejects every
  state-changing request (POST/PUT/PATCH/DELETE) that does not come from the
  app's own origin, using `Sec-Fetch-Site` with an `Origin`-vs-`Host` fallback,
  so a malicious page in the user's browser can't drive `/api/keys` or
  `/api/cases`. `same-site` is refused as well: another port on localhost and a
  sibling subdomain both count as the same site. Same-origin app calls and
  non-browser clients (curl) are unaffected; reads (GET) are not blocked (and
  have no `Access-Control-Allow-Origin`).
- **DNS-rebinding protection**: a page that re-points its own domain at your
  machine is same-origin with itself, so it passes any CSRF check and can read
  the answers, including every case in `/api/cases`, and can spend your saved
  keys. What it cannot change is the `Host` header. With no `AUTH_PASSWORD` set,
  the proxy answers **421** to a Host that is not an IP address, `localhost`, a
  bare machine name, a `.local`/`.internal`/`.home.arpa` name, or a name listed
  in `ALLOWED_HOSTS`. Set `ALLOWED_HOSTS` (comma-separated, `*.` for
  subdomains) when you reach the app through a real domain name.
- **Request-body cap**: state-changing API requests over 512 KB are rejected
  (HTTP 413). The two document routes get a 4 MB ceiling instead, because
  `/api/evidence` stores an artifact and `/api/cases` imports a whole case. The
  count is taken on the bytes as they arrive rather than on `Content-Length`,
  which a client can decline to send: a `Transfer-Encoding: chunked` request
  carries no such header, so a cap read off it is no cap at all.
- **Work-admission limits**: some requests are cheap to make and expensive to
  serve, so they are bounded by the work they commit the server to rather than
  by the request count alone. An evidence capture is bounded in shape as well as
  size, at most 64 levels of nesting and 500,000 values. Shape matters because
  the artifact is pretty-printed before it is measured and indentation cost
  grows with nesting depth, so a body inside the 4 MB ceiling can serialise to
  hundreds of megabytes on its way to being refused. Bulk lookups are capped at
  **4 concurrent jobs**, and a fifth gets 429 with `Retry-After`: one job is 500
  rows of twelve-upstream fan-out, while the rate limiter sees only the single
  cheap request that starts it.
- **Audit-log rotation**: the log rolls over at 8 MB and keeps one previous
  generation, both mode `0600`. Rotation is what bounds it: every guarded route
  appends a row and a 500-row bulk job appends 500, so an append-only file with
  no ceiling grows for as long as the server runs.
- **Password-guessing delay**: when `AUTH_PASSWORD` is set, a wrong password is
  held back briefly, doubling to a one-second ceiling. The first few failures
  are free, so mistyping is not punished, and a correct password is never
  delayed. It is a delay rather than a lockout, so nobody can shut you out of
  your own tool by guessing at it. For an internet-exposed deployment, pair it
  with a reverse proxy that also limits connections.
- **Content-Security-Policy**: production `script-src` is `'self' 'unsafe-inline'`;
  `'unsafe-eval'` is dev-only (HMR); the production bundle uses no `eval()` /
  `new Function()`. Plus `object-src 'none'`, `frame-ancestors 'none'`,
  `base-uri 'self'`, `form-action 'self'`.
- **Rendered-link safety (no `javascript:` hrefs)**: results include URLs that a
  *target* can control (a Gravatar profile/linked-account URL, a FullContact
  "social profile" URL). React 19 neutralises a `javascript:` href but passes
  `data:` and every other scheme through, the HTML report exports are not
  rendered by React at all, and CSP keeps `script-src 'unsafe-inline'` for the
  anti-flash theme script, so such a URL could be click-to-XSS on our own
  origin. Every remote-supplied `href` is therefore passed through
  `safeExternalUrl()` (`src/lib/utils.ts`), which admits only absolute `http(s)`
  URLs and renders anything else inert. Text is React-escaped; HTML/CSV exports
  are entity-escaped and CSV-formula-guarded.
- **Minimal probe disclosure**: `/api/health` stays reachable even with the auth
  gate on (for liveness probes) and deliberately reports no runtime/interpreter
  version, only status, app version, uptime, and whether the auth gate is set.
- **No secrets in the client bundle**: all API keys are read from
  `process.env` inside server route handlers only. Verify with
  `grep -r "process.env" .next/static/` (returns nothing).
- **Rate limiting**: lookup routes are capped per client (default 60 requests/min)
  plus a server-wide ceiling (default 600/min); both are env-tunable via
  `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS` and `RATE_LIMIT_GLOBAL_MAX`.
- **Persistent cases** (`/api/cases`, file-backed at `.data/cases.json`) are
  **unauthenticated**. The tool assumes a trusted, single-user / self-hosted
  deployment. If you expose the app publicly, put an auth proxy
  (e.g. Cloudflare Access, basic-auth nginx) in front of it, or disable the
  cases route. The store performs no path interpolation from user input, so it
  is not a path-traversal vector.
- **In-app API keys** (`/api/keys`, file-backed at `.data/keys.json`): optional
  provider keys added from the UI are stored server-side with mode `0600`,
  git-ignored, behind an **allow-listed** name set (the endpoint cannot write
  arbitrary values). Keys are **never returned to the browser**. `/api/keys` and
  `/api/sources` expose only a configured/source flag, never the value. Values
  are stored in plaintext (same trust level as `.env.local`), so on a shared or
  exposed deployment set `AUTH_PASSWORD` (or an auth proxy) so the key endpoints
  aren't world-reachable.

## Known dependency advisories

We track `npm audit` and keep the framework on the latest stable (Next.js 16).
**Current status: `npm audit` reports 0 vulnerabilities.**

`npm audit` resolves the **lockfile**, so it answers "what is in the artifact we
ship" and cannot answer "what could a fresh install of this manifest produce".
Those are different questions, and they have come apart twice here, for
`postcss` and for `next` (both below). `npm run audit:floors` asks the second one: it resolves the
lowest version every declared range admits and checks that against the OSV
advisory database.

Four advisories were resolved and are documented here for the record:

- **`postcss` `</style>` XSS** (GHSA-qx2v-qp2m-jg93): Next pins an older
  `postcss@8.4.31` as a nested dependency. We pin it forward to the patched
  `8.5.x` line with an npm `overrides` entry (`"postcss": "$postcss"`), which
  dedupes it to the already-patched top-level copy. Build-time only; the app
  never stringifies untrusted CSS.
- **`next` unauthenticated RCE, two advisories** ([GHSA-2xp9-vwfh-vxw4](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4),
  RCE in the Image Optimization API when AVIF files are used; and
  [GHSA-p293-qw3h-jr36](https://github.com/advisories/GHSA-p293-qw3h-jr36) /
  CVE-2026-75604, RCE on Windows-hosted servers; both critical, both affecting
  `>=16.0.0 <16.3.3`). Nothing shipped or ran vulnerable: the lockfile has held
  16.3.4 throughout, so `npm ci`, the Docker image and the standalone tarball all
  resolved a patched version and `npm audit` reported zero. The exposure was in
  the manifest: the declared range was `^16.2.12`, which admits 16.2.12 through
  16.3.2, so an install that did not use this lockfile could have taken a version
  with a published exploit. The floor is now `^16.3.4`.
- **`esbuild` / `vitest` dev-server advisory**: cleared by upgrading the test
  runner to `vitest@4`. Dev-only; never shipped to production.
- **`brace-expansion` unbounded-expansion DoS** ([GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg)
  / CVE-2026-14257, high: a crafted brace pattern expands without bound and
  crashes the process out of memory; affects `<1.1.17`). Reached only through
  `eslint` → `minimatch@3`, which pins the 1.x line. 2.0.0 disclosed this chain
  rather than fixing it, because at the time no patched 1.x existed and forcing
  the patched 5.x breaks `minimatch@3`'s API. Upstream has since backported the
  fix onto the 1.x maintenance line, so the lockfile now resolves **1.1.18**,
  inside `minimatch@3`'s own `^1.1.7` range, so no `overrides` entry and no API
  change. Dev tooling only; never bundled into the app, and reachable only via a
  glob pattern the repo owner writes.

Run `npm audit` (or `npm audit --omit=dev` for the production-only picture) to
confirm what is installed, and `npm run audit:floors` to confirm what the
manifest would allow to be installed.

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
  `RATE_LIMITED`, `NOT_FOUND`, `HTTP <code>`). Raw exception text is never
  returned to the browser.

## Coordinated disclosure

We follow a 90-day coordinated-disclosure timeline. If a vulnerability cannot
be remediated within 90 days, the reporter and the maintainers will agree on
an extended deadline before any public details are shared.
