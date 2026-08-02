import { describe, it, expect, afterEach } from "vitest";
import {
  CASE_TOKEN_COOKIE, casePassword, issueToken, passwordMatches, verifyToken,
} from "@/lib/server/caseLock";

afterEach(() => {
  delete process.env.CASE_PASSWORD;
  delete process.env.CASE_UNLOCK_TTL_MS;
});

describe("casePassword", () => {
  it("is disabled by default, and by an empty/whitespace value", () => {
    expect(casePassword()).toBeNull();
    process.env.CASE_PASSWORD = "";
    expect(casePassword()).toBeNull();
    process.env.CASE_PASSWORD = "   ";
    expect(casePassword()).toBeNull();
  });

  it("is enabled by a real value", () => {
    process.env.CASE_PASSWORD = "hunter2";
    expect(casePassword()).toBe("hunter2");
  });
});

describe("token round-trip", () => {
  it("issues a token that verifies against the same secret", () => {
    const { token, maxAgeSeconds } = issueToken("s3cret", 1_000_000);
    expect(verifyToken(token, "s3cret", 1_000_000)).toBe(true);
    expect(maxAgeSeconds).toBe(12 * 60 * 60); // default 12 h
  });

  it("carries the expiry inside the MAC, so it cannot be extended", () => {
    const { token } = issueToken("s3cret", 1_000_000);
    const [expiresAt, mac] = token.split(".");
    const forged = `${Number(expiresAt) + 86_400_000}.${mac}`;
    expect(verifyToken(forged, "s3cret", 1_000_000)).toBe(false);
  });

  it("rejects a token issued under a different secret", () => {
    const { token } = issueToken("old-password", 1_000_000);
    // Rotating CASE_PASSWORD must invalidate every outstanding session.
    expect(verifyToken(token, "new-password", 1_000_000)).toBe(false);
  });

  it("rejects an expired token", () => {
    const { token } = issueToken("s3cret", 1_000_000);
    expect(verifyToken(token, "s3cret", 1_000_000 + 13 * 60 * 60_000)).toBe(false);
  });

  it("rejects malformed tokens without throwing", () => {
    for (const bad of [undefined, "", "no-dot", ".onlymac", "notanumber.abc"]) {
      expect(verifyToken(bad, "s3cret", 1_000_000)).toBe(false);
    }
  });

  it("rejects a MAC of the wrong length", () => {
    const { token } = issueToken("s3cret", 1_000_000);
    const [expiresAt] = token.split(".");
    expect(verifyToken(`${expiresAt}.short`, "s3cret", 1_000_000)).toBe(false);
  });

  it("honours a configured TTL, clamped to sane bounds", () => {
    process.env.CASE_UNLOCK_TTL_MS = "60000";
    expect(issueToken("s", 0).maxAgeSeconds).toBe(60);
    process.env.CASE_UNLOCK_TTL_MS = "1";        // below the floor
    expect(issueToken("s", 0).maxAgeSeconds).toBe(60);
    process.env.CASE_UNLOCK_TTL_MS = "junk";     // falls back to the default
    expect(issueToken("s", 0).maxAgeSeconds).toBe(12 * 60 * 60);
  });
});

describe("passwordMatches", () => {
  it("accepts the exact password and rejects everything else", () => {
    expect(passwordMatches("hunter2", "hunter2")).toBe(true);
    expect(passwordMatches("hunter3", "hunter2")).toBe(false);
    expect(passwordMatches("hunter2 ", "hunter2")).toBe(false);
    expect(passwordMatches("", "hunter2")).toBe(false);
  });

  it("rejects a non-string submission without throwing", () => {
    expect(passwordMatches(undefined, "hunter2")).toBe(false);
    expect(passwordMatches(42, "hunter2")).toBe(false);
    expect(passwordMatches({ toString: () => "hunter2" }, "hunter2")).toBe(false);
  });

  it("compares a submission of a different length without leaking via length", () => {
    // Both sides are MACed first, so the byte comparison is always fixed-width.
    expect(passwordMatches("a", "a-much-longer-password")).toBe(false);
  });
});

describe("cookie name", () => {
  it("is stable — changing it would silently log every operator out", () => {
    expect(CASE_TOKEN_COOKIE).toBe("hv_case");
  });
});
