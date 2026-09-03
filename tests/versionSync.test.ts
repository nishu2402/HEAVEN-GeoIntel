import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { APP_VERSION, APP_VERSION_BRANCH, USER_AGENT } from "@/lib/version";
import { escapeRegExp } from "./escapeRegExp";

// The version used to be typed out by hand in eight places and had already
// drifted three ways (package.json 1.3.0, the OpenAPI spec 1.4.0, the outbound
// User-Agent 1.3). `src/lib/version.ts` is now the only literal in the source
// tree; this suite is what keeps the files OUTSIDE the module graph — the
// manifest, the compose file, the launcher banner, the security policy, the
// README's docker commands — from falling behind it on a release.
//
// It reads real files rather than mocking them, so a release that bumps only
// package.json fails here instead of shipping.

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const SEMVER = /^\d+\.\d+\.\d+$/;

describe("version module", () => {
  it("is a plain semver, with a major.minor branch label and a UA derived from it", () => {
    expect(APP_VERSION).toMatch(SEMVER);
    expect(APP_VERSION_BRANCH).toBe(APP_VERSION.split(".").slice(0, 2).join("."));
    // The UA carries the FULL version. 2.0.x truncated it, which meant an
    // upstream operator correlating a behaviour change to a release could not
    // tell 2.0.0 from 2.0.1.
    expect(USER_AGENT).toBe(`HEAVEN-GeoIntel/${APP_VERSION}`);
  });
});

describe("every file outside the module graph agrees", () => {
  it("package.json declares exactly APP_VERSION", () => {
    expect(JSON.parse(read("package.json")).version).toBe(APP_VERSION);
  });

  it("package-lock.json was regenerated with it (both places npm writes)", () => {
    // npm writes the version twice — top level and under packages[""]. A manual
    // edit to package.json alone leaves the lock stale and `npm ci` reinstates
    // the old number.
    const lock = JSON.parse(read("package-lock.json"));
    expect(lock.version).toBe(APP_VERSION);
    expect(lock.packages[""].version).toBe(APP_VERSION);
  });

  it("docker-compose.yml tags the image with the exact released version", () => {
    expect(read("docker-compose.yml")).toContain(`image: heaven-geointel:${APP_VERSION}`);
  });

  it("the README's docker commands build and run that same tag", () => {
    const readme = read("README.md");
    expect(readme).toContain(`docker build -t heaven-geointel:${APP_VERSION} .`);
    // Every `docker run` in the README must name the tag the build produced —
    // a stale one sends a new user to an image they never built.
    const tags = readme.match(/heaven-geointel:\d+\.\d+(?:\.\d+)?/g) ?? [];
    expect(tags.length).toBeGreaterThan(0);
    expect(new Set(tags)).toEqual(new Set([`heaven-geointel:${APP_VERSION}`]));
  });

  it("the README's version badge names this release", () => {
    expect(read("README.md")).toContain(`badge/Version-${APP_VERSION}-`);
  });

  it("the launcher banner shows the current version", () => {
    expect(read("scripts/start.sh")).toContain(`Unified OSINT Platform  v${APP_VERSION}`);
  });

  it("SECURITY.md lists the current release branch as supported", () => {
    // A supported-versions table that omits the release you just shipped tells
    // a reporter their finding is out of scope.
    expect(read("SECURITY.md")).toMatch(
      new RegExp(`^\\|\\s*${APP_VERSION_BRANCH.replace(".", "\\.")}\\.x\\s*\\|\\s*:white_check_mark:`, "m"),
    );
  });

  it("CHANGELOG.md has a released section for this version", () => {
    // Guards the release step itself: bumping package.json without writing the
    // changelog entry is the easiest half of a release to forget.
    expect(read("CHANGELOG.md")).toMatch(
      new RegExp(`^## \\[${escapeRegExp(APP_VERSION)}\\] — \\d{4}-\\d{2}-\\d{2}$`, "m"),
    );
  });
});

describe("nothing under src/ labels a build with the branch", () => {
  // The bug this guards: 2.0.1 shipped with a header, a boot line, a launcher
  // banner and a User-Agent all reading "2.0", because they used the
  // major.minor form. A screenshot of the app could not tell you which build
  // took it. APP_VERSION_BRANCH describes a RANGE — it belongs to SECURITY.md's
  // supported-versions table and nowhere else, so reaching for it inside src/
  // is the drift, and this is where it gets caught.
  it("APP_VERSION_BRANCH is never imported by application code", () => {
    const hits = execFileSync(
      "git",
      ["grep", "-l", "APP_VERSION_BRANCH", "--", "src/"],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    // Only the module that defines it.
    expect(hits.split("\n").filter(Boolean)).toEqual(["src/lib/version.ts"]);
  });

  it.each([
    ["the header", "src/app/page.tsx"],
    ["the boot sequence", "src/components/shared/BootSequence.tsx"],
  ])("%s renders the full semver", (_label, file) => {
    expect(read(file)).toMatch(/v\$?\{APP_VERSION\}/);
  });
});

describe("no file re-hardcodes a version", () => {
  const sources = [
    "src/app/api/health/route.ts",
    "src/lib/analysis/caseReport.ts",
    "src/lib/api/openapi.ts",
    "src/app/page.tsx",
    "src/components/shared/BootSequence.tsx",
    "src/app/api/lookup/route.ts",
    "src/app/api/email-lookup/route.ts",
    "src/lib/server/hudsonRock.ts",
    "src/lib/server/leakCheck.ts",
  ];

  it.each(sources)("%s imports the version instead of spelling one out", (file) => {
    const src = read(file);
    expect(src).toMatch(/^import \{[^}]*\} from "(@\/lib|\.\.?(\/\.\.)*)\/version";$/m);
    // A bare `HEAVEN-GeoIntel/1.3` or `version: "1.3.0"` reintroduces the drift.
    expect(src).not.toMatch(/HEAVEN-GeoIntel\/\d+\.\d+/);
    expect(src).not.toMatch(/version:\s*"\d+\.\d+\.\d+"/);
  });
});
