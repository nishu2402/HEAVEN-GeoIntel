import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── The tag is the release ───────────────────────────────────────────────────
//
// v3.2.0 was bumped, gated, committed, tagged and pushed, and did not release.
// `git push` does not carry tags, release.yml triggers on the tag push, so no
// run ever started. Nothing was red. The Releases page simply kept naming
// v3.1.0 as latest, and the only way to notice was to go and look.
//
// Two things hid it. `git push --follow-tags` carries ANNOTATED tags only, and
// `git tag -f vx.y.z` creates a lightweight one, so the habit that exists to
// prevent this skipped the tag it was there for. And `npm run release:verify`
// printed "Ready to publish v3.2.0" with every check green, having read nothing
// but the local repository.
//
// release-tag.yml closes it: a push to main that declares an unreleased version
// gets tagged and handed to release.yml. What this suite pins is the handful of
// couplings whose failure mode is silence — a tag created and no release, or a
// release nobody asked for — because that is the class of bug that cost a day
// the first time.
//
// String checks against the raw YAML, matching releaseNotes.test.ts and
// dockerPublish.test.ts: this project has no YAML parser dependency.

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const tagger = read(".github/workflows/release-tag.yml");
const release = read(".github/workflows/release.yml");
const verify = read("scripts/release-verify.mjs");

/**
 * Comments stripped before asserting a string is absent. Every one of these
 * files *describes* the bug it fixes, and that prose is the most useful part of
 * the change — a guard that forbade naming the old behaviour would push the
 * next reader into repeating it.
 */
const code = (src: string, comment: RegExp) =>
  src
    .split("\n")
    .filter((l) => !comment.test(l.trim()))
    .join("\n");

describe("a push to main carries the release", () => {
  it("triggers on every push to main, not just on the commit that edits the version", () => {
    expect(tagger).toMatch(/^on:$/m);
    expect(tagger).toMatch(/^\s+branches: \[main\]$/m);
    // No `paths:` filter. The bump and the release readiness need not land in
    // the same commit and did not here: 58c4729 moved APP_VERSION to 3.2.0 and
    // the tree only became releasable two commits later. A path filter would
    // watch the one commit that cannot be tagged yet and miss the one that can.
    expect(tagger).not.toMatch(/^\s+paths:/m);
  });

  it("tags only a version whose CHANGELOG section is dated", () => {
    // release.yml refuses a tag with no dated section, so tagging a bump that
    // is not written up yet would manufacture exactly the red release run this
    // change exists to prevent.
    expect(tagger).toMatch(/grep -qE "\^## \\\[\$\{VERSION\/\/\.\/\\\\\.\}\\\] — \[0-9\]\{4\}-\[0-9\]\{2\}-\[0-9\]\{2\}\$" CHANGELOG\.md/);
  });

  it("stands down instead of failing when the commit is not a release", () => {
    // Most pushes to main are not releases. A workflow that goes red, or even
    // yellow, on ordinary commits is one nobody reads by the third week — and
    // an ignored release workflow is how this bug survives its own fix.
    expect(tagger).toMatch(/skip\(\) \{ echo "::notice::\$1"; echo "tag=" >> "\$GITHUB_OUTPUT"; exit 0; \}/);
    expect(tagger).toMatch(/if: steps\.state\.outputs\.tag != ''/);
  });

  it("never touches a tag the remote already has", () => {
    // The idempotence that makes a manual `git push origin vx.y.z` still work:
    // that push starts release.yml on its own, and this job must see the tag
    // and stand down rather than open a second run against it.
    expect(tagger).toContain('git ls-remote origin "refs/tags/${TAG}" "refs/tags/${TAG}^{}"');
    // Both spellings are asked for on purpose: `^{}` is an annotated tag's
    // target, and a lightweight tag has only the bare ref. v3.1.0 is lightweight
    // and would be invisible to a check that asked for `^{}` alone.
    expect(tagger).toMatch(/\^\{\}/);
  });

  it("creates an annotated tag, which is the one the tooling can see", () => {
    expect(tagger).toContain("github.rest.git.createTag(");
    expect(tagger).toContain("github.rest.git.createRef(");
    expect(tagger).toMatch(/message: `HEAVEN-GeoIntel \$\{tag\}`/);
  });

  it("asks release.yml to run, because a token-created tag raises no push event", () => {
    // The trap underneath the whole design: GitHub suppresses events from
    // anything GITHUB_TOKEN created, so the tag would land and release.yml
    // would never hear about it. workflow_dispatch is the documented exception.
    expect(tagger).toContain("github.rest.actions.createWorkflowDispatch(");
    expect(tagger).toMatch(/workflow_id: "release\.yml"/);
    expect(tagger).toMatch(/inputs: \{ tag \}/);
  });

  it("holds exactly the two permissions it needs, stated on the job", () => {
    expect(tagger).toMatch(/^permissions:\n\s+contents: read$/m);
    expect(tagger).toMatch(/contents: write\s+#/);
    expect(tagger).toMatch(/actions: write\s+#/);
  });
});

describe("the dispatch contract between the two workflows", () => {
  it("release.yml still takes the tag input release-tag.yml passes it", () => {
    // If this input is renamed or dropped, the tag is still created and nothing
    // publishes: the silent half-failure, one rename away, in another file.
    expect(release).toMatch(/^\s+workflow_dispatch:$/m);
    expect(release).toMatch(/^\s+tag:$/m);
    expect(release).toMatch(/required: true/);
    expect(release).toMatch(/\$\{\{ inputs\.tag \|\| github\.ref \}\}/);
    expect(release).toMatch(/\$\{\{ inputs\.tag \|\| github\.ref_name \}\}/);
  });

  it("release.yml still verifies the tag itself, so tagging automatically proves nothing", () => {
    // The point worth keeping straight: release-tag.yml decides only WHETHER to
    // tag. Every guarantee about what gets published still comes from here.
    expect(release).toMatch(/needs: verify/);
    expect(release).toContain("npm run test:coverage");
    expect(release).toContain("node scripts/audit-gate.mjs --github");
  });
});

describe("release:verify reads the remote, which is where a release actually happens", () => {
  it("asks origin whether the tag is published", () => {
    expect(verify).toContain("ls-remote");
    expect(verify).toContain("refs/heads/main");
  });

  it("no longer signs off with a verdict it cannot support", () => {
    // It said "Ready to publish v3.2.0", eight checks green, about a release
    // that had not been published and would not be. The closing line now names
    // what is still undone, in the command that does it.
    expect(code(verify, /^(\/\/|\*|\/\*)/)).not.toMatch(/Ready to publish/);
    expect(verify).toContain("git push origin main");
  });

  it("warns that a lightweight tag is the one --follow-tags will skip", () => {
    expect(verify).toContain("--follow-tags");
    expect(verify).toMatch(/cat-file", "-t"/);
  });
});
