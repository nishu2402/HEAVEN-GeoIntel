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
4. Refresh the six numbers in `scripts/generate-release-banner.mjs`: tests and
   coverage from the gate you are about to run, and identifiers, sources, modes
   and API operations from `scripts/poster-stats.mjs`. They are typed in, and
   nothing in the build compares them with anything, so this is the one step no
   test will fail for you. It had drifted by 91 tests before anyone noticed.
5. `npm run brand`; the poster, the terminal banner and the release banner all
   print the version. Run the full script, not `brand:poster` alone: the release
   banner under `docs/assets/` carries the version too, and skipping it ships a
   release page still advertising the previous one. The full script rasterises
   PNGs and needs Chrome.

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

`-a` is not decoration. `git tag -f vx.y.z` creates a **lightweight** tag, and
`git push --follow-tags` carries annotated tags only, so the habit that exists
to stop a tag being left behind silently skips a lightweight one. That is how
v3.2.0 came to sit unpublished: the tag existed, on the right commit, on one
machine. `git cat-file -t vx.y.z` answers `tag` for an annotated tag and
`commit` for a lightweight one, and `release:verify` says so too.

## 4. Verify the tag, then push

```bash
npm run release:verify
```

This reads the tag itself (`git show vx.y.z:src/lib/version.ts`) rather than
the working tree, and refuses the release if the two disagree. It also confirms
the tree is clean, the CHANGELOG has a dated section for this version, and
`npm audit` reports zero advisories. Then it asks **origin** whether this
release is actually published, and its closing line tells you what is left to
do. Everything above that line is about a laptop; only the tag on origin is a
release.

Only push once it passes:

```bash
git push --follow-tags
```

## 5. The release publishes itself

Pushing the tag triggers
[`.github/workflows/release.yml`](./workflows/release.yml), and if the tag does
not arrive, [`release-tag.yml`](./workflows/release-tag.yml) creates it: any
push to `main` declaring a version that has a dated CHANGELOG section and no tag
on the remote gets tagged and handed to the release workflow. So the push above
is enough on its own, and forgetting the tag costs nothing.

That backstop exists because forgetting it once cost a day. v3.2.0 was bumped,
gated, committed, tagged and pushed, and did not release: `git push` does not
carry tags, so no run started, nothing went red, and the Releases page kept
naming v3.1.0 as latest with no signal anywhere that it was wrong.

Either way, there is nothing to click. The release workflow:

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
4. **Publishes** as `HEAVEN-GeoIntel vx.y.z`, with the body generated from this
   version's CHANGELOG section, marked latest, or as a pre-release if the
   version carries a `-rc`/`-beta`/`-alpha` suffix.

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

## If the release did not appear

Check in this order. The first question is the one that has actually been wrong:

```bash
git ls-remote origin refs/tags/vx.y.z   # nothing printed? the tag never left the laptop
gh run list --workflow=release.yml      # a run at all? red, or absent entirely?
gh release list                          # published, but perhaps as a draft or pre-release
```

No tag on origin means no run was ever started, and there is nothing to debug
in the workflow. Push `main` and `release-tag.yml` will tag it; or push the tag
yourself. A run that exists and failed is the ordinary case: read it, fix the
commit, and move the tag with `git tag -f -a vx.y.z` followed by a force push of
the tag, which starts the workflow again.
