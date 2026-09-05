import { describe, it, expect, afterEach, vi } from "vitest";
import {
  sha1HexUpper, normalizePrefix, splitSha1, parseRangeCount,
  defaultRangeFetcher, checkPasswordPwned,
} from "@/lib/analysis/pwnedPasswords";

afterEach(() => vi.unstubAllGlobals());

// SHA-1("password") — the canonical Pwned Passwords example.
const PW_SHA1 = "5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8";
const PW_PREFIX = "5BAA6";
const PW_SUFFIX = "1E4C9B93F3F0682250B6CF8331B7EE68FD8";

const resp = (status: number, body: unknown, textBody?: string) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => textBody ?? "",
  }) as Response;

describe("sha1HexUpper", () => {
  it("hashes UTF-8 text to an uppercase SHA-1", async () => {
    expect(await sha1HexUpper("password")).toBe(PW_SHA1);
  });
});

describe("normalizePrefix", () => {
  it("upper-cases and trims a valid 5-hex prefix", () => {
    expect(normalizePrefix("5baa6")).toBe(PW_PREFIX);
    expect(normalizePrefix("  5BAA6 ")).toBe(PW_PREFIX);
  });
  it("rejects the wrong length or non-hex characters", () => {
    expect(normalizePrefix("5BAA")).toBeNull();    // too short
    expect(normalizePrefix("5BAA61")).toBeNull();  // too long
    expect(normalizePrefix("GHIJK")).toBeNull();   // not hex
    expect(normalizePrefix("")).toBeNull();
  });
});

describe("splitSha1", () => {
  it("splits a digest into prefix and suffix", () => {
    expect(splitSha1(PW_SHA1)).toEqual({ prefix: PW_PREFIX, suffix: PW_SUFFIX });
  });
  it("throws on anything that is not a 40-hex digest", () => {
    expect(() => splitSha1("nope")).toThrow(/40-character SHA-1/);
  });
});

describe("parseRangeCount", () => {
  it("returns the count for a matching suffix, tolerating CRLF and case", () => {
    const range = `0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n${PW_SUFFIX.toLowerCase()}:9876\r\n`;
    expect(parseRangeCount(range, PW_SUFFIX)).toBe(9876);
  });
  it("treats a padded zero-count match as not found", () => {
    expect(parseRangeCount(`${PW_SUFFIX}:0`, PW_SUFFIX)).toBe(0);
  });
  it("returns zero when the suffix is absent", () => {
    expect(parseRangeCount("AAAA:3\nBBBB:4", PW_SUFFIX)).toBe(0);
  });
  it("ignores a line with no colon and a non-numeric count", () => {
    expect(parseRangeCount(`garbage-no-colon\n${PW_SUFFIX}:notanumber`, PW_SUFFIX)).toBe(0);
  });
});

describe("defaultRangeFetcher", () => {
  it("posts the prefix and returns the range text on success", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL, init?: RequestInit) => {
      calls.push({ url: String(u), init });
      return resp(200, { range: `${PW_SUFFIX}:5` });
    }));
    const range = await defaultRangeFetcher(PW_PREFIX);
    expect(range).toBe(`${PW_SUFFIX}:5`);
    expect(calls[0].url).toBe("/api/pwned-password");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ prefix: PW_PREFIX });
  });
  it("throws the relay's own error message on a non-2xx JSON body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resp(429, { error: "slow down" })));
    await expect(defaultRangeFetcher(PW_PREFIX)).rejects.toThrow("slow down");
  });
  it("throws a generic reason when a non-2xx body is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, json: async () => { throw new Error("no json"); } }) as unknown as Response));
    await expect(defaultRangeFetcher(PW_PREFIX)).rejects.toThrow(/HTTP 503/);
  });
  it("throws a generic reason when a non-2xx body has no error string", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resp(500, {})));
    await expect(defaultRangeFetcher(PW_PREFIX)).rejects.toThrow(/HTTP 500/);
  });
  it("throws when a 200 body carries no range string", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resp(200, { range: 42 })));
    await expect(defaultRangeFetcher(PW_PREFIX)).rejects.toThrow(/unexpected response/);
  });
});

describe("checkPasswordPwned", () => {
  it("guards an empty password without hashing or fetching", async () => {
    const fetcher = vi.fn();
    expect(await checkPasswordPwned("", fetcher)).toEqual({ ok: false, error: "Enter a password to check." });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("hashes, sends only the prefix, and reports the matched count", async () => {
    const fetcher = vi.fn(async (prefix: string) => {
      expect(prefix).toBe(PW_PREFIX); // never the whole hash
      return `${PW_SUFFIX}:3861493`;
    });
    expect(await checkPasswordPwned("password", fetcher)).toEqual({ ok: true, count: 3861493 });
  });
  it("returns a clean zero when the suffix is not in the range", async () => {
    const r = await checkPasswordPwned("password", async () => "0000000000000000000000000000000000A:1");
    expect(r).toEqual({ ok: true, count: 0 });
  });
  it("surfaces a fetch failure as a typed error, never as clean", async () => {
    const r = await checkPasswordPwned("password", async () => { throw new Error("relay down"); });
    expect(r).toEqual({ ok: false, error: "relay down" });
  });
  it("normalises a non-Error throw to a generic message", async () => {
    const r = await checkPasswordPwned("password", async () => { throw "weird"; });
    expect(r).toEqual({ ok: false, error: "The password check failed." });
  });
  it("uses the default relay fetcher when none is injected", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resp(200, { range: `${PW_SUFFIX}:7` })));
    expect(await checkPasswordPwned("password")).toEqual({ ok: true, count: 7 });
  });
});
