# Changelog

All notable changes to HEAVEN-GeoIntel will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
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

### Security
- **Resilient outbound fetch (`lib/fetchSafe.ts`):** every third-party call now
  runs through a hard-timeout `AbortController` wrapper that never throws — a
  slow/dead source can no longer hang a lookup, and each result carries
  provenance (source · fetchedAt · latency).
- **Optional auth gate (`src/middleware.ts`):** set `AUTH_PASSWORD` to require
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
