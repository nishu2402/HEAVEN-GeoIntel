import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_VERSION } from "@/lib/version";
import { escapeRegExp } from "./escapeRegExp";

// ── The release page ─────────────────────────────────────────────────────────
//
// v3.1.0 shipped looking nothing like v3.0.0: it carried a raw
// `## [3.1.0] — 2026-09-08` heading, two separate `### Security` sections, no
// Install/verification/scope footer, and — the part that actually costs a user
// something — no downloadable assets at all.
//
// The cause was not the notes builder, which was fine. A flaky test failed the
// Quality gate, so `package` and `publish` were skipped and the release had to
// be written by hand from the CHANGELOG. Two things that hand-copy exposed are
// pinned here:
//
//   1. The CHANGELOG section IS the release body, so a defect in the section is
//      a defect on the release page. 3.1.0's duplicate `### Security` was the
//      second time duplicate headings had accumulated — the 2.1.0 entry records
//      merging duplicate `### Fixed` blocks under `[Unreleased]` and restoring
//      "Added → Changed → Fixed → Security". That fix shipped without a guard,
//      so it recurred. This is the guard.
//   2. Every published release is titled `HEAVEN-GeoIntel <tag>`, but the
//      workflow's template said `HEAVEN <tag>` — so each release was renamed by
//      hand after publishing, and the one nobody renamed would have stood out.
//
// String checks against the raw YAML, matching dockerPublish.test.ts, rather
// than a parsed graph: this project has no YAML parser dependency.

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const changelog = read("CHANGELOG.md");
const workflow = read(".github/workflows/release.yml");

/** `## [x.y.z] — date` … up to the next `## [`, which is what the notes awk cuts. */
function sections(): { heading: string; version: string; headings: string[] }[] {
  const lines = changelog.split("\n");
  const starts = lines.flatMap((l, i) => (/^## \[/.test(l) ? [i] : []));
  return starts.map((start, n) => {
    const stop = starts[n + 1] ?? lines.length;
    return {
      heading: lines[start]!,
      version: /^## \[([^\]]+)\]/.exec(lines[start]!)![1]!,
      headings: lines.slice(start + 1, stop).filter((l) => l.startsWith("### ")).map((l) => l.slice(4).trim()),
    };
  });
}

// Keep a Changelog's order, which this file both links in its preamble and
// names explicitly in the 2.1.0 entry.
const ORDER = ["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"];

describe("CHANGELOG sections", () => {
  it("parses into one section per released version, newest first", () => {
    const found = sections();
    expect(found.length).toBeGreaterThan(1);
    expect(found[0]!.version).toBe("Unreleased");
    expect(found.map((s) => s.version)).toContain(APP_VERSION);
  });

  // The recurrence guard. Applied to every section, not just the current one:
  // a duplicate anywhere splits related entries across the document, and the
  // section for the version being released becomes the release body verbatim.
  it("never repeats a `###` heading inside one version", () => {
    for (const { version, headings } of sections()) {
      const dupes = headings.filter((h, i) => headings.indexOf(h) !== i);
      expect(`${version}: ${dupes.join(", ")}`).toBe(`${version}: `);
    }
  });

  // The version being released and the one being written — between them they
  // are every section that can still become a release page. The published
  // history keeps whatever order it shipped with: rewriting a section after its
  // release page has quoted it is how the file and the page drift apart.
  it.each(["Unreleased", APP_VERSION])("orders the %s section Added → Changed → Fixed → Security", (version) => {
    const { headings } = sections().find((s) => s.version === version)!;
    for (const h of headings) expect(ORDER).toContain(h);
    expect(headings).toEqual([...headings].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)));
  });

  it("dates the section for this version, which is what the release job verifies", () => {
    expect(changelog).toMatch(new RegExp(`^## \\[${escapeRegExp(APP_VERSION)}\\] — \\d{4}-\\d{2}-\\d{2}$`, "m"));
  });
});

describe("release.yml builds the page the previous releases set the shape of", () => {
  it("titles the release the way every published one is titled", () => {
    // "HEAVEN v3.1.0" would have been the fourth release and the first with a
    // different name.
    expect(workflow).toMatch(/name: HEAVEN-GeoIntel \$\{\{ needs\.verify\.outputs\.tag \}\}/);
  });

  it("cuts the version heading out of the body and stops at the next version", () => {
    // Without the `next`, the body opens with `## [3.1.0] — 2026-09-08`, which
    // is how the hand-written page announced itself twice.
    expect(workflow).toMatch(/index\(\$0, v\) == 1 \{ on = 1; next \}/);
    expect(workflow).toMatch(/on && \/\^## \\\[\/\s+\{ exit \}/);
  });

  it("keeps the footer the hand-written page lost", () => {
    for (const section of ["## Install", "## Verifying the download", "## Scope and acceptable use"]) {
      expect(workflow).toContain(section);
    }
    expect(workflow).toMatch(/\*\*Full changelog:\*\*/);
    expect(workflow).toMatch(/sha256sum -c SHA256SUMS\.txt/);
  });

  it("attaches the build artifacts, which are the point of a release page", () => {
    // The hand-made v3.1.0 page had zero assets: nothing to download, and
    // nothing for `sha256sum -c` to check.
    expect(workflow).toMatch(/^\s+files: dist\/\*$/m);
    expect(workflow).toMatch(/body_path: RELEASE_NOTES\.md/);
  });
});
