# Release checklist

The version is declared once, in [`src/lib/version.ts`](../src/lib/version.ts), and
`tests/versionSync.test.ts` holds every other file to it. What no test can see is
**git**: a tag is created outside the working tree, so a perfectly consistent
checkout can still be published under a tag pointing at the commit *before* the
bump. That is the failure this checklist exists to prevent, and `npm run
release:verify` is the step that catches it.

---

## 1. Prepare the tree

```bash
npm version <major|minor|patch> --no-git-tag-version
```

Then, in order:

1. Set `APP_VERSION` in `src/lib/version.ts` to the same number.
2. Move the CHANGELOG's `[Unreleased]` body under `## [x.y.z] — YYYY-MM-DD`, and
   leave a fresh empty `[Unreleased]` above it. A major or minor release gets an
   explicit **Breaking / upgrade notes** section; a patch release states plainly
   whether anything needs migrating.
3. If the `major.minor` changed, add it to the supported table in
   [`SECURITY.md`](../SECURITY.md). A table that omits the release you just
   shipped tells a reporter their finding is out of scope.
4. `npm run brand`; the poster and the terminal banner print the version.
   (`npm run brand:poster` alone is enough if the mark itself did not change;
   the full script also rasterises PNGs and needs Chrome.)

## 2. Run the gate

```bash
npm run lint && npm run typecheck && npm run test:coverage && npm run build
```

`versionSync` and `posterAssets` are the two suites that catch a half-done bump.
Coverage is gated at 100%; a release is not the time to discover otherwise.

## 3. Commit, then tag, in that order

The tag must land on the commit that **contains** the bump. Tagging first, or
tagging `HEAD~1` out of habit, publishes a release whose contents contradict its
own name.

```bash
git add -A && git commit -m "chore: release vx.y.z"
git tag -a vx.y.z -m "HEAVEN-GeoIntel vx.y.z"
```

## 4. Verify the tag, then push

```bash
npm run release:verify
```

This reads the tag itself (`git show vx.y.z:src/lib/version.ts`) rather than
the working tree, and refuses the release if the two disagree. It also confirms
the tree is clean, the CHANGELOG has a dated section for this version, and
`npm audit` reports zero advisories.

Only push once it passes:

```bash
git push && git push origin vx.y.z
```

## 5. The release publishes itself

Pushing the tag triggers
[`.github/workflows/release.yml`](./workflows/release.yml). There is nothing to
click. It:

1. **Re-verifies the tag**: the same check `release:verify` runs locally, but
   from the tagged commit, where it cannot be skipped. If `src/lib/version.ts`
   or `package.json` disagrees with the tag name, or the CHANGELOG has no dated
   section for it, the workflow fails and no release is created.
2. **Runs the full gate** against that commit: lint, type-check, 100% coverage,
   production build, `npm audit`. A release page that claims zero
   vulnerabilities is checked rather than typed.
3. **Packages** a source tarball (`git archive` from the tag), a runnable
   standalone bundle (`node server.js`, no `npm install`), an SPDX SBOM, and a
   `SHA256SUMS.txt` covering all three.
4. **Publishes** as `HEAVEN vx.y.z`, with the body generated from this version's
   CHANGELOG section, marked latest, or as a pre-release if the version carries
   a `-rc`/`-beta`/`-alpha` suffix.

To re-publish an existing tag without moving it, run the workflow manually from
the Actions tab and pass the tag name.

The release body comes from the CHANGELOG, so the quality of the release page is
the quality of that section. Write it to read in this order:

1. **What this release is**, in two or three sentences, and why the version
   number moved.
2. **What changed**, grouped by area, each item saying what changed *and why it
   mattered*. Numbers must be measured, not estimated.
3. **Breaking changes**: old → new, or an explicit "none".
4. **Upgrading**: including "nothing to migrate" when that is the answer.

Disclose what is *not* fixed. A release page that only lists wins reads like
marketing, and the next reader finds the omission anyway.

## 6. After publishing

- Check the poster renders on the release page. It is pinned to
  `raw.githubusercontent.com/<owner>/<repo>/vx.y.z/public/brand/poster.svg`, so
  it only resolves once the tag is pushed.
- Download one asset and run `sha256sum -c SHA256SUMS.txt`. The workflow
  generates the sums; nobody has ever checked they match until someone does.
- If an earlier release page stated something this one fixes, add a one-line
  update pointing forward to this version. Do not rewrite the old page; a
  release note is a record of what shipped.
