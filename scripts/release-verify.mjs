#!/usr/bin/env node
/**
 * Pre-flight for a release tag.
 *
 *   npm run release:verify
 *
 * `tests/versionSync.test.ts` holds every file in the repo to `APP_VERSION`.
 * What it cannot see is git: a tag is created outside the working tree, so a
 * perfectly consistent tree can still be published under a tag that points at
 * the commit BEFORE the version bump. That has happened twice in this repo —
 * v2.0.0 landed on the commit before its own doc fixes, and v2.0.1 on a commit
 * still declaring 2.0.0 and still carrying the vulnerable lockfile it claimed
 * to fix. Nobody notices, because everything on disk looks right.
 *
 * So this checks the tag itself: what does `git show <tag>:...` actually
 * contain? Run it after tagging and before writing the release notes.
 *
 * Plain Node, no imports from src/ — it must run on any Node the project
 * supports, and it must work when the checkout is mid-release.
 */

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

/** Run git, returning null instead of throwing when the object does not exist. */
function git(...args) {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

const results = [];
const check = (ok, label, detail) => results.push({ ok, label, detail });

/** Escape a string for literal use inside a RegExp (backslash first). */
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Things worth seeing before publishing, none of which should stop a release. */
const notes = [];

// The version literal is parsed rather than imported: importing a TS module
// from plain Node needs the resolve hook, and this script has to run even when
// the tree is in a state where that would fail.
const version = read("src/lib/version.ts").match(/APP_VERSION\s*=\s*"([^"]+)"/)?.[1];
if (!version) {
  console.error("could not read APP_VERSION from src/lib/version.ts");
  process.exit(1);
}
const tag = `v${version}`;

// ── The tree ────────────────────────────────────────────────────────────────
const dirty = git("status", "--porcelain");
check(dirty === "", "working tree is clean", dirty ? `${dirty.split("\n").length} uncommitted file(s)` : "");

check(
  JSON.parse(read("package.json")).version === version,
  "package.json matches APP_VERSION",
  `package.json is ${JSON.parse(read("package.json")).version}`,
);

check(
  new RegExp(`^## \\[${escapeRegExp(version)}\\] — \\d{4}-\\d{2}-\\d{2}$`, "m").test(read("CHANGELOG.md")),
  "CHANGELOG has a dated section for this version",
  `no "## [${version}] — YYYY-MM-DD" heading`,
);

// ── The tag ─────────────────────────────────────────────────────────────────
const tagged = git("rev-list", "-n1", tag);
check(tagged !== null, `tag ${tag} exists`, `create it with: git tag -a ${tag} -m "…" HEAD`);

if (tagged) {
  // The check that matters. A tag on the wrong commit publishes a release whose
  // contents contradict its own name.
  const atTag = git("show", `${tag}:src/lib/version.ts`)?.match(/APP_VERSION\s*=\s*"([^"]+)"/)?.[1];
  check(
    atTag === version,
    `${tag} points at a commit declaring ${version}`,
    `it points at ${tagged.slice(0, 7)}, which declares ${atTag ?? "nothing readable"}. Retag with: git tag -f -a ${tag} -m "…" HEAD`,
  );

  const pkgAtTag = git("show", `${tag}:package.json`);
  check(
    pkgAtTag !== null && JSON.parse(pkgAtTag).version === version,
    `${tag}'s package.json declares ${version}`,
    `it declares ${pkgAtTag ? JSON.parse(pkgAtTag).version : "nothing readable"}`,
  );

  const head = git("rev-parse", "HEAD");
  check(tagged === head, `${tag} is on HEAD`, `HEAD is ${head?.slice(0, 7)}, the tag is on ${tagged.slice(0, 7)}`);
}

// ── The remote ──────────────────────────────────────────────────────────────
// Added after v3.2.0 was bumped, gated, committed, tagged and pushed, and did
// not release. `git push` does not carry tags; release.yml triggers on the tag
// push; so nothing ran, nothing was red, and the Releases page kept naming
// v3.1.0 as latest. This script had answered "Ready to publish v3.2.0" with
// eight checks green, because every one of them read the local repository.
//
// Not a check, deliberately: this is meant to be run BEFORE pushing, so an
// unpushed tag is the expected state and must not fail. It decides the closing
// message instead — what remains, in the exact commands that do it.
const remote = (() => {
  // One network call, capped: a pre-flight must not hang because a laptop is
  // on a captive-portal wifi.
  const out = (() => {
    try {
      return execFileSync("git", ["ls-remote", "origin", "refs/heads/main", `refs/tags/${tag}`, `refs/tags/${tag}^{}`], {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 15_000,
      });
    } catch {
      return null;
    }
  })();
  if (out === null) return null;
  const refs = new Map(out.trim().split("\n").filter(Boolean).map((l) => l.split("\t").reverse()));
  return {
    main: refs.get("refs/heads/main") ?? null,
    // An annotated tag's `^{}` line is the commit it points at; a lightweight
    // tag has only the bare ref, so the fallback is not optional.
    tag: refs.get(`refs/tags/${tag}^{}`) ?? refs.get(`refs/tags/${tag}`) ?? null,
  };
})();

const headSha = git("rev-parse", "HEAD");
const pushed = remote?.tag != null;

if (remote === null) {
  notes.push("could not reach origin, so whether this release is already published is unknown");
} else if (pushed && remote.tag !== tagged) {
  notes.push(`origin's ${tag} is on ${remote.tag.slice(0, 7)}, this one is on ${tagged?.slice(0, 7)}: git fetch --force --tags`);
} else if (!pushed && git("cat-file", "-t", tag) === "commit") {
  // Lightweight tags are what `git tag -f vx.y.z` produces, and they are the
  // reason the usual guard did not help: `git push --follow-tags` carries
  // annotated tags only, so it skips exactly the tag it was there for.
  notes.push(`${tag} is lightweight, so \`git push --follow-tags\` will skip it: git tag -f -a ${tag} -m "HEAVEN-GeoIntel ${tag}"`);
}

// ── The dependencies ────────────────────────────────────────────────────────
// Delegated to scripts/audit-gate.mjs rather than calling `npm audit` again,
// so this and the release workflow cannot drift into two different policies.
// The whole point of a pre-flight is that it fails here instead of after the
// tag is pushed, which it can only do if it applies the same rule.
let audit = null;
try {
  const run = () => execFileSync(process.execPath, [join(ROOT, "scripts/audit-gate.mjs"), "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 32 * 1024 * 1024,
  });
  try {
    audit = JSON.parse(run());
  } catch (err) {
    // The gate exits 1 when something blocks; the report is still on stdout.
    audit = JSON.parse(err.stdout ?? "");
  }
} catch {
  audit = null;
}

check(
  audit !== null && audit.blocking.length === 0,
  "no advisory reaches the published artifact",
  audit === null
    ? "the audit gate could not be run; see: npm run audit"
    : `${audit.blocking.length} blocking: ${audit.blocking.map((a) => `${a.package} (${a.severity})`).join(", ")}`,
);

// Not a check: dev-only advisories never block a release, but the release page
// prints the count, so the person publishing should see it first.
if (audit?.reported.length) {
  notes.push(`${audit.reported.length} dev-only advisory/advisories will be listed on the release page (npm run audit)`);
}
for (const s of audit?.suppressed ?? []) {
  notes.push(`allowlisted until ${s.expires}: ${s.package} ${s.id}`);
}

// ── Report ──────────────────────────────────────────────────────────────────
console.log(`\nRelease pre-flight: ${tag}\n`);
for (const { ok, label, detail } of results) {
  console.log(`  ${ok ? "✔" : "✘"} ${label}${ok || !detail ? "" : `\n      ${detail}`}`);
}
for (const note of notes) console.log(`  · ${note}`);

const failed = results.filter((r) => !r.ok).length;

// The last line is the one that gets read, so it says what is still undone
// rather than congratulating a tree nobody has published. "Ready to publish"
// was true and useless: it was printed, believed, and the release sat unpublished
// for a day because publishing is a push, and this script never looked at one.
if (failed > 0) {
  console.log(`\n${failed} check(s) failed. Do not publish ${tag} yet.\n`);
} else if (remote === null) {
  // Every other branch below is a claim about origin. Without origin, the only
  // honest thing to say is that the tree is ready and the release state is
  // unknown — stating "not published" here would be the same unbacked verdict
  // this section exists to stop printing.
  console.log(`\nReady. Could not reach origin, so whether ${tag} is already released is unknown:\n`);
  console.log(`    git ls-remote origin refs/tags/${tag}\n`);
} else if (pushed) {
  console.log(`\n${tag} is on origin. release.yml has it; the release page is whatever that run produced.\n`);
} else if (remote !== null && remote.main !== headSha) {
  console.log(`\nReady. Nothing is released until this is on origin:\n\n    git push origin main\n`);
  console.log(`That push is enough: .github/workflows/release-tag.yml creates the annotated ${tag} and starts`);
  console.log(`release.yml. To tag it by hand instead, follow the push with: git push origin ${tag}\n`);
} else {
  console.log(`\nReady, but ${tag} is not on origin, so nothing has been released.\n`);
  console.log(`main is already pushed, so tag it directly:\n\n    git push origin ${tag}\n`);
  console.log(`(An empty commit would also do it: release-tag.yml tags any push to main that declares an`);
  console.log(`unreleased version.)\n`);
}
process.exit(failed === 0 ? 0 : 1);
