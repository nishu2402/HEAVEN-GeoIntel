import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── The ghcr.io publish workflow ─────────────────────────────────────────────
//
// Two failures on the v2.1.0 push, neither of which any existing test could
// have caught, because both live entirely in YAML:
//
//   1. The tag job died with `Resource not accessible by integration` AFTER the
//      image was built, pushed and signed. anchore/sbom-action defaults to
//      attaching its SBOM to the GitHub Release for the tag, which needs
//      `contents: write`; the job holds `contents: read`. It had passed for
//      v2.0.0 and v2.0.1 only because no release existed for it to find — so
//      release.yml starting to publish releases is what exposed it.
//   2. The `main` job was killed at the 30-minute timeout mid-build, with
//      linux/arm64 still emulating `npm ci` under QEMU.
//
// These assertions pin the fixes. They are string checks against the raw file
// rather than a parsed graph, matching releaseGate.test.ts and avoiding a YAML
// parser that this project does not otherwise depend on.

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const workflow = read(".github/workflows/docker-image.yml");
const dockerfile = read("Dockerfile");
const dockerignore = read(".dockerignore");

/**
 * Whole-line comments removed, so a rule can forbid a construct without also
 * forbidding the explanation of why it was removed — the file documents the
 * QEMU build and the 403 at length, and that prose is the point.
 *
 * Deliberately not stripping trailing `#` comments: `${DIGEST#sha256:}` is a
 * shell parameter expansion, and cutting at the first `#` would mangle it.
 */
const code = workflow
  .split("\n")
  .filter((l) => !l.trim().startsWith("#"))
  .join("\n");

describe("the SBOM step cannot 403 the job again", () => {
  it("declines to attach release assets", () => {
    // The one-line fix. Without it the action defaults to true and tries to
    // upload to the release for the tag.
    expect(code).toMatch(/upload-release-assets:\s*false/);
  });

  it("keeps the SBOM as a build artifact, so declining costs nothing", () => {
    expect(code).toMatch(/name:\s*sbom-spdx/);
    expect(code).toMatch(/if-no-files-found:\s*error/);
  });

  it("never grants contents: write — the other way to fix it, and the wrong one", () => {
    // Widening the token would also have made the job pass. This job pushes
    // packages and holds a signing identity; write access to the repository is
    // not something it should acquire to save a duplicate file.
    expect(code).not.toMatch(/contents:\s*write/);
    expect(code).toMatch(/contents:\s*read/);
  });

  it("still signs and still attests — the failure must not have cost us those", () => {
    expect(code).toMatch(/cosign sign --yes/);
    expect(code).toMatch(/sbom:\s*true/);
    expect(code).toMatch(/provenance:\s*mode=max/);
    expect(code).toMatch(/id-token:\s*write/);
  });
});

describe("both architectures build natively", () => {
  it("gives each platform its own runner", () => {
    expect(code).toMatch(/platform:\s*linux\/amd64/);
    expect(code).toMatch(/runner:\s*ubuntu-24\.04\b/);
    expect(code).toMatch(/platform:\s*linux\/arm64/);
    expect(code).toMatch(/runner:\s*ubuntu-24\.04-arm/);
  });

  it("does not reach for QEMU", () => {
    // Emulating a Node toolchain is what took the build from 1m47s to over the
    // 30-minute timeout. Reintroducing setup-qemu-action would silently undo
    // the whole fix, because the workflow would still be green — just slow
    // again, until it wasn't.
    expect(code).not.toMatch(/setup-qemu-action/);
  });

  it("scopes the layer cache per platform", () => {
    // One shared scope has each architecture evict the other's layers on every
    // run, so neither ever hits and both rebuild from zero.
    expect(code).toMatch(/cache-from:\s*type=gha,scope=\$\{\{\s*matrix\.platform\s*\}\}/);
    expect(code).toMatch(/cache-to:\s*type=gha,mode=max,scope=\$\{\{\s*matrix\.platform\s*\}\}/);
  });

  it("asserts what the manifest merge produced instead of assuming it", () => {
    // A manifest list is exactly where an architecture or an attestation goes
    // missing quietly.
    expect(code).toMatch(/linux\/amd64,linux\/arm64/);
    expect(code).toMatch(/attestation-manifest/);
  });
});

describe("the duplicate run on every release is serialised", () => {
  it("groups on the commit, not the ref", () => {
    // Tagging pushes `main` and the tag within the same second: two runs, one
    // commit, one identical image. Grouping by ref would not have matched them
    // to each other, which is the whole point.
    expect(code).toMatch(/concurrency:/);
    expect(code).toMatch(/group:\s*docker-\$\{\{\s*github\.sha\s*\}\}/);
  });

  it("does not cancel the run it queued behind", () => {
    // Both runs carry tags the other does not — branch tags versus version tags.
    expect(code).toMatch(/cancel-in-progress:\s*false/);
  });
});

describe("the build context stays an allowlist", () => {
  it("excludes the repository root and re-admits named paths", () => {
    const lines = dockerignore
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    expect(lines).toContain("*");
    expect(lines.indexOf("*")).toBeLessThan(lines.findIndex((l) => l.startsWith("!")));
  });

  it("admits every path the Dockerfile copies out of the builder", () => {
    // The coupling that makes a tighter .dockerignore dangerous: exclude a path
    // the runtime stage needs and the image builds fine, then 404s in
    // production. `.next` and `node_modules` are produced inside the build, so
    // they are the two that must NOT come from the context.
    const generated = new Set([".next", "node_modules"]);
    const copied = [...dockerfile.matchAll(/^COPY\s+(?:--\S+\s+)*\/app\/(\S+)/gm)]
      .map((m) => m[1])
      .filter((p) => !generated.has(p));

    expect(copied).toContain("public");
    for (const path of copied) {
      expect(dockerignore).toMatch(new RegExp(`^!${path.replace(/\./g, "\\.")}$`, "m"));
    }
  });

  it("admits what the dependency stage installs from", () => {
    for (const f of ["package.json", "package-lock.json"]) {
      expect(dockerignore).toMatch(new RegExp(`^!${f.replace(/\./g, "\\.")}$`, "m"));
    }
  });

  it("keeps case stores and scan output out of the build cache", () => {
    // `data/` and `.data/` hold case stores, audit logs and scan reports. `*`
    // already excludes them; this fails if someone re-admits them by hand.
    for (const dir of ["data", ".data", "tests", "docs", "coverage", "e2e"]) {
      expect(dockerignore).not.toMatch(new RegExp(`^!${dir.replace(/\./g, "\\.")}(/|$)`, "m"));
    }
  });
});
