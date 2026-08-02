# HEAVEN-GeoIntel — Audit & Remediation Record

**Audited:** 2026-07-26 · v1.3.0 · commit `90ed86f`
**Remediated:** 2026-07-27 · **Phases 0–4 complete**
**Released as:** v2.0.0 · 2026-08-01 · commit `9cd4b50`
**Method:** static read of all 17,275 lines of `src/`, full quality gate, and live runs of
every mode against a production build (`next start`, real upstream APIs, Node `fetch`).
Every number below is measured, not estimated.

---

## 1. Status

| Gate | Before | After |
|---|---|---|
| `npm audit` (production tree) | 4 high-severity packages | **0 vulnerabilities** |
| `npm run lint` | pass | pass |
| `npm run typecheck` | pass | pass |
| `npm test` | 718 tests | **1285 tests** across 95 files |
| Coverage (statements/branches/functions/lines) | 100% on gated files | **100%**, gate now also covers **every API route + `src/proxy.ts`** |
| `npm run build` | pass, 17 routes | pass, 19 routes |

Everything in §3 (P0/P1/P2) is fixed, §5 ("why it isn't dynamic") is addressed, and
**§4 — the gap list against the project's stated goal — is now closed too**. §8 records
what Phases 3 and 4 changed and what they measurably did *not* fix; §8.10 records what
preparing the 2.0.0 release itself turned up.

---

## 2. Mode ranking — measured, keyless (out-of-the-box experience)

Ranked by intelligence actually delivered to an analyst with **no API keys**.

| # | Mode | Latency | Live keyless sources | Grade |
|---|---|---|---|---|
| 1 | **@ Username** | 1.8 s | 24 auto-verified + 4 profile APIs + LeakCheck | **A** |
| 2 | **📧 Email** | 1.6 s | Gravatar · XposedOrNot · **Hudson Rock** · **LeakCheck** (4) | **A−** |
| 3 | **⦿ IP** | 0.12–0.72 s | 3/3 (ip-api, Shodan InternetDB, GreyNoise) | **A−** |
| 4 | **🌐 Domain** | 0.42–7.2 s | DoH + RDAP + Certspotter (+crt.sh) + Wayback | **B+** |
| 5 | **🗂 Cases** | instant | file-backed, `0600`, atomic writes, **graph + diffing**, optional lock | **A−** |
| 6 | **📡 Phone** | 0.55 s | **2** (Hudson Rock, LeakCheck) of 8 | **B** |
| 7 | **🕸 Graph** | instant | **server-side per case**; session graph still `localStorage` | **B** |
| 8 | **≡ Bulk** | 0.03 s | offline only (by design) | **C+** |

Measured on a production build with **no API keys configured**, which is the configuration
the README promises and the one almost every user will run.

**Phone is no longer last.** It went from 1 keyless source of 7 to **2 of 8**, and the
second one is substantive: `+919876543210` returned 3 infostealer infections and 78 breach
records across 13 named breaches. It is still the mode with the most *keyed* sources, so it
still benefits most from adding keys — but its out-of-the-box answer is no longer thin.

**Email moved up.** Wiring Hudson Rock (§8.3) and LeakCheck took it from 2 keyless sources
to 4; `test@example.com` returned 5 infections and 1,345 indexed breach records.

**The zero-false-positive property was re-verified after every change:** `torvalds` →
`found: 13`, `zzqx9v7nonexistent42` → `found: 0`, both with `checked: 24` and `manual: 19`.

**Domain latency is now bimodal.** The old 8.16 s worst case (`example.com`) is 0.42 s.
`cloudflare.com` still takes 7.2 s — but the per-source timing attributes it to Certspotter,
not the crt.sh fallback that was fixed. See §8.6.

---

## 3. Defects found — and what was done

### P0 — fixed

**3.1 `next@16.2.10` carried 9 high-severity advisories, one targeting the exact feature used for auth.**

[GHSA-6gpp-xcg3-4w24](https://github.com/advisories/GHSA-6gpp-xcg3-4w24) —
*"Middleware / Proxy bypass in App Router applications using Turbopack"*. The app
implements its CSRF guard and HTTP Basic auth gate in `src/proxy.ts` and builds with
Turbopack, and the README recommends `AUTH_PASSWORD` as the control for LAN exposure.

> I confirmed the version was in the affected range and that the app used the affected
> feature combination. I did **not** attempt to exploit it. It was "patch now", not
> "you are breached".

**Fixed:** `next` and `eslint-config-next` → `^16.2.12`. `postcss` and `sharp` resolved via
overrides (`sharp` → `^0.35.3`; it is unreachable anyway — `images.unoptimized: true` and
the app renders plain `<img>`, never `next/image`). The dead `@eslint/eslintrc`
devDependency was removed.

**`npm audit --omit=dev` is now clean: 0 vulnerabilities.**

**Residual, disclosed:** the full tree still reports 9 dev-only advisories, all rooting in
`brace-expansion` reached via `minimatch@3`, which is bundled inside
`eslint-config-next`'s own plugins. There is no fixed 1.x/2.x/3.x/4.x of `brace-expansion`
— only 5.0.8 — and forcing it breaks `minimatch@3`'s API (verified: lint crashes).
Upgrading to ESLint 10 also fails (`eslint-plugin-react` throws
`contextOrFilename.getFilename is not a function`). This chain is dev-tooling only, never
bundled, and reachable only via a glob pattern the repo owner writes. It needs an upstream
`eslint-config-next` release.

### P1 — fixed

**3.2 The rate limiter was one global bucket, not per-IP.**

`getClientIp()` returned a hard-coded `"127.0.0.1"` unless `TRUST_PROXY=1`, so the whole
installation shared **10 lookups per minute across all modes and all users**. Measured
before: 12 requests across 6 modes → 429 at request 11.

**Fixed** in `src/lib/server/rateLimit.ts`:
- Real client keys: trusted-proxy IP → first-party `hv_rl` cookie (one bucket per browser,
  minted by `src/proxy.ts`) → shared bucket for non-browser clients.
- `RATE_LIMIT_MAX` (default **60/min**), `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_GLOBAL_MAX`
  (default 600/min) — a server-wide ceiling so a cookie-discarding script can't exhaust a
  free upstream tier. A request rejected by the ceiling is **not** charged to the client.
- One `guardRateLimit()` helper used by all six lookup routes, so headers are identical
  everywhere and on every status. `bulk-lookup` previously sent none at all.
- New `X-RateLimit-Scope` header says whether your own limit or the global one is binding.

Measured after, same 12-request trace: all 200, `remaining` counting 59→48, and a second
client's first request still at `remaining=59`.

**3.3 Adding an API key did not invalidate cached results.**

A keyless result stayed cached for 24 h, so adding a key in the UI appeared to do nothing
and the reasonable conclusion was "the key is broken".

**Fixed:** both caches now live in `src/lib/server/cache.ts`, and `keyStore` clears them on
any successful `setKey` / `clearKey` / `clearAllKeys`. Env-supplied keys need a restart,
which empties the in-memory maps anyway. Regression-tested in
`tests/keyCacheInvalidation.test.ts`, including that a *rejected* mutation leaves the
caches alone.

**3.4 The OpenAPI spec documented 3 of 11 endpoints.**

**Fixed structurally.** The spec is now generated at request time from a declarative
registry (`src/lib/api/endpoints.ts`) plus the source manifest, and
`tests/openapiCoverage.test.ts` walks `src/app/api/**/route.ts`, extracts the exported HTTP
methods, and fails the build if the registry and the routes disagree in either direction.

Verified live: **12 paths, 17 operations** — up from 3 paths. The description also states
the limits *this instance* is running rather than numbers baked in when the doc was
written.

### P2 — fixed

**3.5 Three different source-result shapes across three routes.**

**Fixed:** every lookup mode now emits a uniform `sourceHealth: SourceProvenance[]`
(`{ source, ok, ms, fetchedAt, error?, skipped? }`) alongside its typed payloads.
`skipped` distinguishes "no API key configured" from "called and failed" — colouring an
unconfigured optional source red made a healthy keyless install look broken.

`/api/sources` now reports each source's **last observed call** (ok, latency, error), not
just whether a key is present, plus the live runtime limits.

**3.6 API routes and `src/proxy.ts` were outside the 100% coverage gate.**

**Fixed.** `vitest.config.ts` now includes `src/app/api/**/route.ts` and `src/proxy.ts`.
Bringing them in went from 94.31% statements / 89.99% branches to 100%/100%, and took
**299 new tests** across 11 new files — covering every provider success path, every HTTP
error code, every timeout, every sparse-payload default, and the auth/CSRF gate (which had
**zero** direct tests). Genuinely unreachable defensive branches carry a
`/* v8 ignore */` naming why.

**3.7 Stale doc claims.** All corrected: `/api/docs` "8 endpoints" → **17 operations
across 12 endpoints**; "The 15 sites that return HTTP 200 for every handle" → **19**;
rate-limit badge; caching and rate-limiting prose. The username-site count was corrected
twice — see §8.10, where the first correction turned out to be wrong too.

### Defects found *during* the remediation

**3.8 `threatScore` could serialise as `null`.** An IPQS `success: true` response that
omitted `fraud_score` reached the threat maths as `undefined` → `NaN` → JSON `null`,
rendering a broken bar. Now coerced: only a finite number is accepted, otherwise the field
is honestly `null` and the score stays a number.

**3.9 Username sweep health counted sites it never contacted.** The initial health
predicate looked at all hits, but `manual` sites are never fetched — so the sweep reported
healthy even when every real probe had failed. Now judged on auto-checked sites only.

**3.10 Manifest ids didn't match the ids routes emit.** `/api/sources` showed
`xposedOrNot` and `ipApi` as "never called" moments after they had answered. The manifest
now names sources exactly as the routes report them, split to 1:1 (ip-api / Shodan /
GreyNoise; dns / whois / subdomains / wayback), and
`tests/sourceManifestAlignment.test.ts` drives every mode and asserts the two agree in
both directions.

**3.12 The test suite could write into the developer's real `.data/`.** Route handlers
persist through `HV_DATA_DIR` (audit log, cases, keys). Any test that exercised a route
without setting its own temp dir wrote into `./.data` — polluting real cases and the audit
log. This bit during this very session. Fixed two ways: `vitest.config.ts` now sets
`HV_DATA_DIR` to a git-ignored `.vitest-data/` for the whole run, so no test can reach the
real directory even if it forgets; and the four duplicated `dataDir()` definitions
(audit log, case store, key store, dataset loader) were consolidated into
`src/lib/server/dataDir.ts` with its own tests.

**3.11 Hudson Rock was advertised for email but never called there.** The old hardcoded
registry and README claimed phone **+ email** infostealer coverage; the email route makes
no such call and no email panel renders it. Corrected to phone-only rather than left as an
overstatement. (Cavalier does accept an email — wiring it up is real work, listed below.)

---

## 4. Gap analysis vs the stated goal — now closed

The README's goal: *"analysts spend significant time manually pivoting across 20–30
separate tools… HEAVEN-GeoIntel centralises that workflow into one console."*

| Gap (as filed) | Status |
|---|---|
| **No cross-identifier auto-pivot** | **Closed** — §8.1 |
| **Phone has no free enrichment** | **Closed** — §8.2 |
| **No result diffing / monitoring** | **Closed** — §8.5 |
| **Hudson Rock not wired to email** | **Closed** — §8.3 |
| **Graph is browser-local** | **Closed** — §8.4 |
| **No case-level unified export** | **Closed** — §8.7 |
| **Domain fanout latency** | **Partly** — the 8.16 s case is gone; a different cause remains. §8.6 |

---

## 5. "Dynamic" — what changed

Previously **every knob was a compile-time constant**. Now:

| Was static | Now |
|---|---|
| 10 req/min, 60 s window | `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_GLOBAL_MAX` |
| 24 h TTL, 1000/500 entries | `CACHE_TTL_MS` / `CACHE_MAX_ENTRIES` / `EMAIL_CACHE_*` |
| 8 s source timeout, fanout width | `SOURCE_TIMEOUT_MS` / `FANOUT_CONCURRENCY` |
| 5 datasets, 2,165 lines, rebuild to change | `.data/datasets/*.json` overlays — add, replace or remove entries; `POST /api/datasets` reloads without a restart |
| 43-site username catalog | overlay-extensible, with per-entry validation |
| Source registry hardcoded in `/api/sources` | generated from `src/lib/sources/manifest.ts` |
| OpenAPI spec hand-written, 3/11 | generated from a route registry, 17/17, drift-guarded by a test |

Junk env values fall back to the default and are clamped, so a typo cannot disable rate
limiting. A malformed dataset overlay is ignored with a warning rather than being fatal,
and username-site entries are validated individually — a `body`-check site with no absence
marker would claim every handle as FOUND, so it is rejected rather than trusted.

Verified live on a running server: dropping in an overlay and calling `POST /api/datasets`
added a site, removed a bundled one, and replaced a third in place (Codeberg `manual` →
`status`), moving the sweep from 43 sites/24 checked to 42 sites/25 checked — with no
rebuild and no restart.

---

## 6. Phases 3 & 4 — what shipped

See §8 for the detail and the measurements. In one line each:

1. **Auto-pivot engine** — every result offers the identifiers it derived as one-click lookups.
2. **Free phone enrichment** — LeakCheck lifts phone from 1 keyless source to 2.
3. **Hudson Rock for email** — the endpoint that was advertised and never called.
4. **Server-side graph** — derived links persisted per case, labelled with their source.
5. **Case snapshots + diffing** — "re-run this and tell me what changed".
6. **Domain CT fallback** — capped; the measured worst case moved to a different source.
7. **Unified case export** — schema v2 carries the graph and the change history.
8. **Optional case lock** — `CASE_PASSWORD` seals cases while lookups stay open.

---

## 7. What was not changed

No commits were made — per your workflow, commits are yours. No GitHub action of any kind
was taken. The dev server has been stopped. The changes are source, tests, docs and
`package.json` / `package-lock.json` only.

**One caveat, stated plainly:** during the Phase 0–2 work the test suite did briefly write
into the real `.data/` — a stray case named `"X"` and two audit-log lines, all created by my
own test runs. Both files were restored to their prior state (`cases.json` back to `[]`,
which is what it contained before; `audit.log` emptied, and both of its lines were
timestamped inside this session). No pre-existing case or log entry was lost. §3.12 above
describes the guard that now makes this impossible, and every live run since — including
all of the Phase 3/4 probing — used a scratch `HV_DATA_DIR` outside the repo.

---

## 8. Phases 3 & 4 — detail and measurements

### 8.1 Cross-identifier auto-pivot — the headline gap

`src/lib/analysis/autoPivot.ts` reads a finished result and returns the identifiers it
already contains, each runnable in one click: a domain's MX host and NS records, a
Gravatar-linked handle, an IPQS-associated email, a FullContact phone, an XposedOrNot
breach domain, an unmasked infostealer IP.

Four rules the module holds itself to, each enforced by a test:

- **Pure.** No network, no clock. The panel renders in the same paint as the result.
- **Never invent.** Every value appeared verbatim in the response. An email is never
  synthesised from a username, a phone never built from a country code.
- **Validate by kind.** A value is offered only if it passes the shape check for the mode
  it would be handed to, so a malformed upstream field can't produce a dead-end lookup.
- **Drop masked values.** Hudson Rock's free tier returns `82.167.***.**` and
  `i****@gmail.com`. Those are evidence, not identifiers — the shape checks reject them
  because `*` is not legal in any of the five kinds.

Confirmed links (an upstream asserts the association) are ranked and rendered separately
from related ones (a mail host, a breached site, an infected machine) rather than being
flattened into one list.

### 8.2 Free phone enrichment — 1 keyless source → 2

**LeakCheck's public endpoint** is keyless and answers for **three** of the five modes, so
it lives in `src/lib/server/leakCheck.ts` rather than inline in a route. It reports how
many indexed breach records mention an identifier, which field types were exposed, and the
named breaches. It returns no credentials — that is the paid tier — so everything surfaced
is exposure metadata.

Two accuracy details, both found by probing the live endpoint rather than reading docs:

- A phone in `+E.164` form is **rejected** with *"Could not determine search type
  automatically"*. Bare digits plus an explicit `type=phone` work. The route sends the
  latter.
- The endpoint answers **HTTP 200 with `success: false`** for both "no records" *and* a
  refused query. Only the not-found message is treated as a clean result; anything else is
  a failed call. Without that split, a malformed query would have been shown to the analyst
  as "this identifier is clean".

Measured, keyless, against the live endpoint: `+919876543210` → Hudson Rock 3 infections,
LeakCheck 78 records across 13 named breaches. Phone's keyless answer is no longer thin.

### 8.3 Hudson Rock for email

The manifest and README claimed phone **+ email** infostealer coverage that the email route
never called — §3.11 corrected the *claim* rather than expanding scope, and flagged wiring
it up as real work. It is now wired.

Cavalier needs a different endpoint per identifier shape (`search-by-email` for an address;
`search-by-username`, which the phone route uses, returns HTTP 400 *"Email is required"*).
Both now go through `src/lib/server/hudsonRock.ts`, and `InfostealerPanel` was made
mode-agnostic so one component serves both dashboards.

Measured: `test@example.com` → 5 infections, rendered in the email dashboard.

### 8.4 Server-side graph

`InvestigationCase` gained `edges: CaseEdge[]` — `{ from, to, reason, addedAt }`. The
`reason` is the verbatim auto-pivot string, so the stored graph records *why* two
identifiers are linked, which the old `localStorage` graph could never say.

`LinkGraph` draws those as dashed edges between real nodes, on top of the membership
spokes. Only links whose **both** ends were actually pinned are persisted — an edge to an
identifier the analyst chose not to pin would put a phantom node in the case graph.

Verified live: edges survived a fresh read from a new process; a self-edge was dropped.

### 8.5 Case snapshots + diffing

A snapshot is deliberately **not** the whole response — that would balloon the case file
and pin PII on disk indefinitely. Each mode reduces to a small bag of scalars worth
watching (breach counts, open ports, subdomain totals, registrar, DMARC policy).

Three deliberate choices:

- **The diff is computed server-side, against what is on disk.** A client-side diff could
  only compare against what it happened to still have in memory — exactly the state that is
  lost between sessions.
- **A first snapshot is a `baseline`, never "no change".** Those are different claims.
- **`fromCache` is recorded.** Otherwise an empty diff is ambiguous: nothing moved
  upstream, or we compared a cached result with itself. The UI says which.

`defined()` drops facts a source could not answer, so "we don't know" never diffs as "zero".

Verified live: baseline → re-run reported `subdomains 1 → 4` and `dnssec — → signed`.

### 8.6 Domain CT fallback — fixed, and honestly reported

crt.sh was given an 8 s timeout and a slow crt.sh spent all of it. It is now capped at
**2.5 s**, and since it only ever *adds* to an already-usable Certspotter set, cutting it
short costs at most some extra subdomains.

| Domain | Before | After |
|---|---|---|
| `example.com` (the 8.16 s case) | **8.16 s** | **0.42 s** |
| `nasa.gov` | 2.42 s | 2.28 s |
| `github.com` | 0.83 s | 0.64 s |

**I also tried the faster design and rejected it.** Firing both CT logs concurrently and
aborting crt.sh once Certspotter proved sufficient is better on paper, but it sends a query
to a free public CT front end on *every* domain lookup, and an abort only stops us reading
the response — crt.sh has already started the work. Staying sequential keeps the common
case at zero crt.sh requests. A test asserts that.

**What is NOT fixed, measured:** `cloudflare.com` still takes **7.2 s**, and the
per-source timing says why — Certspotter itself spent 7.16 s. That is the *primary* source
on a certificate-heavy domain, not the fallback, so capping it would lose the main data and
then trigger the fallback anyway. The roadmap item said "sub-2 s worst case"; the case it
named is now 0.42 s, but the overall worst case is a different, still-open cause.

### 8.7 Unified case export

Report schema **v2** carries the derived graph and the snapshot history alongside the
identifiers, and the Markdown report gained a **Derived links** table and a **Change
history** section rendering what moved between consecutive snapshots.

v1 reports still verify: the integrity hash covers the canonical payload, so
`verifyCaseImport` re-hashes a v1 file against the *v1* payload shape. Re-hashing it as v2
would have added two empty arrays to the canonical form and reported every old export as
tampered.

One subtlety the tests surfaced: because the hash covers the *canonical* payload, junk
appended to a report that doesn't survive sanitisation leaves the hash matching. That is the
correct answer about the **case**, but silent about the **file** — so `verifyCaseImport` now
also returns `dropped`, the count of unparseable rows discarded. A verified report with
`dropped > 0` means someone edited the file even though nothing an analyst would act on
changed.

### 8.8 Optional case lock

`AUTH_PASSWORD` gates the whole app, which is all-or-nothing. Cases are the only thing on
disk that accumulates investigation targets and survives restarts, so `CASE_PASSWORD` seals
`/api/cases` while leaving lookups open. Unset — the default — is a complete no-op.

A cookie rather than HTTP Basic, because the cases UI talks to `/api/cases` with `fetch()`:
a 401 from `fetch()` does **not** make the browser prompt for credentials, so a Basic realm
here would simply break the panel. The token is an HMAC over its own expiry, keyed by the
password — no session table, rotating the password invalidates every outstanding token, and
the expiry can't be extended by editing the cookie.

Verified live with `CASE_PASSWORD=hunter2`: GET/POST/DELETE on `/api/cases` all 401,
`/api/lookup` still 200, wrong password 401, correct password issued the cookie and every
call succeeded after.

### 8.9 A defect found by the live run

`malwareFamily` fell back to the executable's bare filename when it recognised no known
family. A live Hudson Rock lookup returned a dropper at `.../45AmJcDpU.exe`, so the malware
badge rendered **"45AMJCDPU"** — a random token presented as a malware identification.

Fixed: the family is now Cavalier's own `stealer_family`, or a name from the known-family
list, or **null**. The infection is still reported; we no longer claim to know which strain
caused it. An empty badge is the honest answer.

### 8.10 Found while preparing the 2.0.0 release

Three things the release pass turned up, all now fixed:

**The version had already drifted three ways.** `package.json` and `/api/health` said
`1.3.0`, the generated OpenAPI spec said `1.4.0`, and the outbound User-Agent said `1.3`
— eight hand-written literals across eight files. They now derive from
`src/lib/version.ts`, and `tests/versionSync.test.ts` fails the build if `package.json`,
`package-lock.json`, `docker-compose.yml`, `SECURITY.md`, `scripts/start.sh`, the
README's docker commands or the changelog fall out of step with it.

**The username-site count was wrong, and §3.7 above had "corrected" it to another wrong
number.** The README advertised **47 sites, 28 auto-verified**. The bundled catalog holds
**43, of which 24 are auto-verified and 19 manual** — which is what the live sweep had
been reporting as `checked: 24 / manual: 19` in every measurement in this document,
including §5's overlay demo ("43 sites/24 checked"). The claim was corrected in all seven
places it appeared. The lesson is the one this project keeps re-learning: a number typed
into prose is a number that will be wrong later. The poster now derives it.

**`.env.example` documented 11 of 22 environment variables.** Everything Phase 2–4 added
— the rate-limit, cache, timeout and concurrency knobs, `CASE_PASSWORD`,
`CASE_UNLOCK_TTL_MS`, `CASE_SNAPSHOT_HISTORY`, `HV_DATA_DIR`, `FORCE_HTTPS` — existed and
worked, but the file a new user copies to `.env.local` never mentioned them. All present
now, each with its real default and the range it is clamped to.

---

---

## 9. Still open

Nothing from the original gap list. What I would look at next, in order:

1. **Certspotter latency on certificate-heavy domains** (§8.6) — the current worst case.
2. **Scheduled re-runs.** Snapshots make diffing possible but still require a manual pin.
   A cron that re-runs a case and reports changes is the natural next step.
3. **The dev-only `brace-expansion` advisory chain** (§3.1) — needs an upstream
   `eslint-config-next` release.
