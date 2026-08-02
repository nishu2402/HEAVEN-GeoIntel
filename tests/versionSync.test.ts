import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_VERSION, APP_VERSION_SHORT, USER_AGENT } from "@/lib/version";

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
  it("is a plain semver, with a major.minor short form and a UA derived from it", () => {
    expect(APP_VERSION).toMatch(SEMVER);
    expect(APP_VERSION_SHORT).toBe(APP_VERSION.split(".").slice(0, 2).join("."));
    // The patch level is deliberately absent: a bugfix release should not read
    // as a new client in a free upstream's logs.
    expect(USER_AGENT).toBe(`HEAVEN-GeoIntel/${APP_VERSION_SHORT}`);
    expect(USER_AGENT).not.toContain(APP_VERSION);
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

  it("docker-compose.yml tags the image with the current major.minor", () => {
    expect(read("docker-compose.yml")).toContain(`image: heaven-geointel:${APP_VERSION_SHORT}`);
  });

  it("the README's docker commands build and run that same tag", () => {
    const readme = read("README.md");
    expect(readme).toContain(`docker build -t heaven-geointel:${APP_VERSION_SHORT} .`);
    // Every `docker run` in the README must name the tag the build produced —
    // a stale one sends a new user to an image they never built.
    const tags = readme.match(/heaven-geointel:\d+\.\d+/g) ?? [];
    expect(tags.length).toBeGreaterThan(0);
    expect(new Set(tags)).toEqual(new Set([`heaven-geointel:${APP_VERSION_SHORT}`]));
  });

  it("the README's version badge names this release", () => {
    expect(read("README.md")).toContain(`badge/Version-${APP_VERSION}-`);
  });

  it("the launcher banner shows the current version", () => {
    expect(read("scripts/start.sh")).toContain(`Unified OSINT Platform  v${APP_VERSION_SHORT}`);
  });

  it("SECURITY.md lists the current major.minor as supported", () => {
    // A supported-versions table that omits the release you just shipped tells
    // a reporter their finding is out of scope.
    expect(read("SECURITY.md")).toMatch(
      new RegExp(`^\\|\\s*${APP_VERSION_SHORT.replace(".", "\\.")}\\.x\\s*\\|\\s*:white_check_mark:`, "m"),
    );
  });

  it("CHANGELOG.md has a released section for this version", () => {
    // Guards the release step itself: bumping package.json without writing the
    // changelog entry is the easiest half of a release to forget.
    expect(read("CHANGELOG.md")).toMatch(
      new RegExp(`^## \\[${APP_VERSION.replace(/\./g, "\\.")}\\] — \\d{4}-\\d{2}-\\d{2}$`, "m"),
    );
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
