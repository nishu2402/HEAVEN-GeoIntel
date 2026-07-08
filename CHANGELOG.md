# Changelog

All notable changes to HEAVEN-GeoIntel will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **The session graph now survives a reload.** The **Session Link Graph** you build
  up as you work is persisted to `localStorage` and re-hydrated on mount, so a page
  refresh (or coming back later in the same browser) keeps the web of identifiers
  instead of resetting to a blank canvas. Persistence is a pure, 100%-covered client
  helper (`lib/client/sessionGraph`) that validates every stored node (kind + non-
  empty value), caps the graph at 200 nodes, and is SSR-safe/best-effort (never
  throws, no hydration mismatch). Graph edits and one-click "clear" persist too.
  Verified live: a `dns.google` lookup's 5-node graph reloaded intact from a bare
  URL with no query string.
- **Case-to-case merge.** From an active case you can now **fold another case into
  it** — its identifiers and notes merge in and the source case is deleted (after a
  confirm). Duplicate identifiers are kept once, with the **earliest sighting**
  (`addedAt` and its note) winning so discovery times are never rewritten; the
  source's notes are appended under a labelled `— Merged from "…" —` divider. The
  merge logic is a pure, 100%-covered helper (`lib/analysis/caseMerge`) wired
  through the file-backed store (`mergeCases`, serialised like every mutation) and a
  new `merge` action on `/api/cases`. Verified end-to-end: merging "Bravo" into
  "Alpha" combined 3 distinct identifiers (shared phone deduped), folded the notes,
  and deleted "Bravo".
- **The session graph now draws itself.** Every lookup seeds the **Session Link
  Graph** with its primary identifier *and* the identifiers the result derived (a
  domain's resolved IPs, an IP's reverse host, an email's domain, a username's
  confirmed profile handles) — reusing the same pure `entityExtract` logic. One
  `dns.google` lookup renders a 5-node graph (domain + 4 A/AAAA IPs) with zero
  manual entry. Verified live.
- **Case timeline.** Each case now shows a **chronological "TIMELINE"** — when it
  was opened and when each identifier was pinned — with per-event timestamps and
  colour-coded kind badges. Pure derivation of the case's existing timestamps
  (`lib/analysis/caseTimeline`, 100% covered); stable-sorted so same-instant pins
  keep their order. Verified live: a 5-identifier case renders 6 ordered events.
- **Phone → in-app pivots on discovered identities.** When FullContact enrichment
  ties a number to real social handles or emails, the phone Identity panel now
  offers one-click **"sweep as username"** / **"look up email"** jumps (gated to
  plausible handles / valid emails, so nothing fabricated), and those identities
  are captured when you pin the phone to a case.
- **Turn a lookup into a linked case in one click.** Every result (phone / email /
  username / IP / domain) carries an **"ADD TO CASE"** control that lazily lists your
  cases and pins the identifier — or creates a case inline and pins to it. Beyond the
  primary identifier, it now offers to pin the result's **derived** identifiers too
  (a domain's resolved IPs, an IP's reverse host, an email's domain, a username's
  confirmed profile handles) via an opt-in "also pin N related" toggle, so a single
  click can seed a case graph with real edges. Extraction is pure and 100%-covered
  (`lib/analysis/entityExtract`); the control is decoupled from the Cases panel (the
  `/api/cases` server is the single source of truth, so nothing drifts). Verified
  end-to-end: one click on a `dns.google` result created a case holding the domain +
  its 4 resolved A/AAAA IPs.
- **Email → username cross-tool pivot.** When an email's local-part is a plausible
  handle (and not a generic role inbox like `info@`), the email result shows a
  one-click **"Sweep '<handle>' as username →"** button that jumps straight into a
  full username sweep. Derivation is a pure, 100%-covered helper
  (`emailToUsernameCandidate`) that strips `+tag` sub-addresses. Verified live:
  `jdorfman@gmail.com` → sweeps `jdorfman`.
- **Rich, API-verified username profiles (GitHub · GitLab · Hacker News · Reddit).**
  The username lookup no longer treats every site as a bare found/notfound probe.
  Four platforms expose a **keyless public JSON API**, so they're now promoted to a
  **"VERIFIED PROFILES"** tier that pulls the account's real data — display name,
  bio, repos/followers/karma, join year, location — rendered as profile cards
  instead of a link chip. This upgrades two previously fragile checks (Hacker News
  moved from HTML scraping to the official Firebase read API; GitLab from a
  reserved-path-prone status check to the users API) and rescues **Reddit** from the
  "manual, can't verify" bucket via `about.json` (a datacenter block just yields no
  profile — never a false claim). All parsing lives in a pure, 100%-covered
  `lib/analysis/usernameProfiles` module.
- **Identity signals synthesis (username).** A new **"IDENTITY SIGNALS"** panel rolls
  the verified profiles up into the distinct **name / location / avatar / bio**
  candidates an analyst wants at a glance, each tagged with the platform it came from
  (case-insensitive dedupe, first-seen wins). Pure derivation — no extra network
  calls, no guessing. Verified live: a handle present on GitHub + GitLab correctly
  collapses to a single "Justin Dorfman · GitHub" name candidate.
- **Username results — quality-of-life.** The header now leads with a **confirmed
  account count** (rich profiles + sweep hits) instead of a single presence %, a
  colour-coded **category tally** summarises the footprint at a glance, and a
  copyable **CLI deep-sweep** block (`sherlock` / `maigret`) hands power users a
  400+-site local sweep. Profile links/avatars run through `safeExternalUrl`.
- **Cross-case entity correlation.** The Cases panel now surfaces a **"CROSS-CASE
  LINKS"** section listing every identifier that appears in more than one
  investigation — the "have I seen this before?" signal that turns a pile of cases
  into an investigation graph. Each row shows the identifier, how many cases it
  spans, and clickable chips that jump straight to those cases. Matching is
  kind-aware and case-insensitive (a value counts each case once), and it's a pure
  offline derivation of the case store (`lib/analysis/caseCorrelation`, fully
  tested, 100% covered). Verified end-to-end: a phone shared by two cases renders
  with both case chips.
- **Offline IP scope classification (IANA special-purpose registries).** A new
  `lib/analysis/ipClassify` classifies any IPv4/IPv6 against the IANA
  special-purpose address registries — **private (RFC 1918), loopback, CGNAT
  (RFC 6598), link-local, documentation (TEST-NET), benchmarking, multicast,
  reserved, IPv6 ULA/link-local, …** — with zero APIs (pure RFC ranges → no false
  data). The IP lookup now **short-circuits a non-routable address entirely
  offline**: instead of firing three geolocation upstreams that can never resolve a
  `10.x`/`127.x`/`100.64.x` address and returning a confusing "lookup failed", it
  returns an instant, precise **"NON-ROUTABLE ADDRESS"** card naming the scope + RFC
  (measured ~0.09s vs. multi-second upstream timeouts, and 3 fewer wasted calls).
  Routable public IPs carry a `global` classification and geolocate as before.
  Deterministic and fully tested (43 classifier cases, both IP versions + edge
  parsing), 100% covered, and verified end-to-end.
- **Manage API keys in the web app** — a new **Sources & keys** panel (🗄 header
  icon) lets you paste your optional provider keys (IPQS, NumVerify, Twilio,
  Hunter, FullContact, …) directly in the UI instead of editing `.env.local`.
  Keys are stored server-side in `.data/keys.json` (mode `0600`, git-ignored) via
  an allow-listed `/api/keys` endpoint, are **never returned to the browser**
  (the UI sees only a configured/source flag), and a UI key takes precedence over
  the matching env var. All lookup routes now resolve keys through `lib/keyStore`
  (UI → env → none), so existing `.env.local` setups keep working unchanged.
- **"At a glance" + jump nav on every result** — the summary card (extracted into
  a shared `GlanceCard`) now appears on **IP, Domain and Email** results too, not
  just phone, and every non-phone result gained a **Copy link** button.
- **User-friendliness overhaul** (no data/accuracy logic touched):
  - **Boot animation plays only on the first visit** — persisted flag + lazy init,
    so returning visitors land straight on the console (no replay, no flash).
  - **Example chips** under every empty input (`Try +1 415 555 2671`, `torvalds`,
    `8.8.8.8`, `github.com`…) that fill + run in one click.
  - **Shareable / bookmarkable results in every mode** — each lookup writes
    `?mode=…&q=…`; opening that URL re-runs it (older bare `?q=` phone links still work).
  - **"At a glance" summary card + jump nav** on phone results — line type · carrier ·
    location · breach · infostealer up top, with a section jump past the ~12 panels.
  - **Plain-language tooltips** (`components/shared/Term.tsx`) for E.164, NPA, CNAM,
    MCC/MNC, infostealer, etc.
  - **Sources & keys panel** + **`/api/sources`** — shows which sources are live and
    which optional keys are configured (**booleans only — values never leave the server**).
  - **Keyboard shortcuts** — `1`–`8` switch mode, `/` focuses the input; a **`?` help
    popover** lists modes + shortcuts.
  - **Visual-effects toggle** honouring **`prefers-reduced-motion`** — the Canvas
    matrix-rain stops for reduced-motion users and via the header toggle.
  - **Honest scan progress** (`ScanProgress`) for slow lookups — label + elapsed timer
    + indeterminate bar (no fabricated "X of N").
  - **Friendlier error copy** replacing the dev-oriented "is the dev server running?".
- **Bigger email-intelligence datasets** (`lib/disposableEmailDomains.ts`):
  - **Disposable / throwaway domains: 871 → 1,224** (+353) — temp-mail, 10-minute,
    and wegwerf service families, the **1secmail alias pool**, mailinator-style
    sinkholes, and the ivolo/mailchecker long tail.
  - **Free-webmail providers: 232 → 378** (+146) — ISP/regional mail and
    Yahoo/Outlook/Live ccTLD variants (so genuine regional mail is classed
    `free`, not left `unknown`).
  - **Privacy providers: 53 → 70** (+17) — known privacy mail hosts.
  - All sets are sorted, deduped (case-insensitive), with **zero cross-set
    overlap** — no domain can be classified two ways. Pure data: `analyzeEmail()`
    is unchanged (`Set.has`), so the bigger lists strictly widen coverage of the
    DISPOSABLE / PRIVACY / WEBMAIL badges, the email threat score, and exports.
- **Editable link-analysis graph:** the graph is now interactive — click any node
  to **relabel it, change its type, or remove it**, and **add new nodes** from a
  type picker + value field (with a **CLEAR** all). It is a controlled component
  (optional `onChange`), so edits in the **session graph** update session state and
  edits in a **case graph persist** straight to the file-backed case store via the
  existing `addEntity`/`removeEntity` API (a relabel = remove old + add new). PNG
  export is unaffected (edit chrome is HTML, outside the exported SVG).
- **Case report export + re-import (chain-of-custody):** export any case as
  **JSON** (machine-readable, re-importable, carrying a **SHA-256 integrity hash**
  of the payload) or as a **Markdown** report (entity table, analyst notes,
  timestamps, integrity hash). Re-import verifies the hash and **warns on
  tampering** before loading. `lib/caseReport.ts` (+7 unit tests).
- **More free, no-key sources:**
  - **Shodan InternetDB** (IP): open ports, **known CVEs**, hostnames, tags →
    "Internet Exposure" card + clickable CVE→NVD links, folded into the risk score.
  - **GreyNoise Community** (IP): benign/malicious/RIOT scanner classification badge.
  - **DNSSEC** (domain): DNSKEY-based signed/unsigned check.
  - **Wayback Machine** (domain): first-archived snapshot (Internet Archive CDX).
  - **GitHub profile** (username): name, bio, company, followers, repos for the handle.
- **Interop case exports:** in addition to JSON + Markdown, export a case as
  **CSV**, **STIX 2.1 bundle** (SCOs per identifier), **Maltego** paste-table CSV,
  or a **printable HTML → PDF** report. (+3 unit tests.)
- **Per-source provenance strip:** every IP lookup shows which sources were
  queried, whether each answered, and its latency — so a missing value is
  explained ("source unreachable"), never a bare `N/A`.
- **First-run permitted-use consent gate** (`ConsentGate`): a one-time, locally
  remembered authorized-use acknowledgement (no stalking/harassment; metadata only).
- **Cross-mode lookup history** (`lib/lookupHistory.ts` + `RecentLookups`): every
  successful lookup is remembered locally; a header **RECENT** dropdown re-runs any
  of them in one click (auto-switches mode). Clearable; live-updates across tabs.
- **Field-source "evidence" strips** (`SourceStrip`): the phone, email and IP
  result dashboards now show a per-source provenance row (answered / no-record /
  unreachable / no-API-key) — making "where each value came from" explicit.
- **End-to-end tests (Playwright):** `e2e/smoke.spec.ts` covers the consent gate,
  the editable graph (add → remove), case creation + all interop export buttons,
  and the recent-lookups control. `npm run test:e2e` (run `npx playwright install
  chromium` once). 4/4 green.
- **`/api/health`** liveness/readiness endpoint (used by the Docker healthcheck;
  left open even when the auth gate is on).
- **Footer credit:** "Created & developed by **Nisarg Chasmawala (Shroff)**".

### Changed
- **Regression tests for the recent fixes** (56 tests, up from 47): `ipValidation`
  guards the compressed-IPv6 acceptance; `caseStore` covers CRUD + a 20-way
  concurrent-write race (proving no lost updates); `keyStore` gained write-path +
  concurrency coverage (previously only reject paths were tested). The file-backed
  stores now honour an **`HV_DATA_DIR`** override (default `./.data`) so they can be
  tested against a hermetic temp dir — and so deploys can keep state outside the app
  directory. The `/api/ip-lookup` IP validation moved into a shared, tested
  `isValidIp`/`ipVersion` helper in `lib/server/validation`.
- **CI now runs the Playwright e2e smoke suite** as a parallel job (build + typecheck
  + lint + unit already ran); the 4 smoke tests gate every push/PR to `main`.
- **Runtime bumped Node 20 → 22 (active LTS)** across `.nvmrc`, the Dockerfile (all
  three stages) and CI, with `@types/node` aligned to `^22` to match. The `engines`
  floor stays `>=20.9.0` so existing setups aren't locked out.
- **Dependencies refreshed to latest in-range**: Next `16.2.10`,
  `libphonenumber-js 1.13.8` (fresher carrier/numbering metadata → better accuracy),
  `framer-motion`, `lucide-react`, `postcss`, `vitest`, Playwright, radix-tabs.
  `npm audit` remains at **0 vulnerabilities**.
- **Major-version upgrades:**
  - **Tailwind CSS 3 → 4** — moved to the `@tailwindcss/postcss` plugin and the
    single `@import "tailwindcss"` entry, keeping the existing design tokens via
    `@config` (the classic `tailwind.config.ts` stays authoritative, so colours,
    fonts and the zero-radius scale are byte-identical). Added the v4 border-colour
    compatibility layer so bare `border` utilities keep their v3 default. Verified
    with a before/after visual pass (home dark+light, phone results, breach/OSINT
    cards) — no visual drift; the lockfile carries all Linux/macOS/Windows native
    `oxide`/`lightningcss` binaries so CI and the Alpine image build unchanged.
  - **TypeScript 5.8 → 6** — clean upgrade (in `typescript-eslint`'s supported
    `<6.1.0` range); typecheck, lint, build and all 56 tests pass unchanged.
  - **puppeteer-core 22 → 25** (screenshot tooling) — updated the dropped
    `headless: "new"` option to `headless: true`; smoke-tested a real launch.
  - **ESLint 10 held back on 9** — `eslint-config-next`'s bundled
    `eslint-plugin-react` still calls the `context.getFilename()` API that ESLint 10
    removed (hard crash), so ESLint stays on 9 until Next ships v10-compatible
    plugins. (`typescript-eslint` already supports ESLint 10; the Next plugin set
    does not yet.)
- **Test coverage: 56 → 244 tests, now 100% of `src/lib`** — statements, branches,
  functions and lines are all 100%, enforced by a vitest coverage `threshold` so it
  can't silently regress (new lib code must ship with tests or an explicit
  `/* v8 ignore */` for genuinely-defensive branches). Reaching 100% surfaced the
  MTN carrier fix above and let two redundant/defensive spots be simplified
  (`rateLimit`'s cleanup timer body extracted to a testable `purgeExpired`;
  `freePhoneIntel`'s always-true VOIP-carrier guard removed). Highlights of the
  added suites:
  - **Verdict logic:** `emailAnalysis` (disposable/privacy/webmail/gov/edu
    classification + the conservative name-guesser), `hashDetect` (every scheme +
    hex length), the `validation` request-body gate (`parseBody` + schema bounds),
    and the `modes` registry / `detectMode` classifier.
  - **Server layer:** `fetchSafe` (timeout/reason mapping, never-throws contract),
    `rateLimit` (fixed-window + no-trust-of-proxy-headers), `cache` (TTL + eviction),
    and `auditLog` (default hashing, `HV_DATA_DIR`, plaintext override).
  - **API route integration — now every one of the 11 routes:** end-to-end handler
    tests driving the real POST/GET/DELETE through the shared middleware with all
    upstreams mocked. Beyond the earlier `ip-lookup` / `username-lookup` / `sources`:
    the core `POST /api/lookup` (offline happy path, the full IPQS+breach+Hudson-Rock
    enrichment merge → CRITICAL threat, caching short-circuit, rate-limit), the
    609-line `POST /api/email-lookup` (Gravatar/EmailRep/XposedOrNot merge + breach
    parsing), `domain-lookup` (DoH/RDAP/crt.sh/Wayback recon merge + URL
    normalization), `bulk-lookup` (offline triage rows), `cases` (full CRUD dispatch
    + error mapping), `keys` (secrets **never** echoed back), and the `health` /
    `docs` metadata endpoints. These live in `src/app` (outside the `src/lib`
    coverage gate) — pure behavioural value, not coverage-chasing. The `lookup` +
    `bulk` suites also lock in the timezone fix above (`415 → America/Los_Angeles`).
  - **Client + data + import paths:** `lookupHistory` (dedupe/cap/event, 0 → 100%),
    `caseStore.importCase` (the untrusted re-import: kind allow-list, dedupe,
    non-finite `addedAt` guard, length caps, fresh-id/no-clobber), and data-integrity
    invariants over `countryIntel` + `mccMnc` (which caught the MTN fix above).
  - **Remaining lib to 100%:** `utils` (`cn`, `copyText` secure + legacy paths),
    `effects` (reduced-motion + unavailable-`matchMedia`), `phoneAnalysis`
    (country-less/short-subscriber edge numbers), `caseReport` (STIX for every
    entity kind, printable HTML, minimal/tampered import envelopes), `usNpaDatabase`,
    and the file-store error paths (corrupt file, failed atomic rename).
  This coverage is what surfaced the `hashDetect`, `detectMode`, `proxy`, `auditLog`
  and MTN-carrier fixes above.
- **Server-layer robustness:** the `rateLimit` cleanup timer is now `unref()`'d so a
  background housekeeping interval can't by itself keep the process alive; and a
  full security review of the app's surfaces (SSRF, injection, XSS, secret leakage,
  CSRF, auth) found no critical/high issues — every outbound `fetch` uses a fixed
  host with `encodeURIComponent`'d input, so there is no user-controlled-host SSRF.
- **Client hydration hardening — lint clean, 9 → 0 warnings.** The
  `react-hooks/set-state-in-effect` warnings across 8 client components were resolved
  on their merits, not silenced. The four that read **external client state**
  (localStorage / the `data-theme` DOM attribute) — `ThemeProvider`, `ConsentGate`,
  `EffectsToggle`, `HistorySidebar` — now use React's purpose-built
  **`useSyncExternalStore`** with a `getServerSnapshot`, which removes the mount
  effect entirely *and* is SSR-safe by construction (first client render always
  matches the server, then React swaps in the real value). `HistorySidebar` also
  gained an instant same-tab refresh event (was previously only picked up on window
  focus). The `CasesPanel` notes-draft reset moved to React's "adjust state during
  render" pattern. The three genuinely-correct side-effecting cases (mount data-fetch
  in `CasesPanel`/`SourcesPanel`, the boot/deep-link runner in `page.tsx`, the async
  QR-canvas draw in `QrCodePanel`) keep their effects with a **one-line justified
  `eslint-disable`** each. Behaviour verified end-to-end in a browser: theme + effects
  toggles flip and persist across reload, the consent gate shows/dismisses/persists,
  a lookup lands in Recent Queries instantly — with **zero console hydration warnings**.
- **Accessibility + first real component tests.** The UI now carries the same
  standard as the logic layer. A11y fixes: added the page's single `<h1>` (the app
  had **no headings at all** — a WCAG/screen-reader gap), and made the command
  palette a properly-named **modal dialog** (`role="dialog"` + `aria-modal` +
  accessible name) that **returns focus to its trigger on close** so keyboard users
  aren't dumped at the top of the document. A scripted audit of the live DOM
  confirmed all buttons/inputs/links already have accessible names, images have alt,
  and the 8 mode tabs sit in a labelled `tablist` with `aria-selected`. New
  interaction tests (React Testing Library, jsdom) lock in the four
  `useSyncExternalStore` refactors — `ConsentGate` show/dismiss/persist,
  `ThemeProvider`+`ThemeToggle` flip/persist/reflect-to-`<html>`, `EffectsToggle`
  persist, `HistorySidebar` live-update/clear — plus `CommandPalette` routing
  (smart-run classifies a typed IP as IP, mode switch, the new dialog a11y). Verified
  end-to-end in a browser; the header is visually unchanged.
- **Docs:** README now reflects the Node 22 `.nvmrc` pin (was still documented as v20).

### Security
- **HSTS on HTTPS deployments.** When the app is served over TLS
  (`FORCE_HTTPS=1`), responses now carry
  `Strict-Transport-Security: max-age=63072000; includeSubDomains`. It is gated on
  the exact same condition as `upgrade-insecure-requests` so it is **never** sent on
  the default HTTP (localhost/LAN) deployment — where a cached HSTS entry would
  otherwise make the browser refuse the very origin serving it. Verified live: the
  header is present on an `FORCE_HTTPS=1` build and absent on the default build.
  (Note: Next bakes `headers()` into the build, so `FORCE_HTTPS` must be set at
  **build** time, not just at `next start`.)
- **Full security audit + hardening.** From a fresh review of the whole codebase
  (SSRF, injection, XSS, CSRF, path traversal, ReDoS, prototype pollution, secrets,
  headers):
  - **CSRF guard** in middleware — cross-site `POST/PUT/PATCH/DELETE` are rejected
    (`Sec-Fetch-Site` + `Origin`/`Host` fallback), so a malicious page can't drive
    `/api/keys` or `/api/cases`. Verified: a cross-site write returns 403 and
    persists nothing; same-origin and curl are unaffected.
  - **`unsafe-eval` removed from the production CSP** (dev-only now) — the prod
    bundle contains zero `eval()` / `new Function()`, verified in-browser with no
    CSP violations.
  - **Request-body cap** (512 KB, HTTP 413) against memory-exhaustion DoS.
  - **Generic 500s** on `/api/cases` (no internal paths/stack in responses).
  - **DOM-XSS via third-party links closed** — results include URLs a *target*
    can control (Gravatar profile / linked-account URLs, FullContact "social
    profile" URLs). React does not block `javascript:`/`data:` hrefs and the prod
    CSP keeps `script-src 'unsafe-inline'`, so such a URL was a click-to-XSS on our
    origin (which could then drive same-origin `/api/keys` / `/api/cases`). Every
    remote-supplied `href` now goes through `safeExternalUrl()` (`lib/utils.ts`),
    which admits only absolute `http(s)` URLs and renders anything else inert.
    (+ regression tests, `tests/safeUrl.test.ts`.)
  - **No runtime fingerprinting** — `/api/health` (reachable even with the auth
    gate on) no longer reports the Node interpreter version.
  - **Normalised source errors** — per-source failures shown in the UI are mapped
    to a small safe set (`timed out` / `aborted` / `request failed` / …) via
    `describeError()`; a raw exception string is never returned to the browser.
  - Confirmed safe (no change needed): no SSRF (every outbound host is fixed;
    input is validated + URL-encoded), no path traversal (fixed file paths), no
    prototype pollution (allow-listed keys + fresh-object construction), no secrets
    in the client bundle (only public env-var *names* for setup hints). Remaining
    XSS surface (text nodes, HTML/CSV/print exports) is React-escaped /
    entity-escaped / formula-guarded.
  - Documented accepted risk: NumVerify (`apilayer.net`) and `ip-api.com` are
    HTTP-only on their free tiers, so on the free tier the NumVerify `access_key`
    travels in cleartext — noted in `SECURITY.md` (use a paid HTTPS plan or omit).
  - **Migrated the CSRF/auth interceptor to Next 16's `proxy` convention** —
    `src/middleware.ts` → `src/proxy.ts` (`middleware()` → `proxy()`), clearing the
    deprecation warning. Same matcher, same behaviour; CSRF re-verified after the move.
- **`npm audit`: 0 vulnerabilities.** Next's nested `postcss@8.4.31`
  (GHSA-qx2v-qp2m-jg93, `</style>` XSS in CSS stringify) is pinned forward to the
  patched `8.5.x` line via an npm `overrides` (`"postcss": "$postcss"`) that dedupes
  it to the already-patched top-level copy. The earlier `esbuild`/`vitest`
  dev-server advisory was cleared by upgrading to **Vitest 4**.
- **Upgraded React 18 → 19.2 and Vitest 2 → 4** — current, supported, advisory-free.
  No code changes were required (no `defaultProps`, string refs, `findDOMNode`, or
  legacy context in the tree).
- **CSV formula-injection guard** on every CSV export (case + bulk): a cell starting
  with `= + - @` (or tab/CR) is prefixed with a single quote so it can't run as a
  formula in Excel / Sheets. (+ regression test.)
- **Case-store length caps** — file-backed case `name` / entity `value` / `note` are
  length-bounded so a malformed request can't bloat `.data/cases.json`.
- **Resilient outbound fetch (`lib/fetchSafe.ts`):** every third-party call now
  runs through a hard-timeout `AbortController` wrapper that never throws — a
  slow/dead source can no longer hang a lookup, and each result carries
  provenance (source · fetchedAt · latency).
- **Optional auth gate (`src/proxy.ts`):** set `AUTH_PASSWORD` to require
  HTTP Basic auth on the whole app + API (constant-time compare). **Off by
  default** (single-user self-host); `/api/health` stays open for probes.
- **Append-only audit log (`lib/auditLog.ts`):** records that a lookup happened
  (type · salted-SHA-256 of the target · time · status) to `.data/audit.log`.
  Targets are **hashed by default** so the log isn't fresh PII (`AUDIT_PLAINTEXT=1`
  to override). Wired into all six lookup routes.
- **Data hygiene:** `.data/*` is written `0600` (owner-only); a **"WIPE ALL"**
  control + `DELETE /api/cases?all=1` erases every case **and** the audit log
  ("delete my data"). Case import validates kinds + de-dupes.
- **Schema validation with zod (`lib/validation.ts`):** every lookup route now
  parses its body against a typed schema with **length bounds** before doing any
  work — rejecting malformed/oversized payloads (e.g. a 5 KB "IP") with a 400.
  Domain-specific checks (libphonenumber, IP/domain regex, username charset) still
  run afterwards.
- **Supply chain (CI):** the GHCR publish workflow now attaches an **SBOM** +
  **SLSA provenance** to the image and **signs it with cosign** (keyless OIDC);
  an SPDX SBOM is also uploaded as a build artifact.

### Fixed
- **US/Canada phone numbers showed the wrong timezone for ~half the country**
  (`lib/analysis/phoneAnalysis.ts`). Timezone/UTC-offset were derived from a single
  country default (`COUNTRY_TZ["US"] = America/New_York`), so a `415` (San Francisco)
  number reported **Eastern** instead of Pacific — even though the bundled NPA
  database already knew the correct per-area-code zone (`415 → America/Los_Angeles`).
  The analyzer now prefers the NPA-specific zone whenever it has one, for both the US
  and Canada (a Vancouver `604` number is now Pacific, not the Toronto default). The
  offset map (`TZ_UTC`) was also completed with the **28 NANP zones** the NPA DB uses
  but the map lacked (Arizona/Phoenix has no DST, Yukon/Whitehorse is permanent UTC-7
  since 2020, Turks & Caicos/Grand Turk observes EST/EDT since 2018, the
  Eastern-Caribbean AST islands, Guam/Saipan/Pago Pago, …) so every area code renders
  a correct offset instead of falling back to the country default. Verified end-to-end
  against the live API and regression-tested. This is a direct application of the
  no-false-data rule: we already had the accurate value and were showing a wrong one.
- **Carrier lookup returned the wrong operator for MTN South Africa**
  (`lib/data/mccMnc.ts`). PLMN `655-10` was mapped to *Vodacom* (Vodacom is
  `655-01`, which was also present), and the intended MTN row had been added under
  a malformed key `655-10-mtn` that `lookupMccMnc` can never build — so it was dead
  data. `655-10` now correctly resolves to *MTN South Africa* and the malformed
  duplicate is removed. Surfaced by a new data-integrity test that asserts every
  `MCC-MNC` key matches `MCC(3)-MNC(2–3 digits)`.
- **Basic-auth check was not fully constant-time** (`proxy.ts`). The gate used
  `safeEqual(user) && safeEqual(pass)`; the `&&` short-circuits, so a wrong
  username skipped the password comparison and response timing could reveal that
  the username alone was correct. Both comparisons are now evaluated before being
  combined. (Low severity — only relevant when the optional `AUTH_PASSWORD` gate
  is enabled — but free to fix.)
- **Audit log ignored `HV_DATA_DIR`** (`lib/server/auditLog.ts`). Its data-dir was
  resolved once at module load, unlike `caseStore`/`keyStore`, so an operator who
  relocated state via `HV_DATA_DIR` would silently keep writing `audit.log` to
  `./.data`. It now resolves the path lazily like the other file-backed stores.
- **Hash identifier mislabelled MySQL 4.1 hashes as "Partial Plaintext"**
  (`lib/analysis/hashDetect.ts`). A MySQL 4.1+ hash is `*` followed by 40 hex
  chars, but the generic "contains `*` → masked password" branch ran first and
  swallowed it, so the dedicated MySQL detection was **unreachable dead code** and
  the algorithm was reported wrongly. The specific `*`+40-hex pattern is now
  matched before the generic `*` check (regression-tested).
- **Smart-run misrouted IP addresses to a phone lookup** (`lib/client/modes.ts`).
  `detectMode` checked the (very permissive) phone pattern before the IP pattern,
  and a dotted IPv4 like `8.8.8.8` also matches the phone regex (`8` + `.8.8.8`),
  so the command-palette "smart run" sent Google/Cloudflare-style IPs to the phone
  API. IP (and email) are now classified before phone (regression-tested).
- **IPv6 lookups were rejected for the most common address form.** The hand-rolled
  IPv6 regex in `/api/ip-lookup` only matched full 8-group addresses and pure `::`
  forms — it rejected any compressed address with hex groups on **both** sides of
  `::`, which is how nearly every real IPv6 address is written. That included the
  app's **own placeholder** `2606:4700:4700::1111`, Google/Cloudflare public DNS
  (`2001:4860:4860::8888`), and link-local `fe80::1` — all returned
  *"Not a valid IPv4 / IPv6 address"* (HTTP 400). Validation now uses Node's built-in
  `net.isIP()` (fully RFC-correct, returns 4/6/0), so every standard IPv6 form is
  accepted and the IPv4/IPv6 type flag is derived from the same source of truth.
- **File-backed stores: lost-update race + write-queue poisoning** (`lib/server/caseStore.ts`,
  `lib/server/keyStore.ts`). Each mutation did `read → modify → write` with only the
  *write* half serialised, so two overlapping requests (e.g. a notes auto-save racing
  an `addEntity`, or two open tabs) both read the same snapshot and the later write
  clobbered the earlier one's change — silent data loss. Separately, the write queue
  used `chain = chain.then(op)`: a **single** failed write (disk full, `EACCES`, a
  transient FS error) left the chain permanently rejected, so **every** later write was
  silently skipped for the life of the process. Both stores now run each mutation as a
  **serialised read-modify-write** whose queue self-heals (the op runs whether the prior
  op resolved or rejected, and the retained tail is always resolved). Writes are now
  **atomic** (stage to a temp file, then `rename()` over the target), so a reader never
  sees a half-written file and a mid-write crash keeps the previous good copy. Verified
  at runtime: 12 concurrent `addEntity` calls to one case now persist all 12 (previously
  some were lost). Also hardened `importCase` to reject a non-finite `addedAt` (`NaN`).
- **Username search no longer reports false positives.** 15 JS-app / bot-walled
  sites (Instagram, TikTok, X, Reddit, Telegram, Spotify, …) return HTTP 200 for
  *every* handle, so a status check wrongly marked them "found" (a nonexistent
  username produced 14 false hits). They are now a `manual` check — never
  auto-claimed, shown as **"VERIFY →"** links, and excluded from the presence
  count. A nonexistent handle now yields **0** false positives (regression-tested).
  The structurally-broken **Stack Overflow** entry (`/users/filter?search=` always
  returns 200) was replaced with **Codeberg** (real 404).
- **Removed all dead Google "dork" links** (`site:` / quoted queries that returned
  "did not match any documents") project-wide and **deduplicated** the phone OSINT
  links into a single matrix — every link now lands on a real results page.
- **Network/LAN access:** `scripts/start.sh` now defaults to **production mode**
  (`next build` + `next start -H 0.0.0.0`) and prints the real LAN IP. Next 16's
  `next dev` blocks cross-origin requests to dev internals (`/_next/*`), and its
  matcher only matches DNS subdomains — never raw IP octets — so `allowedDevOrigins`
  wildcards like `192.168.*` can never work. Production mode has no such block, so
  the Network URL now loads fully (HTML/CSS/JS/API all 200) from phones and other
  devices. `--dev` flag still runs hot-reload for local development.
- **Network URL clarity + self-test:** Next's own startup banner prints
  `Network: http://0.0.0.0:<port>`, which is **not** an address a phone can open —
  this was the source of the confusing `0.0.0.0` URL. `start.sh` now pipes the
  server's output through `awk` and **rewrites every `0.0.0.0` to the real LAN IP**,
  so the banner reads `Network: http://192.168.x.x:<port>` (it still binds
  `0.0.0.0` internally, so localhost *and* the LAN both work). It also **actively
  self-tests** the Local and LAN URLs with `curl` and prints an unambiguous box:
  `http://<LAN-IP>:<port>  <-- open THIS on your phone`. If `qrencode` is installed
  it renders a scannable QR of that URL. Dev mode now binds to `127.0.0.1`
  (loopback only), so it never prints a misleading `0.0.0.0` line either.
- **Network doctor:** added `scripts/start.sh --doctor` (`npm run doctor`) — checks
  Node, the active interface/LAN IP, any active VPN tunnel, the macOS Application
  Firewall (incl. whether the *current* `node` binary path is allowed — the allow
  rule is path-specific and breaks on Node upgrades), and prints the exact remedies
  for the real-world blockers: phone on a different/Guest Wi-Fi, or the router's
  "AP isolation / client isolation" being on. Clarifies that when localhost works
  but the phone can't connect, the server is healthy and the block is the network.
- **Hydration error:** `ThemeProvider` no longer reads `document`/localStorage in
  its `useState` initializer (that made the client's first render differ from the
  server's when a non-default theme was stored). Server + client now both render
  `"dark"` first, then adopt the persisted theme in an effect after mount;
  `ThemeToggle` is mount-gated. Console is clean in both themes.
- **Boot version label:** `BootSequence` showed `v2.0`; corrected to `v1.3` and
  refreshed the module list for the unified platform.
- **Uninstall:** `scripts/uninstall-global.sh` rewritten to remove the binary
  even when root-owned (auto-sudo), strip every marker + function line (including
  legacy/duplicate installs) from all RC files via an explicit line loop (no awk
  rule-order bug that previously ate an adjacent line), back up each RC, and
  verify nothing remains. Added `npm run uninstall-global`.

## [1.3.0] — 2026-05-29

### Added — three new identifier types (all free, no API key)
- **Username OSINT** (`/api/username-lookup`): checks a handle across ~45 high-signal
  sites in parallel (developer, social, creative, gaming, forum, professional),
  classified found / unverified, grouped by category, with a presence score.
- **IP intelligence** (`/api/ip-lookup`): geolocation, ASN/ISP, reverse DNS, and
  VPN/proxy/hosting/mobile risk flags via ip-api, plus a 0–100 IP-risk score and
  9 free pivots (Shodan, Censys, AbuseIPDB, GreyNoise, …).
- **Domain intelligence** (`/api/domain-lookup`): DNS-over-HTTPS records
  (A/AAAA/MX/TXT/NS/CNAME), RDAP WHOIS, certificate-transparency subdomains
  (crt.sh), and an SPF/DMARC/MX email-security posture panel.

### Added — platform & UX
- **Unified 8-mode workspace**: Phone · Email · Username · IP · Domain · Bulk ·
  Graph · Cases, with a shared mode registry and auto-detection.
- **Command palette (⌘K)**: smart-run any identifier (auto-detects type),
  switch modes, toggle theme — built on `cmdk`.
- **Light + dark themes** with a persisted toggle and an anti-flash boot script;
  a full CSS design-token system (glassmorphism, neon glow, 3D parallax-tilt
  cards, holographic borders, animated grid background).
- **Link-analysis graph**: interactive SVG node graph connecting every
  identifier looked up in a session (or a case's entities) to a central target,
  with PNG export.
- **Persistent investigation cases** (`/api/cases`): file-backed store
  (`.data/cases.json`) that survives restarts — group identifiers, edit analyst
  notes, visualise each case as a graph. Cross-session, zero native deps.

### Added — data
- **MCC/MNC operator database** (`lib/mccMnc.ts`): resolves Twilio network codes
  to a real carrier name offline; wired into the phone aggregation as a fallback.

### Changed
- App version → v1.3. README rewritten to document all five identifier types,
  the 8-mode workspace, command palette, link graph, and cases; OpenAPI surface
  updated for the new endpoints.
- **Minimum Node bumped to 20.9** (Next.js 16 requirement); `.nvmrc` → 20,
  `engines` updated, `requirements.txt` removed in favour of `package.json`.
- `terminal-card` re-skinned as a glass surface (theme-aware) — every existing
  panel inherits the new look with no per-component changes.
- Screenshots regenerated against the v1.3 UI.

### Security
- **Upgraded Next.js 14.2.35 → 16.2.6** (latest stable), which resolves the
  entire high-severity Next.js advisory cluster (image-optimizer DoS, RSC DoS,
  cache poisoning, request smuggling, CSP-nonce XSS, WebSocket SSRF, …). The
  only breaking change relevant to us: `NextRequest.ip` was removed, so
  `getClientIp()` now relies on `x-forwarded-for` / `x-real-ip` (opt-in via
  `TRUST_PROXY=1`).
- **Migrated ESLint 8 → 9** with flat config (`eslint.config.mjs`, required by
  `eslint-config-next@16`); `next lint` was removed in Next 16 so the `lint`
  script now invokes the ESLint CLI directly. Replaced an SSR-unsafe
  `Math.random()` skeleton width (hydration mismatch) with deterministic
  widths, and made `ThemeProvider` initialise from the `data-theme` attribute
  instead of a `setState`-in-effect.
- **Disabled the Next image optimizer** (`images.unoptimized: true`) — the app
  only renders plain `<img>`, so this removes the `/_next/image` endpoint and
  its attack surface entirely.
- Light theme reworked to a legible **light-backdrop + dark-glass-panel** scheme
  so every text surface keeps full contrast.
- **`npm audit`: 0 vulnerabilities.** The `postcss@8.4.31` advisory
  (`</style>` XSS in CSS stringify) that Next pins as a nested dependency is now
  pinned forward to the patched `8.5.x` line via an npm `overrides` entry
  (`"postcss": "$postcss"`), deduping it to the already-patched top-level copy.
  The earlier dev-only `esbuild`/`vitest` advisory was cleared by upgrading to
  `vitest@4`.

### Fixed
- Restored the `import "./globals.css"` side-effect import in `layout.tsx` (an
  import-organizer had dropped it, which silently disabled ALL global styles).
- Reworked the holographic border to avoid `@property` / animated custom
  properties, which the production CSS minifier (SWC) was silently stripping.

## [1.2.0] — 2026-05-24

### Added
- **Hudson Rock infostealer search** for phone numbers — free, no API key,
  always-on. New `InfostealerPanel` shows infected devices, captured passwords,
  and the sites the credentials were used on.
- **Offline reputation engine** (`lib/freePhoneIntel.ts`) — derives carrier
  hints, VOIP/premium-rate flags, and recommended free lookups from the
  number structure alone, without calling any API.
- **Dork generator rebuild** — 58 dorks across 8 colour-coded categories,
  hit-rate badges (HIGH/MED/LOW), search-engine selector (Google /
  DuckDuckGo / Bing / Yandex / Brave), per-category and top-picks batch
  "open all in tabs" actions.
- **OSINT pivot matrix rebuild** — 66 links, all URLs audited and re-verified,
  each tagged with FREE / CAPTCHA / LOGIN / PAID; filter chips default to
  FREE + CAPTCHA so users only see auth-free links.
- **`NumberAnatomyPanel`** consolidates three older overlapping panels into
  one clean card (visual breakdown · type description · validity checks ·
  all four standard formats).
- **Action-centre empty states** — when an API key is missing, the breach
  and identity panels now show 8–10 free, no-key lookup buttons instead of
  an empty "add a key" wall.
- **Docker support** — multi-stage `Dockerfile`, `docker-compose.yml`,
  `.dockerignore`. `docker compose up -d` and you're live.
- **`LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`** —
  standard open-source repo hygiene.

### Changed
- Threat-score model now factors in Hudson Rock infostealer hits (each
  infection floors the score at 60).
- README rewritten to describe the new panels, Docker section added, OSINT
  pivot table updated with access tiers.

### Removed
- Dead components `NumberBreakdown.tsx`, `NumberTypePanel.tsx`,
  `FormatPanel.tsx` — replaced by the consolidated `NumberAnatomyPanel`.

## [1.0.0] — 2026-05-12

Initial public-ready release of HEAVEN-GeoIntel.

- Phone OSINT engine with libphonenumber, NPA database, country dataset.
- Email OSINT engine with disposable-domain detection, Gravatar, XposedOrNot.
- Optional API enrichment via NumVerify, IPQS, AbstractAPI, Twilio,
  BreachDirectory, FullContact, Hunter.io, EmailRep.
- Matrix-themed UI with Canvas katakana rain, terminal cards.
- In-memory cache (24 h TTL) + per-IP token-bucket rate limiter.
