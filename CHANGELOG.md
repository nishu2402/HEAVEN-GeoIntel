# Changelog

All notable changes to HEAVEN-GeoIntel will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [2.1.0] — 2026-05-24

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

## [2.0.0] — 2026-05-12

Initial public-ready release of HEAVEN-GeoIntel.

- Phone OSINT engine with libphonenumber, NPA database, country dataset.
- Email OSINT engine with disposable-domain detection, Gravatar, XposedOrNot.
- Optional API enrichment via NumVerify, IPQS, AbstractAPI, Twilio,
  BreachDirectory, FullContact, Hunter.io, EmailRep.
- Matrix-themed UI with Canvas katakana rain, terminal cards.
- In-memory cache (24 h TTL) + per-IP token-bucket rate limiter.
