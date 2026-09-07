import { describe, it, expect } from "vitest";
import { parseVersion, isNewerVersion } from "@/lib/update/semver";

// The comparison behind the update badge. Its contract is conservative on
// purpose: anything it cannot parse is "not newer", so the checker can never
// announce an update that is not really there.

describe("parseVersion", () => {
  it("parses a bare X.Y.Z", () => {
    expect(parseVersion("3.0.0")).toEqual({ major: 3, minor: 0, patch: 0 });
  });

  it("tolerates a leading v and trims whitespace", () => {
    expect(parseVersion("  v12.4.9 ")).toEqual({ major: 12, minor: 4, patch: 9 });
    expect(parseVersion("V1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it("ignores a prerelease or build suffix", () => {
    expect(parseVersion("2.5.1-rc.2")).toEqual({ major: 2, minor: 5, patch: 1 });
    expect(parseVersion("2.5.1+build.7")).toEqual({ major: 2, minor: 5, patch: 1 });
  });

  it("returns null when the three core numbers are not all present", () => {
    expect(parseVersion("3.0")).toBeNull();
    expect(parseVersion("not-a-version")).toBeNull();
    expect(parseVersion("")).toBeNull();
  });
});

describe("isNewerVersion", () => {
  it("compares by major, then minor, then patch", () => {
    expect(isNewerVersion("4.0.0", "3.9.9")).toBe(true);   // major
    expect(isNewerVersion("3.1.0", "3.0.9")).toBe(true);   // minor
    expect(isNewerVersion("3.0.1", "3.0.0")).toBe(true);   // patch
  });

  it("is false for an equal or older version", () => {
    expect(isNewerVersion("3.0.0", "3.0.0")).toBe(false);
    expect(isNewerVersion("2.9.9", "3.0.0")).toBe(false);  // older major
    expect(isNewerVersion("3.0.0", "3.1.0")).toBe(false);  // older minor
    expect(isNewerVersion("3.0.0", "3.0.5")).toBe(false);  // older patch
  });

  it("strips a leading v on either side", () => {
    expect(isNewerVersion("v3.1.0", "3.0.0")).toBe(true);
    expect(isNewerVersion("3.1.0", "v3.0.0")).toBe(true);
  });

  it("is false when either side cannot be parsed", () => {
    expect(isNewerVersion("garbage", "3.0.0")).toBe(false);
    expect(isNewerVersion("3.1.0", "garbage")).toBe(false);
  });
});
