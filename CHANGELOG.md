# Changelog

All notable changes to HEAVEN-GeoIntel will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

CI only — no change to the application, its API, or the published image's
contents. The `v2.1.0` image itself published, signed and attested correctly;
what follows is about the workflow around it.

### Fixed

- **The ghcr.io publish job no longer fails after a successful push.** The
  v2.1.0 tag run built, pushed and signed the image, then died on its last step
  with `Resource not accessible by integration`. `anchore/sbom-action` defaults
  to attaching its SBOM to the GitHub Release for the tag, which needs
  `contents: write`; the job holds `contents: read`. It had passed for v2.0.0
  and v2.0.1 only because no release existed for it to find — release.yml
  starting to publish releases is what exposed it. The action is now told not to
  attach, rather than the token being widened: the image already carries an SBOM
  as an OCI attestation, release.yml attaches a source SBOM to the release, and
  the workflow keeps a third copy as a build artifact.
- **The `main` build no longer times out.** It was killed at 30 minutes with
  linux/arm64 still emulating `npm ci` under QEMU — 17 seconds on amd64 against
  minutes on arm64, with total build time drifting from 1m47s at v2.0.0 to past
  the limit. Each architecture now builds natively on its own runner and the two
  are merged into one manifest list by digest.

### Changed

- Tagging a release starts this workflow twice on one commit (a push to `main`
  and a push of the tag). The two runs raced for a single `type=gha` cache scope
  and each slowed the other down; they are now serialised on the commit SHA, so
  the second finishes off the first's cache.
- Layer caches are scoped per platform. Sharing one scope had each architecture
  evict the other's layers, so neither ever hit.
- The publish job asserts that the merged manifest really does carry both
  architectures and both attestations, instead of assuming the merge preserved
  them.
- `.dockerignore` is an allowlist. `COPY . .` was sending `tests/`, `docs/`
  screenshots, `coverage/` and stray scan output into the build — 13 MB, now
  2.3 MB — and any edit to a test file invalidated the `next build` layer behind
  it. Nothing the image needs was removed; the built image serves `/api/health`
  and `public/` assets identically.
- `data/` is git-ignored. It holds scan output written by the sibling HEAVEN
  pentest tool; nothing in this repo reads it.

### Added

- `tests/dockerPublish.test.ts` — 14 assertions pinning the above, each verified
  to fail when its regression is reintroduced.

## [2.1.0] — 2026-08-11

**Four defects a passing test suite could not see: IP lookups that failed in
bursts, a version the UI truncated, a light theme that hid its own controls, and
a release process nothing automated.** One source was added (`ipwho.is`, keyless);
no API surface changed — the routes, the on-disk case format and the OpenAPI
document are identical to 2.0.1. **Upgrading is a reinstall; there is nothing to
migrate.**

### Fixed

- **IP lookups failed in bursts, and retrying made it worse.** ip-api.com's free
  tier allows **45 requests per minute per source IP** and reports what is left in
  an `X-Rl` header on every response. The app ignored it, treated the geo source as
  mandatory, and so the 46th lookup in a minute showed `[ IP LOOKUP FAILED ]` — with
  Shodan's ports and CVEs and GreyNoise's classification fetched, then discarded.
  The natural response to a failing button is to press it again, and ip-api's
  documented answer to sustained over-limit traffic is a **one-hour ban on the source
  IP**, which is how "some IP lookups fail" became "the tool is broken for an hour".
  Four changes, none of which is a retry loop:
  - The budget is now respected rather than discovered. `upstreamBudget` records what
    a provider says about its own quota and stops calling it once spent — a request
    never sent cannot earn a ban. Applies to Shodan and GreyNoise too, which have
    their own limits.
  - `ipwho.is` (HTTPS, keyless, separate quota) answers when ip-api cannot. Its
    fields are narrower, so `isProxy`/`isHosting`/`isMobile`/`reverse` come back
    `null` rather than a fabricated `false` — an invented negative on a risk flag is
    worse than an empty cell.
  - A dead geo provider no longer voids the whole lookup. IP mode was the only route
    that discarded a response when one upstream failed; it now returns what it has
    with per-source provenance, and fails only when nothing was learned.
  - IP results are cached (1 h, `IP_CACHE_TTL_MS`), like phone and email already
    were, so a repeat lookup, a refresh or a re-opened share link costs no quota.

- **A server error told the user to check their internet connection.** All five
  lookup runners called `res.json()` before checking `res.ok`, inside a `try` whose
  `catch` read *"Couldn't reach the server. Check your connection and try again."*
  Any error response without a JSON body — an HTML 500 page, a 502 from a reverse
  proxy, an empty body — threw at the parse and landed there, so the one message
  that sends someone to reboot their router was shown precisely when the fault was
  ours. `postLookup` now reads the body defensively and distinguishes the two, and
  rewrites the 429 as *"Too many lookups in a row. Try again in 37s."* instead of
  quoting an environment variable at the analyst.

- **A rate-limited source showed no reason for being down.** `fetchJson` set its
  `error` field only on the path that `allowNon2xx` skips, so GreyNoise answering
  429 produced a red source with an empty tooltip. Non-2xx now always carries a
  reason, and a body that fails to parse on a non-2xx reports the status rather than
  `invalid JSON from source` — ip-api answers its 429 in plain text, which sent the
  reader hunting for a parser bug instead of a rate limit.

- **The app displayed `v2.0` while running 2.0.1 — every version surface now shows
  the full semver.** `src/lib/version.ts` exported an `APP_VERSION_SHORT`
  (`major.minor`) and the header, the boot sequence, the launcher banner, the Docker
  tag and the outbound `User-Agent` all used it. The stated reason was that a patch
  release should not read as a new client in a free upstream's logs — but it
  recreated the exact problem the module exists to prevent. A screenshot of the app
  could not tell you which build produced it, which is how bugs actually get
  reported, and an upstream operator correlating a behaviour change to a release
  could not tell 2.0.0 from 2.0.1 either. The short form survives as
  `APP_VERSION_BRANCH` for the one place that genuinely means a *range* — the
  supported-versions table in [`SECURITY.md`](SECURITY.md). `versionSync` now fails
  if anything under `src/` imports it.

- **Light theme: controls rendered between panels were invisible.** The theme was
  built on "every surface that holds text stays dark", and that was not true. The
  skip link, the provenance strip (`SourceStrip`) and the add-to-case button render
  on the page background, and they wore `--hv-ink-dim` (`#8fb6a4`) and
  `--hv-glass-border` on `#e9edf6` paper — **1.9:1 text and 1.0:1 border**, measured
  on a live render. "ADD TO CASE" was a working button occupying blank space. A new
  `--hv-*-page` token set gives those controls dark ink (13.4:1) and darkened status
  accents (5.6–6.2:1), and the components that sit outside a panel now use it.

- **Light theme: panels were paler than the dark theme's, so greys failed on one
  and passed on the other.** At 90% opacity the bright page lifted the panel to
  `#222734` against the dark theme's `#090d18`. Mid-greys landed at 4.0–4.2:1 in
  light and ~5.5:1 in dark, so checking a colour in dark mode said nothing about
  light mode. Panels are now 96% opaque (`#121521`) and the two themes agree to
  within a tenth of a ratio point.

- **93 text colours across 24 components were below AA at their chosen opacity.**
  A house style of alpha-modulated accents (`text-[#00ff41]/30`, `/45`, `/55`) put
  descriptions, hints and category headers between 1.8:1 and 4.4:1 — in **both**
  themes, not just light. Each was recomputed against the composited panel and
  raised to the minimum opacity that clears 4.5:1 for its own base colour rather
  than to a blanket value. The OSINT pivot matrix's category headers stacked a 52%
  hex alpha under an `opacity-80` wrapper for an effective 42%; Signal and Viber's
  brand hues were under 4.5:1 at full opacity and were lightened.

- **`.badge-neutral` and `.badge-unconfigured` carried hardcoded `#333`/`#555`/`#888`
  with no theme variant.** "NOT CONFIGURED" and the env-var name that tells you how
  to fix it measured 2.7:1 and **1.6:1** — the one thing an analyst needs to read in
  that state. Both are token-driven now.

### Added

- **`ipwho.is` — a keyless standby geolocation source.** Reached only when
  ip-api.com is out of budget or down, so a healthy lookup never calls it. The
  manifest gained a `standby` flag to say so, and the alignment guard proves a
  standby really is reached when its primary fails rather than being a declaration
  nothing honours. **14 of 22 sources now need no API key.**

- **`npm run audit` — a dependency gate that blocks on reachability, not severity.**
  A bare `npm audit --audit-level=low` in a release workflow has a failure mode that
  only appears once releases are automated: the gate runs *after* the tag is pushed
  and its input is the advisory database, which changes with no commit to this repo.
  A `low` advisory published overnight against an eslint transitive would fail a
  release for something that cannot reach a single user, and the way out is to patch
  a dev dependency, amend, force-move the tag and push again. `scripts/audit-gate.mjs`
  blocks on anything in the production tree that `.next/standalone` bundles (any
  severity) plus anything `critical`, and reports the rest onto the release page
  instead of hiding it. `.github/audit-allowlist.json` is the escape hatch for a
  shipped advisory with no upstream fix: each entry needs a reason and an `expires`
  date, after which it stops suppressing — a suppression nobody renews is a decision
  nobody re-made. The release page's "0 vulnerabilities" badge is now rendered from
  this gate's measured output rather than typed by hand.

- **`.github/workflows/release.yml` — the GitHub release is now built by CI, not by
  hand.** Pushing a `v*` tag runs the full gate (lint, type-check, 100% coverage,
  build, dependency advisories) and then, only if it passes, packages the release,
  extracts the matching section from this file as the release notes, and publishes. It refuses to
  publish a tag whose `src/lib/version.ts` disagrees with the tag name — the same
  check `npm run release:verify` runs locally, enforced where it cannot be skipped.
  Attached to every release: a reproducible source tarball, a runnable Next.js
  standalone bundle, an SPDX SBOM, and `SHA256SUMS.txt` covering all three.

- **`tests/upstreamBudget.test.ts`, `tests/postLookup.test.ts` and
  `tests/releaseGate.test.ts` — 74 tests over the states a healthy run never
  reaches.** A quota that is already spent, a provider banned for an hour, a 500
  serving HTML, a production advisory, an expired suppression: none of these occur
  when everything works, so a gate exercised only against a healthy tree is a gate
  whose blocking paths are first tested on the day they fire.

- **`tests/themeContrast.test.ts` — a WCAG guard over the token system.** It parses
  `globals.css`, composites the translucent panels over their own page backgrounds
  and asserts AA on both themes, so a token edit re-runs the arithmetic instead of
  quietly invalidating a comment. It also asserts that the *panel* ink still fails on
  the page background — documenting the trap rather than only avoiding it.

### Security

- **Four high-severity advisories patched** (lockfile only; all dev-tooling
  transitives, none bundled into the app):
  `brace-expansion` 5.0.8 → 5.0.9 ([GHSA-rgw5-rvv9-x895](https://github.com/advisories/GHSA-rgw5-rvv9-x895)
  — unbounded intermediate arrays, bypassing the CVE-2026-14257 mitigation that 2.0.1
  shipped), `js-yaml` 4.3.0 → 4.3.1 ([GHSA-5p4m-2wfm-xmqj](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj)),
  `nanoid` 3.3.16 → 3.3.18 ([GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8)),
  and `undici` 7.28.0 → 7.29.0 (five advisories, including
  [GHSA-8xcm-r25x-g524](https://github.com/advisories/GHSA-8xcm-r25x-g524) response
  desynchronization). **`npm audit`, full tree and `--omit=dev`: 0 vulnerabilities.**

## [2.0.1] — 2026-08-02

**A dependency security patch, and the documentation that describes it.** No application
logic changed — the only edit under `src/` is the version literal itself, so the API
surface, the data sources, the on-disk case format and the OpenAPI document are all
identical to 2.0.0. **Upgrading is a reinstall; there is nothing to migrate.**

### Security

- **The `brace-expansion` chain that 2.0.0 disclosed as unfixable is now fixed.**
  [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg) /
  CVE-2026-14257 (high) — a crafted brace pattern expands without bound and crashes the
  process out of memory; affects `<1.1.17`. It is reached only through
  `eslint` → `minimatch@3` → `brace-expansion@1.1.16`: dev tooling, never bundled into
  the app, and driven only by a glob pattern the repo owner writes. 2.0.0 left it open
  because no patched 1.x release existed and forcing the patched 5.x breaks
  `minimatch@3`'s API (lint crashes). Upstream has since backported the fix onto the 1.x
  maintenance line, so a lockfile bump to **1.1.18** — already inside `minimatch@3`'s own
  `^1.1.7` range — closes it with no `overrides` entry and no API change. Lint re-verified
  against the bumped tree. **`npm audit`, full tree and `--omit=dev`: 0 vulnerabilities.**

### Added

- **`npm run release:verify` — a release pre-flight that checks the git tag, not the
  working tree.** `versionSync` proves every file in the repo agrees with
  `src/lib/version.ts`, but a tag is created outside the tree, so a perfectly
  consistent checkout can still be published under a tag pointing at the commit
  *before* the bump — which happened twice here, once shipping a `v2.0.1` tag whose
  `src/lib/version.ts` still read `2.0.0` and whose lockfile still held the vulnerable
  `brace-expansion`. The script reads `git show <tag>:src/lib/version.ts` and refuses
  the release when the two disagree, alongside a clean-tree check, the CHANGELOG
  heading and `npm audit`. The full procedure, including the conventions for the
  GitHub release page, is in
  [`.github/RELEASE_CHECKLIST.md`](.github/RELEASE_CHECKLIST.md).

### Documentation

- [`SECURITY.md`](SECURITY.md) claimed "0 vulnerabilities" while the tree carried a high
  — a status line is only worth having if it is checked. `brace-expansion` now sits in
  the resolved-advisory list with the reason it was reachable and the reason it closed.
- [`docs/AUDIT-AND-ROADMAP.md`](docs/AUDIT-AND-ROADMAP.md) §3.1 keeps its original
  "Residual, disclosed" paragraph as the record of what was true at audit time, with the
  closure written underneath it rather than over it. §9's open-items list marks the chain
  closed and points back at §3.1.

## [2.0.0] — 2026-08-01

**A full audit of the codebase, and everything it turned up.** 2.0 is the result of
reading all 17,275 lines of `src/`, running every mode against live upstream APIs on a
production build, and fixing what that found — then closing the gap between what the
tool *did* and what its own README said it was *for*. Every number below is measured,
not estimated; the full record is in [`docs/AUDIT-AND-ROADMAP.md`](docs/AUDIT-AND-ROADMAP.md).

The headline: **a lookup no longer ends at its own result.** Every finished lookup
offers the identifiers it derived as one-click pivots, those links persist into a case
carrying the reason they were drawn, and re-running a case tells you what changed since
last time. Phone — the weakest mode without API keys — went from 1 keyless source to 2.
The suite grew from 718 to **1,285 tests**, and the 100% coverage gate now covers every
API route and the auth/CSRF proxy, which were previously outside it.

### Breaking / upgrade notes

- **`/api/sources` ids were renamed and split 1:1 with what the routes report.**
  `hudsonrock` → `hudsonRock`, `xposedornot` → `xon`, `fullcontact` → `fullContact`,
  `rapidapi` → `breachDirectory`; the composite `ipapi` became `ip-api.com` +
  `Shodan InternetDB` + `GreyNoise Community`, `doh` became `dns` + `whois` +
  `subdomains` + `wayback`, and `usernames` became `usernameSweep` +
  `usernameProfiles`. The old ids never matched the ids the lookup routes emit, so
  `/api/sources` reported sources as "never called" moments after they had answered.
  A script that keys off these ids needs updating; the browser UI needs nothing.
  The response also gained `runtime` (live rate-limit and cache settings) and a
  per-source `lastSeen`.
- **Docker image tag:** `heaven-geointel:1.3` → `heaven-geointel:2.0`, in both
  `docker-compose.yml` and the README's plain-`docker` commands.
- **The default rate limit is now 60 requests/min per client** (was 10, shared by
  *every* client). If you relied on the old ceiling as a brake on upstream free-tier
  usage, set `RATE_LIMIT_MAX` back to 10 explicitly — and note there is now a separate
  server-wide `RATE_LIMIT_GLOBAL_MAX` (default 600/min) for exactly that job.

Everything else is backward compatible. Lookup responses only gained fields, and case
reports exported by 1.x still import and still verify as untampered — the integrity
hash for a v1 file is deliberately re-computed against the v1 payload shape.

### Added — cross-identifier intelligence

- **Auto-pivot: every result hands you its next lookup.** A finished result now
  surfaces the identifiers it already contains as one-click lookups — a domain's MX
  host and NS records, a Gravatar-linked handle, an IPQS-associated email, a
  FullContact phone, an XposedOrNot breach domain, an unmasked infostealer IP.
  `lib/analysis/autoPivot.ts` holds itself to four rules, each enforced by a test: it
  is **pure** (no network, no clock — the panel paints with the result); it **never
  invents** a value, so an email is never synthesised from a username; it **validates
  by kind**, so a malformed upstream field can't produce a dead-end lookup; and it
  **drops masked values** — Hudson Rock's free tier returns `82.167.***.**` and
  `i****@gmail.com`, which are evidence that something was captured, not identifiers
  you can pivot on. Confirmed links (an upstream asserts the association) render
  separately from related ones rather than being flattened into one list.
- **Phone finally has free enrichment — 1 keyless source of 7 became 2 of 8.**
  LeakCheck's public endpoint (`lib/server/leakCheck.ts`) reports how many indexed
  breach records mention an identifier, which field types were exposed, and the named
  breaches. It returns no credentials — that is the paid tier — so everything shown is
  exposure metadata. It answers for **three** modes (phone, email, username), which is
  why it is a shared module rather than route-inline. Two accuracy details, both found
  by probing the live endpoint rather than reading its docs: a phone in `+E.164` form
  is *rejected* ("could not determine search type automatically") so the route sends
  bare digits with an explicit `type=phone`; and the endpoint answers **HTTP 200 with
  `success: false`** for both "no records" *and* a refused query, so only the
  not-found message is treated as clean — without that split a malformed query would
  have been shown to the analyst as "this identifier is clean". Measured, keyless:
  `+919876543210` → 78 records across 13 named breaches.
- **Infostealer exposure for email, not just phone.** The source registry advertised
  Hudson Rock for phone **and** email while the email route never called it. Cavalier
  needs a different endpoint per identifier shape (`search-by-email` for an address;
  the `search-by-username` endpoint the phone route uses returns HTTP 400 *"Email is
  required"*), so both now go through `lib/server/hudsonRock.ts` and `InfostealerPanel`
  was made mode-agnostic. Measured: `test@example.com` → 5 infections.
- **The link graph is now server-side, per case, and records *why*.** A case gained
  `edges: { from, to, reason, addedAt }`, where `reason` is the verbatim auto-pivot
  string — so the stored graph says *what linked these two identifiers*, which the old
  `localStorage` graph could never answer. `LinkGraph` draws them as dashed edges on
  top of the membership spokes. Only links whose **both** ends were actually pinned are
  persisted; an edge to an identifier you chose not to pin would put a phantom node in
  the case graph.
- **Change tracking — "re-run this and tell me what moved".** Pinning a lookup to a
  case records a small bag of scalars worth watching (breach counts, open ports,
  subdomain totals, registrar, DMARC policy) — deliberately *not* the whole response,
  which would balloon the case file and pin PII on disk indefinitely. Three choices
  worth naming: the diff is computed **server-side against what is on disk**, because a
  client-side diff can only compare against what that browser happens to still hold; a
  first snapshot is a **baseline**, never "no change", because those are different
  claims; and `fromCache` is recorded, because otherwise an empty diff is ambiguous
  between "nothing moved upstream" and "we compared a cached result with itself".
  Facts a source couldn't answer are dropped, so "we don't know" never diffs as "zero".
  Verified live: a re-run reported `subdomains 1 → 4` and `dnssec — → signed`.
- **Case export schema v2 — the whole case, not just its identifiers.** Exports now
  carry the derived graph and the snapshot history, and the Markdown report gained a
  **Derived links** table and a **Change history** section. v1 exports still verify
  (see the upgrade notes above). One subtlety the tests surfaced: because the hash
  covers the *canonical* payload, junk appended to a report that doesn't survive
  sanitisation leaves the hash matching — correct about the **case**, silent about the
  **file** — so import now also reports `dropped`, the count of unparseable rows
  discarded. A verified report with `dropped > 0` means the file was edited even though
  nothing an analyst would act on changed.
- **Optional case lock (`CASE_PASSWORD`).** `AUTH_PASSWORD` gates the whole app, which
  is all-or-nothing. Cases are the only thing on disk that accumulates investigation
  targets and survives restarts, so `CASE_PASSWORD` seals `/api/cases` while leaving
  lookups open. Unset — the default — is a complete no-op. It uses a cookie rather than
  HTTP Basic because the cases UI talks to `/api/cases` with `fetch()`, and a 401 from
  `fetch()` does **not** make the browser prompt for credentials, so a Basic realm here
  would simply break the panel. The token is an HMAC over its own expiry keyed by the
  password: no session table, rotating the password invalidates every outstanding
  token, and the expiry cannot be extended by editing the cookie. `CASE_UNLOCK_TTL_MS`
  tunes its lifetime.

### Added — the poster

- **The README banner is generated, and it tells the truth about the build.**
  `lib/brand/poster.ts` renders an animated, self-contained SVG from the same
  geometry module as the favicon and the report letterheads, and every number on it
  is read out of the thing it describes at generation time: the version module, the
  source manifest, the mode registry, the endpoint registry, the username catalog,
  and the coverage threshold in `vitest.config.ts`. "13/21 sources need no key"
  therefore cannot become a lie by adding a 22nd source. Three files ship —
  `poster.svg`, `poster-light.svg` (GitHub switches with the reader's theme) and
  `poster-still.svg` for print — each with no external font or image to fetch,
  because GitHub will not proxy one. It stops animating under
  `prefers-reduced-motion`, and the still frame is a finished poster rather than a
  blank canvas waiting for keyframes.
- **The launcher, installer and uninstaller open with the same mark and the same
  numbers.** The generator also writes `scripts/banner.sh` from
  `lib/brand/banner.ts`, sourced by all three scripts. Colour on a TTY, plain text
  when piped or under `NO_COLOR`, padded on visible width so an escape code can
  never break the box, and the frame grows rather than truncating a number. Every
  script degrades gracefully when the generated file is absent — a launcher must not
  fail over decoration.
- **`npm run brand:poster`** regenerates the poster and the banner with no browser
  involved, so it works in CI and on a machine with no Chrome; `npm run brand` does
  that plus the rasters. `tests/posterAssets.test.ts` re-derives the numbers and
  fails the build if the committed artwork is older than the registries it quotes —
  "remember to regenerate the assets" is now a gate rather than a hope.

### Added — runtime configuration & operations

- **Every operational knob is an environment variable now** (`lib/server/config.ts`).
  Rate limits, cache TTLs and sizes, the per-source fetch timeout, fanout concurrency
  and snapshot history were compile-time constants; changing any of them meant editing
  TypeScript and rebuilding. Values are read on every call rather than frozen at module
  load, junk falls back to the default, and everything is clamped — so a typo cannot
  disable rate limiting. Defaults are the previous hardcoded values, except the rate
  limit (see the upgrade notes).
- **Dataset overlays — update the data without a rebuild.** Drop a JSON file in
  `.data/datasets/` to add, replace or remove entries in any of the five bundled
  datasets (country intel, NPA, MCC/MNC, disposable domains, username sites), then
  `POST /api/datasets` to reload without restarting. A malformed overlay is ignored
  with a warning rather than being fatal, and username-site entries are validated
  individually — a `body`-check site with no absence marker would claim every handle as
  FOUND, so it is rejected rather than trusted. Verified live: added a site, removed a
  bundled one, and changed a third from `manual` to `status`, with no rebuild.
- **One source manifest** (`lib/sources/manifest.ts`) that `/api/sources`, the OpenAPI
  description and the UI all derive from, plus `tests/sourceManifestAlignment.test.ts`,
  which drives every mode and asserts the manifest and the routes agree in *both*
  directions. Adding a provider can no longer leave a registry stale.
- **The OpenAPI spec is generated, not hand-written.** `/api/docs` is now built at
  request time from a declarative endpoint registry plus the source manifest — 12
  paths, 17 operations, up from 3 hand-maintained paths — and it states the limits
  *this instance* is running rather than numbers baked in when the doc was written.
  `tests/openapiCoverage.test.ts` walks `src/app/api/**/route.ts`, extracts the
  exported HTTP methods, and fails the build if the registry and the routes disagree
  either way.
- **Uniform per-source provenance on every mode.** Each lookup returns
  `sourceHealth: { source, ok, ms, fetchedAt, error?, skipped? }[]` alongside its typed
  payloads, replacing three different shapes across three routes. `skipped`
  distinguishes "no API key configured" from "called and failed" — colouring an
  unconfigured optional source red made a healthy keyless install look broken.
  `/api/sources` now reports each source's last observed call, not just whether a key
  is present.
- **One version, one place** (`lib/version.ts`). The version was typed out by hand in
  eight files and had already drifted three ways — `package.json` and `/api/health`
  said 1.3.0, the OpenAPI spec said 1.4.0, and the outbound User-Agent said 1.3.
  Everything now derives from a single constant, and `tests/versionSync.test.ts` fails
  the build if `package.json`, `package-lock.json`, `docker-compose.yml`, `SECURITY.md`,
  `scripts/start.sh`, the README's docker commands or this changelog fall out of step
  with it.
- **`.env.example` documents the whole surface**, not just API keys: the auth gate,
  the case lock, all rate-limit / cache / timeout / concurrency knobs, the data
  directory and the audit-log mode, each with its real default and the range it is
  clamped to.
- **A real uninstall.** `npm run uninstall-global` already removed the `geointel`
  command in every form it can be installed; it now also answers the obvious next
  question by telling you exactly what it deliberately left on disk. Pass
  `-- --purge-data` to delete the data directory too (cases, audit log, UI-saved API
  keys, dataset overlays) — it prints the contents and the case count and makes you
  type `yes`, and refuses outright when it isn't a terminal unless `--yes` is also
  given. `.env.local`, `node_modules` and the build output are never removed.
  Verified in a sandboxed `HOME` over a real pty: `yes` deletes, `n` and an empty
  answer keep, and the RC file comes out with the user's own lines intact.
- **`geointel --help`** — and unknown flags now fail with usage instead of silently
  starting a production build, which is what `geointel --help` used to do.

### Added — workspace, brand & quality-of-life
- **A real brand mark, synced end to end.** The app shipped with the stock
  `create-next-app` favicon and no logo of its own; it now has a proper one. A
  pointy-top hexagon frames a wireframe globe, and the **H** of HEAVEN is built
  from *chords* of that globe — its stems terminate exactly on the sphere at
  `±√(16²−9²)` and its crossbar is the equator — with a 20°-tilted orbit ring
  behind it. Every coordinate derives from the hexagon's circumradius (30) and
  the globe's radius (16). The construction lives once in `lib/brand/logo.ts`
  and is rendered four ways so it can never drift: as React (`<Logo>` /
  `<LogoLockup>`, hook-free so it works in server *and* client components), as
  static assets (`npm run brand` → favicon.ico with real 16/32/48 entries,
  `icon.svg`, `apple-icon.png`, `opengraph-image.png`, `public/brand/*`), as an
  inline SVG in HTML and printable reports (full-colour on screen, single-ink on
  paper), and as monospace art (`asciiLetterhead()`) heading the plain-text
  exports. Wired into the header, boot splash, consent gate, 404, phone + email
  reports, printable case reports, the exported link-graph PNG (stamped with the
  mark, wordmark and timestamp so a chart stays attributable once it leaves the
  tool), the web manifest and the OpenAPI spec. Verified by capturing the real
  export blobs from a live lookup, not by reading the code.
- **`geointel` sets itself up on first launch.** The very first `bash scripts/start.sh`
  now auto-registers the `geointel` shell function in your shell config (`~/.zshrc` /
  `~/.bashrc`) — so after one run you can start the app from any directory just by
  typing `geointel`, exactly as the README describes (previously that required a
  separate `npm run install-global`). It is interactive-only (never edits a shell
  config under CI, the Playwright e2e web-server, or the editor preview), fully
  idempotent (does nothing if `geointel` already exists), never asks for sudo, and
  writes the same marker + function block as `install-global.sh` so
  `npm run uninstall-global` removes it. Opt out with `NO_GLOBAL=1`. Verified in a
  sandboxed `HOME`: registers once under a real TTY, stays a single entry on repeat
  runs, is cleanly removed by the uninstaller, and is skipped when piped/non-TTY or
  when `NO_GLOBAL=1` is set.
- **The app opens in your browser on launch.** Starting the dev server (`npm run dev`)
  now pops the app open in your default browser once it's ready — Next has no built-in
  flag for this, so a thin zero-dependency wrapper (`scripts/dev-open.mjs`) spawns
  `next dev`, reads the Local URL from what Next actually prints (so a bumped port is
  handled), and opens it exactly once. `scripts/start.sh` does the same in both `--dev`
  and production modes. It only fires for real interactive launches — piped/non-TTY
  runs (CI, the Playwright e2e web-server, the editor preview) are skipped, and
  `BROWSER=none` / `NO_OPEN=1` opt out explicitly. Verified: the exact ready URL is
  opened under a TTY, suppressed when non-interactive or opted out, and the dev server
  still serves and shuts down cleanly through the wrapper.
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

- **Rate limiting is per client, and the default ceiling is 6× higher.**
  `getClientIp()` returned a hard-coded `127.0.0.1` unless `TRUST_PROXY=1`, so the
  whole installation shared **10 lookups per minute across all modes and all users** —
  measured before the fix: 12 requests across 6 modes, 429 at request 11. Clients are
  now keyed by trusted-proxy IP → a first-party `hv_rl` cookie (one bucket per browser,
  minted by `proxy.ts`) → a shared bucket for non-browser clients, with the default
  raised to 60/min *each* and a separate server-wide ceiling of 600/min so a
  cookie-discarding script can't exhaust a free upstream tier. A request rejected by
  the ceiling is **not** charged to the client, and a new `X-RateLimit-Scope` header
  says which limit is binding. One `guardRateLimit()` helper serves all six lookup
  routes, so the headers are now identical everywhere and on every status —
  `bulk-lookup` previously sent none at all. Measured after, same 12-request trace: all
  200, `remaining` counting 59→48, and a second client's first request still at 59.
- **Domain lookups: the crt.sh fallback is capped at 2.5 s** (was given the full 8 s
  source timeout, and a slow crt.sh spent all of it). It only ever *adds* to an
  already-usable Certspotter set, so cutting it short costs at most some extra
  subdomains. `example.com` **8.16 s → 0.42 s**; `nasa.gov` 2.42 → 2.28 s;
  `github.com` 0.83 → 0.64 s. **The faster design was tried and rejected:** firing both
  CT logs concurrently and aborting crt.sh once Certspotter proves sufficient is better
  on paper, but it sends a query to a free public CT front end on *every* domain lookup,
  and an abort only stops us reading the response — crt.sh has already started the work.
  Staying sequential keeps the common case at zero crt.sh requests, and a test asserts
  it. **Honestly reported:** `cloudflare.com` still takes 7.2 s, and the per-source
  timing attributes that to Certspotter itself (7.16 s) — the primary source on a
  certificate-heavy domain, not the fallback that was fixed. Still open.
- **The 100% coverage gate now includes every API route and `src/proxy.ts`.** Tests
  existed for them; nothing enforced that they covered the error paths. Bringing them
  in went from 94.31% statements / 89.99% branches to 100%/100% and took 299 new tests
  across 11 files — every provider success path, every HTTP error code, every timeout,
  every sparse-payload default, and the auth/CSRF gate, which had **zero** direct
  tests. Genuinely unreachable defensive branches carry a `/* v8 ignore */` naming why.
  Suite total: **718 → 1,285 tests across 95 files.**
- **Docs corrected where they overstated the tool.** Username badge 44 → **43** sites
  (the catalog's real size — an earlier pass "corrected" it to 47, which was also wrong,
  and the release pass counted it from `usernameSites.ts` rather than from prose);
  `/api/docs` "8 endpoints" → **17 operations across 12 endpoints**; "the 15 sites that
  return HTTP 200 for every handle" → **19**; the rate-limit badge, and the caching and
  rate-limiting prose.
- **Housekeeping / docs.** Removed a dead, empty top-level `data/` directory (the app
  has always stored runtime state under `.data/`, created lazily by the server) and
  stray `.DS_Store` files, and brought the README in line with the shipped behaviour —
  the `geointel` auto-registration is now documented accurately, and
  `npm run uninstall-global` / `npm run doctor` are listed under **Available Scripts**.
  Corrected several README facts that had drifted from the code: the **Project Structure**
  tree now reflects the real `src/lib` layout (`analysis/` · `data/` · `server/` · `client/`)
  and the `health` / `keys` / `sources` API routes; the cache is described accurately
  (24 h, **1000 phone / 500 email** entries, **FIFO** eviction — not "500, LRU"); the rate
  limiter is called what it is (a **fixed-window counter**, not a "token bucket"); and the
  `.nvmrc` pin is shown as **22**. No runtime code changed — docs only.
- **Silenced the dev-startup module-type warning.** Declared `"type": "module"` in
  `package.json` so Node/Turbopack loads the ESM config files (`tailwind.config.ts` et al.)
  directly instead of parsing them as CommonJS, failing, and reparsing — which emitted a
  `MODULE_TYPELESS_PACKAGE_JSON` warning on every `npm run dev`. Safe because the project
  has no CommonJS `.js`/`.cjs` files; every config is already ESM (`.mjs`/`.ts`). Verified:
  the warning is gone, and lint · typecheck · 702 tests @ 100% coverage · build · e2e all
  stay green with styling intact.
- **Every React component is now under the 100% coverage gate.** Coverage was
  previously enforced only over `src/lib`; the config (`vitest.config.ts`) now lists
  **all 47 components** in its `include`, each with a dedicated interaction test suite
  proving 100% statements/branches/functions/lines (or an explicit `/* v8 ignore */`
  with a stated reason for a defensive/SSR-only branch, matching the lib convention).
  Suites cover the shared controls (inputs, popovers, share/copy, error boundary,
  tilt), the `useSyncExternalStore` components (theme/consent/effects/history —
  including their server-snapshot paths via `renderToStaticMarkup`), the command
  palette, add-to-case flow, the link-analysis graph, the decorative canvas/boot
  sequence, the OSINT pivot matrices, and the full result dashboards for phone, IP,
  domain, username and email — including the large branch-heavy panels
  (`EmailResultsDashboard`, `PentesterPanel` with its time-dependent call-window logic
  frozen via fake timers, and `BreachPanel`). The suite is now **702 tests** (up from
  373), still 100% across every gated file and verified deterministic over repeated
  runs.

### Fixed

- **Adding an API key did not invalidate cached results.** A keyless result stayed
  cached for 24 h, so adding a key in the UI appeared to do nothing and the reasonable
  conclusion was "the key is broken". Both caches now live in `lib/server/cache.ts` and
  are cleared by any successful `setKey` / `clearKey` / `clearAllKeys`; a *rejected*
  mutation deliberately leaves them alone. Env-supplied keys need a restart, which
  empties the in-memory maps anyway.
- **A dropper filename was being rendered as a malware family.** `malwareFamily` fell
  back to the executable's bare filename when it recognised no known strain, so a live
  Hudson Rock record for `.../45AmJcDpU.exe` put **"45AMJCDPU"** in the malware badge —
  a random token presented as an identification. It now returns Cavalier's own
  `stealer_family`, a name from the known-family list, or **null**. The infection is
  still reported; an empty badge is the honest answer about the strain.
- **`threatScore` could serialise as `null`.** An IPQS `success: true` response that
  omitted `fraud_score` reached the threat maths as `undefined` → `NaN` → JSON `null`,
  rendering a broken bar. Only a finite number is accepted now; otherwise the field is
  honestly `null` and the score stays a number.
- **The username sweep reported itself healthy when every probe had failed.** The
  health predicate counted all hits, but `manual` sites are never contacted — so a
  total outage of the auto-checked sites still read as healthy. Judged on auto-checked
  sites only.
- **`/api/sources` showed sources as "never called" moments after they answered.** The
  hardcoded registry's ids didn't match the ids the routes emit. See the upgrade notes.
- **The test suite could write into the developer's real `.data/`.** Route handlers
  persist through `HV_DATA_DIR`, so any test exercising a route without setting its own
  temp dir wrote into `./.data` — polluting real cases and the audit log. This bit
  during the audit itself. Fixed two ways: the vitest run now points `HV_DATA_DIR` at a
  git-ignored `.vitest-data/` so no test can reach the real directory even if it
  forgets, and the four duplicated `dataDir()` definitions (audit log, case store, key
  store, dataset loader) were consolidated into `lib/server/dataDir.ts` with its own
  tests.
- **The OpenAPI spec documented 3 of 11 endpoints**, and drifted every time a route was
  added. Fixed structurally — see the generated spec above.
- **The version had drifted three ways across eight files.** See `lib/version.ts` above.
- **The README advertised 47 username sites; the catalog holds 43.** It also claimed
  28 were auto-verified when the real split is 24 auto / 19 manual — and the live
  sweep had been reporting `checked: 24` all along. Corrected in all seven places it
  appeared, and the poster now derives the number instead of repeating it.
- **`geointel` could serve the previous release's bundle after an upgrade.** The
  launcher only rebuilt when `package.json` was newer than the last build, so pulling
  a release that changed `src/` but not the manifest started the stale bundle with no
  hint that it had. It now rebuilds when anything that ends up *in* the bundle —
  `src/`, `public/`, `next.config.mjs`, the Tailwind/PostCSS config — is newer than
  `.next/BUILD_ID`.
- **`public/` was never copied into the Docker runtime image.** The runtime stage
  copied `.next`, `node_modules`, `package.json` and `next.config.mjs` but not
  `public/` — and Next does not bundle `public/` into `.next`, it serves it from
  the working directory at runtime. Nothing referenced `public/` before, so the
  omission was invisible; the brand assets made it load-bearing (the web
  manifest's icons and the OpenAPI spec's logo both point at `/brand/*`). Added
  the missing `COPY`, and verified it against a real build: with the line, all
  twelve brand/metadata routes serve 200 and every asset is byte-identical
  (sha256) to the committed file; with the line removed, `/brand/*` 404s while
  `/manifest.webmanifest`, `/icon.svg` and `/api/health` all still return 200 —
  so the healthcheck and the manifest stay green while every icon they point at
  is missing, which is why the omission would have shipped silently.
- **The dependency layer's `--omit=dev=false` was invalid npm config.** npm
  rejected it (`invalid config … Must be one or more of: dev, optional, peer`)
  and ignored it, which happened to produce the right result — dev
  dependencies stayed installed, as `next build` requires. Replaced with the
  correct `--include=dev` so the intent survives a stricter npm.
- **The healthcheck passed `-O` twice** (`wget -qO- … -O /dev/null`); the last
  flag won, so it worked by accident. Rewritten as `wget -q -O /dev/null …`.
- **The Dockerfile claimed the image was "small (<200 MB)".** Measured, it is
  ~205 MB compressed and ~1 GB on disk. Comment corrected to the real figures
  and points at `output: "standalone"` as the lever for reducing it. The same
  stale claim appeared twice in the README (plus a `node:20-alpine` layer table
  entry, three Node majors out of date) — all corrected.
- **The README told you to set `PORT` for a custom port — which breaks the
  container.** `PORT` moves the port the app listens on inside the container,
  while the published mapping stays pinned at 3000; following the tip produced
  a container that starts cleanly, reports nothing wrong, and answers no
  requests. Compose now pins `PORT=3000` in `environment:` (which takes
  precedence over `.env.local`, verified) and the host port is set with
  `GEOINTEL_PORT`.
- **`docker compose up` failed outright on a fresh clone.** `env_file` entries
  are mandatory by default, so with no `.env.local` compose aborted with
  `env file .env.local not found` before creating the container — flatly
  contradicting the file's own "every key is optional" comment and the
  project's zero-keys-required promise. Now declared `required: false`.
- **The compose healthcheck ran a real OSINT lookup every 30 seconds.** It
  POSTed a live phone number to `/api/lookup`, which fans out to seven
  third-party APIs — roughly 2,880 lookups a day against free-tier rate limits,
  purely to answer "is the container up?". The override is removed entirely so
  the image's own `HEALTHCHECK` (`GET /api/health`, no outbound calls) is
  inherited; keeping one definition is what stops the two drifting apart again.
- **Compose published the console on `0.0.0.0`.** A bare `3000:3000` exposes a
  working OSINT console — backed by the operator's API keys and case store — to
  anyone on the LAN. Now bound to `127.0.0.1` by default, which leaves the
  documented reverse-proxy deployment working unchanged. Both sides of the
  mapping are overridable without editing the file — `GEOINTEL_BIND=0.0.0.0`
  and `GEOINTEL_PORT=8080` — so the safe default costs nothing to depart from.
  Note these are read from the shell or a `.env` file in the repo root, not
  from `.env.local` (which is only forwarded into the container).
- **CI never enforced the 100% coverage gate.** The workflow ran `npm test`, which
  does not evaluate the thresholds in `vitest.config.ts` — so gated code could
  merge uncovered despite the documented gate. CI now runs `npm run test:coverage`.
- **Duplicate `### Fixed` sections under `[Unreleased]`** in this file: two
  separate blocks had accumulated, so related entries were split across the
  document. Merged into one, restoring Keep-a-Changelog ordering
  (Added → Changed → Fixed → Security).
- **The header logo collapsed at narrow widths.** As a flex child the mark has an
  auto min-width, so a declared 30px mark was being crushed to ~5px whenever the
  header ran out of room; it is now `shrink-0` at the component level so this
  cannot recur at any usage. The wordmark is `nowrap` and was silently overflowing
  its shrunk flex item and colliding with the header controls — a bounding-box
  check on the *container* does not catch that, since the text escapes the box
  rather than widening it. The lockup now reveals progressively instead (mark →
  wordmark at `md` → tagline at `xl`, the tagline waiting an extra breakpoint
  because at `lg` it lands flush against the controls with zero gap).
- **Username sweep accuracy — verified every check against live probes.** Each site
  was re-tested with a known-real handle vs. a known-nonexistent one (via the app's own
  Node `fetch`, not a browser), and the catalog corrected to match reality:
  - **Removed `GitHub Sponsors`** — `github.com/sponsors/{u}` 302-redirects to the plain
    `github.com/{u}` profile for *any* existing GitHub user, so it fired on every account
    as a misleading "found" that merely duplicated the rich GitHub profile card.
  - **Reclassified `npm`, `Codeberg`, `CodePen`, `Product Hunt`, `Last.fm` to `manual`** —
    all sit behind an anti-bot challenge (Cloudflare / Anubis / Fastly WAF) that 403s a
    keyless server fetch for real and fake users alike, so a status check only ever
    produced an "unverified" wall. They are now honest open-to-verify links.
  - **Fixed `Medium`** — the profile page is Cloudflare-walled to server fetches, but the
    public RSS feed is not, so the check now probes `medium.com/feed/@{u}` (clean 200/404)
    while still linking the reader to the pretty `medium.com/@{u}` profile.
  - **Added `Lichess`, `itch.io`, `Tumblr`, `Buy Me a Coffee`** — each confirmed to return
    a clean 200 (exists) / 404 (free), double-checked against two real handles and two
    nonexistent ones so they can never false-positive.
  - Net effect for a nonexistent handle: **`found: 0`** (zero false positives), and no
    perpetual "unverified" noise. The now-unused `crypto` category was dropped.
- **Domain recon — replaced two sources that were timing out on every lookup.** Probed
  live and swapped both for fast, equivalent APIs:
  - **Subdomains: Certspotter primary, `crt.sh` as a bounded fallback.** crt.sh returns
    the complete CT-log set but routinely exceeds 25s on busy domains (google.com never
    returned), so subdomains silently came back empty. Certspotter returns the same
    certificate-transparency names in well under a second (github.com → 39 real
    subdomains); when it comes back sparse (<5 — a small/new domain, or a Certspotter
    rate-limit) we still consult crt.sh and merge the results, and if crt.sh is
    slow/unavailable it simply adds nothing. crt.sh also stays as the "full history"
    pivot link.
  - **First-archived: Wayback CDX → the `available` endpoint.** The CDX API took 15s+
    (over its 9s cap → always failed); the availability endpoint, anchored to 1996,
    resolves the oldest snapshot in ~0.5s (github.com → 2008-05-14).
- **EmailRep no longer shows a permanent "rate limited" error.** Its keyless tier is
  throttled to an instant 429 for server-side callers, so every email lookup surfaced a
  red "Rate limited — try again" row (retrying also 429s). EmailRep now behaves like every
  other keyed source: `NOT_CONFIGURED` (with an "add a key" hint) when no `EMAILREP_API_KEY`
  is set, and the doomed keyless request is skipped entirely.
- **Country dropdown was painted under the "Recent queries" card.** The `.terminal-card`
  glass style sets `backdrop-filter`, which creates a stacking context — so the phone
  country picker's `z-50` was trapped inside the input card and the sibling History card
  below (its own `backdrop-filter` context) punched through the middle of the open
  dropdown list. The input card now carries `relative z-10`, lifting it above the cards
  that follow it while staying below the sticky header (`z-20`), so the dropdown overlays
  them cleanly.
- **Import integrity could be misreported as "verified".** `verifyCaseImport` now
  distinguishes three outcomes — hash matched (`verified`), hash present but wrong
  (`tampered`), and **no hash at all** — instead of treating a hash-less report as
  clean. `CasesPanel` no longer announces "Imported — integrity verified" for a report
  that carried nothing to verify against; it warns and labels the import UNVERIFIED.
  The import path is also hardened against malformed files (non-array/typed-wrong
  `entities`, non-string fields) so a bad JSON payload is sanitised rather than throwing.
- **Case delete/save/wipe could desync the UI from the server.** `CasesPanel` now only
  drops a case (or clears all cases) from local state once the server confirms the
  request; a failed `DELETE` or unreachable server surfaces an error and keeps the
  case visible instead of hiding one that is still on disk. Every mutation reports a
  server error, and a failed initial load shows a retry instead of a misleading
  "No cases yet".
- **`LocationPanel` showed the region twice.** The API-region row was de-duplicated
  against the *formatted* state string (`"California (CA)"`), so a raw region of
  `"California"` never matched and rendered as its own redundant row; it now compares
  against the raw state name.
- **`SourcesPanel` silently discarded a rejected key.** A failed key save used to clear
  the input as if it had succeeded; it now only clears the field once the server
  accepts the key, and surfaces save/clear/load failures. `keyLabel` also stopped
  flattening the `RapidAPI` acronym back to `Rapidapi`.
- **`MatrixRain` never widened on resize.** The drop-column count was recomputed inside
  the draw loop where it had no effect; it now resizes with the window.
- Removed dead/unreachable UI branches surfaced by the coverage work (a `BootSequence`
  "STANDBY" style that no line used, a never-`disabled` breach crack button, an always-
  populated email-pivot empty guard).
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
- **Recent-lookup history could silently stop recording after a single corrupt
  write** (`components/dashboard/HistorySidebar.tsx`). `saveToHistory` read the
  existing history with a bare `JSON.parse`; if the stored blob was ever corrupt
  (a partial write, manual tamper), the parse threw and the whole save was aborted
  — so **no future lookup was ever recorded** until `localStorage` was cleared. It
  now tolerates a corrupt/non-array existing blob the same way the read path
  (`readHistory`) already did, overwriting it with a clean array containing the new
  entry. Regression-covered.
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

### Security

- **`next` 16.2.10 → 16.2.12, closing 9 high-severity advisories — one of them aimed
  squarely at how this app authenticates.**
  [GHSA-6gpp-xcg3-4w24](https://github.com/advisories/GHSA-6gpp-xcg3-4w24) is a
  *middleware/proxy bypass in App Router applications using Turbopack*, and this app
  implements its CSRF guard and HTTP Basic gate in `src/proxy.ts`, builds with
  Turbopack, and documents `AUTH_PASSWORD` as the control for exposing the console on a
  LAN. The installed version was confirmed to be in the affected range and to use the
  affected feature combination; no exploitation was attempted. `postcss` and `sharp`
  were resolved via overrides (`sharp` is unreachable anyway — `images.unoptimized` is
  on and the app renders plain `<img>`), and the dead `@eslint/eslintrc` devDependency
  was dropped. **`npm audit --omit=dev` is now clean: 0 vulnerabilities.**
- **Disclosed, not fixed:** the full tree still reports 9 **dev-only** advisories, all
  rooting in `brace-expansion` reached via `minimatch@3`, which is bundled inside
  `eslint-config-next`'s own plugins. No fixed 1.x–4.x of `brace-expansion` exists —
  only 5.0.8 — and forcing it breaks `minimatch@3`'s API (verified: lint crashes).
  ESLint 10 also fails (`eslint-plugin-react`: `contextOrFilename.getFilename is not a
  function`). This chain is dev tooling only, never bundled, and reachable only through
  a glob pattern the repo owner writes. It needs an upstream `eslint-config-next`
  release.
- **Per-client rate limiting is a security fix, not just a UX one.** A single shared
  bucket meant any one client could deny the tool to every other user of the same
  instance with 10 requests.
- **`CASE_PASSWORD` seals the case store** without gating lookups — see above.
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
