# Contributing to HEAVEN-GeoIntel

Thanks for considering a contribution. This project is built and maintained
by individuals on their own time, so please be patient with reviews.

## Quick start

The app runs on **Node.js 20.9+** (Next.js 16). `.nvmrc` pins **22**, which is
what CI uses and what you want locally: the brand generator needs Node 22.15+
for `module.registerHooks()`, so on 20.x everything works except
`npm run brand`.

```bash
git clone https://github.com/nishu2402/HEAVEN-GeoIntel.git
cd HEAVEN-GeoIntel
npm install
npm run dev            # http://localhost:3000
npm test               # Vitest
npm run test:coverage  # the gate: 100% on the gated files
npm run lint           # ESLint 9 (flat config)
npm run typecheck      # tsc --noEmit
```

## Ground rules

- **No fake data.** Every value rendered must come from libphonenumber,
  a bundled dataset, or a live API. Never render "N/A" or guess a value to
  fill a card; render nothing instead. For ambiguous results (e.g. a username
  site that blocks our check), show an honest "UNVERIFIED" state rather than a
  false positive.
- **No real-time tracking.** This tool returns metadata only. Pull requests
  that add live GPS, SS7, or interception capabilities will be closed.
- **TypeScript strict.** All new code must type-check with no `any`
  escape-hatches unless there is a written justification in a comment.
- **Mobile-first.** Test new UI at 360px before 1280px.
- **One source of truth per fact.** The version lives in
  `src/lib/version.ts`, the data sources in `src/lib/sources/manifest.ts`, the
  API surface in `src/lib/api/endpoints.ts`, the brand in `src/lib/brand/`.
  Never retype one of those facts somewhere else. A drift-guard test
  (`versionSync`, `sourceManifestAlignment`, `openapiCoverage`,
  `posterAssets`) will fail the build, which is the point.

## Pull-request checklist

Before opening a PR:

- [ ] `npm run lint` passes
- [ ] `node node_modules/typescript/bin/tsc --noEmit` passes
- [ ] `npm test` passes
- [ ] `npm run test:coverage` passes; the gated files are held at **100%**
      (statements/branches/functions/lines), so new gated code ships with tests
      or an explicit `/* v8 ignore */` for a genuinely defensive branch
- [ ] `node node_modules/next/dist/bin/next build` passes
- [ ] Screenshots attached for UI changes
- [ ] No new third-party data source without an entry in
      `src/lib/sources/manifest.ts` (the README table, `/api/sources` and the
      OpenAPI spec are all generated from it)
- [ ] No personal data in commits (test phone numbers should be `+14155552671` / `+14155552672`, Twilio's public test numbers)

## Adding a new OSINT data source

1. **Add one entry to `src/lib/sources/manifest.ts`**: `id`, `name`, `tier`
   (`free` or `key`), the `modes` that call it, and `unlocks` (shown verbatim
   in the UI, so write it for an analyst). This is the step that registers the
   source: `/api/sources`, the OpenAPI description and the in-app Sources
   screen all read from here. `tests/sourceManifestAlignment.test.ts` fails if
   a route emits a `sources` key with no manifest entry, or vice versa.
2. Add the fetch helper in the relevant route under `src/app/api/`
   (`lookup` phone · `email-lookup` · `username-lookup` · `ip-lookup` ·
   `domain-lookup`), keying its `sources` block by the manifest `id`.
3. Add the response shape to `src/lib/types.ts`.
4. Add a panel under `src/components/<feature>/` if the data warrants its own
   card, or extend an existing panel for a single signal.
5. If the source needs a key, add it to `src/lib/server/keyStore.ts`, list it
   in the entry's `keys`, give it a `signup` URL, and document it in
   `.env.example`. Do **not** hand-edit the OpenAPI document. It is generated
   from `src/lib/api/endpoints.ts` plus the manifest by
   `src/lib/api/openapi.ts` on every request.
6. If the source has a free tier, add it to the OSINT Pivot Matrix
   (`src/components/osint/OsintPivots.tsx`) with the correct access badge.
7. Validate user input **before** any outbound request and only interpolate it
   into a fixed host (no SSRF); follow the existing routes' pattern.

## Adding a new OSINT pivot link

In `src/components/osint/OsintPivots.tsx`, add an entry with:

- The exact URL that produces a result page (not a homepage)
- `access: "free" | "captcha" | "login" | "paid"`, verified by clicking
  in an incognito window
- A one-line description
- `usOnly: true` if the site only covers US numbers

If a link 404s or just redirects to a homepage, do **not** add it. We'd
rather show 30 working links than 80 links of which half are dead.

## Using the brand mark

Never hand-roll the logo or paste its path data into a component. The geometry,
colours and every renderer live in [`src/lib/brand/logo.ts`](./src/lib/brand/logo.ts):

| Need | Use |
|---|---|
| The mark in the UI | `<Logo>` / `<LogoLockup>` from `components/shared/Logo` |
| The mark in generated HTML (reports, exports) | `logoSvg({ mono })`: pass `mono: BRAND.ink` for anything bound for paper |
| The mark in a plain-text export | `asciiLetterhead([...])` |
| The product name / tagline / palette | `BRAND.name`, `BRAND.tagline`, `BRAND.green`, `BRAND.cyan`, `BRAND.ink` |
| The README poster | `posterSvg(stats, { theme })` from `brand/poster.ts` |
| The banner a shell script prints | source `scripts/banner.sh`, call `hv_banner` |

Two things that have bitten us:

- **`<Logo>` is deliberately hook-free** so it renders in server *and* client
  components. Don't add `useId`/`useState` to it; pass `idPrefix` instead.
- **The mark is `shrink-0` for a reason.** As a flex child an SVG has an auto
  min-width and gets crushed (a 30px mark collapsed to ~5px in the header). If you
  place it in a new flex row, check its *rendered* size, and check the wordmark's
  own bounding box too: it is `nowrap`, so it overflows a shrunk parent instead of
  widening it, and a box check on the container will not catch the collision. Test
  at 360px first, as above.

After changing the brand module, regenerate the committed assets:

```bash
npm run brand
```

That runs two generators: `brand:poster` writes the three README posters
(`public/brand/poster{,-light,-still}.svg`) and `scripts/banner.sh`, then
`generate-brand-assets.mjs` writes the favicon, app icons, OG image and hero.
Both are committed, because a fresh clone must not need a build step to print
its own banner.

**The poster states facts about the build** (version, source and mode counts,
how many sources need no key, the coverage floor), and every one of them is
read out of the registries at generation time, never typed. So:

- Adding a source or a mode makes the committed artwork *wrong*, and
  `tests/posterAssets.test.ts` fails with `stale generated asset — run
  npm run brand:poster`. Run it and commit the result.
- Don't edit the SVGs or `banner.sh` by hand. The test byte-compares them
  against what the generator would produce, so an edit there is reverted by
  the next regeneration anyway.
- The posters are self-contained on purpose: no external font, no linked
  image. GitHub's image proxy won't fetch either, so a "small" change like
  referencing a webfont silently breaks the README for everyone but you.

## Commit messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(pivots): add OSINT Industries to identity category
fix(api): handle Hudson Rock 429 response correctly
docs(readme): clarify Docker setup steps
chore(deps): bump next to the latest patch release
```

## Cutting a release

The version is declared once, in `src/lib/version.ts`, and
`tests/versionSync.test.ts` holds every file outside the module graph to it:
`package.json`, the lockfile, `docker-compose.yml`, `SECURITY.md`, the
launcher banner, the README's badge and docker tags, and the CHANGELOG
heading. So a release is: change the number, then run the gate and fix what it
tells you.

```bash
npm version <major|minor|patch> --no-git-tag-version
```

Then, in order:

1. Set `APP_VERSION` in `src/lib/version.ts` to match.
2. Move the CHANGELOG's `[Unreleased]` body under `## [x.y.z] — YYYY-MM-DD`.
   Breaking changes get an explicit **Breaking / upgrade notes** section. The
   whole point of the major number is that someone reads it before upgrading.
3. Add the new `x.y` to the supported table in `SECURITY.md`.
4. `npm run brand`; the posters print the version.
5. `npm run lint && npm run typecheck && npm run test:coverage && npm run build`.
   `versionSync` and `posterAssets` are the two that catch a half-done bump.
6. Commit, **then** tag `vx.y.z`, in that order, so the tag lands on the commit
   that contains the bump.
7. `npm run release:verify`. `versionSync` proves the *tree* is consistent; this
   proves the *tag* is, by reading `git show vx.y.z:src/lib/version.ts` rather
   than the working copy. A tag one commit early is invisible to every other
   check and publishes a release whose contents contradict its own name. It has
   happened here twice.
8. Push the tag. [`.github/workflows/release.yml`](./.github/workflows/release.yml)
   takes it from there. It re-runs the tag check and the full gate against the
   tagged commit, packages the source tarball, the standalone bundle, the SBOM
   and `SHA256SUMS.txt`, and publishes the release as `HEAVEN vx.y.z` with the
   body taken from this version's CHANGELOG section. Nothing is published if any
   step fails, so the release page cannot claim a gate that did not pass.

The full procedure, including the conventions for the GitHub release page
itself, is in [`.github/RELEASE_CHECKLIST.md`](./.github/RELEASE_CHECKLIST.md).

## Code of conduct

By participating you agree to the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).
See [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).

## Licensing

By contributing you agree that your contributions will be licensed under the
[MIT License](./LICENSE) plus the OSINT acceptable-use policy in the same file.
