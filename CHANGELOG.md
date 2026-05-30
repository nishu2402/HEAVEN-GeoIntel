# Changelog

All notable changes to HEAVEN-GeoIntel will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
- App version → v1.3. README + OpenAPI surface updated for the new endpoints.
- `terminal-card` re-skinned as a glass surface (theme-aware) — every existing
  panel inherits the new look with no per-component changes.

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
- **Residual `npm audit` (production): 2 moderate**, both the SAME advisory —
  `postcss@8.4.31` **vendored inside the `next` package** (`</style>` XSS in CSS
  stringify output). Our own `postcss` is 8.5.14 (patched); the flagged copy is
  Next's internal build-time dependency, is **not reachable at runtime** (the app
  never stringifies untrusted CSS), and is **not fixable at any current Next
  version** — even latest 16.2.6 bundles it (`npm`'s only "fix" is a nonsensical
  downgrade to next@9). Will clear automatically when Next ships an updated
  bundled postcss. Dev-only `esbuild`/`vitest` advisory is not shipped to prod.

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
