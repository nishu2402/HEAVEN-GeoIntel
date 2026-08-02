import { describe, it, expect, afterEach } from "vitest";
import {
  boolFromEnv,
  emailCacheConfig,
  fanoutConcurrency,
  fetchTimeoutMs,
  intFromEnv,
  phoneCacheConfig,
  rateLimitConfig,
} from "@/lib/server/config";

// Runtime config replaces the compile-time constants. The contract that matters:
// every knob keeps its historical value when unset, and junk never takes the
// process down or silently produces a nonsense limit.

const KEYS = [
  "T_INT", "T_BOOL", "RATE_LIMIT_MAX", "RATE_LIMIT_WINDOW_MS", "RATE_LIMIT_GLOBAL_MAX",
  "CACHE_TTL_MS", "CACHE_MAX_ENTRIES", "EMAIL_CACHE_TTL_MS", "EMAIL_CACHE_MAX_ENTRIES",
  "SOURCE_TIMEOUT_MS", "FANOUT_CONCURRENCY",
];
afterEach(() => KEYS.forEach((k) => delete process.env[k]));

describe("intFromEnv", () => {
  it("returns the fallback when unset or blank", () => {
    expect(intFromEnv("T_INT", 7, 0, 100)).toBe(7);
    process.env.T_INT = "   ";
    expect(intFromEnv("T_INT", 7, 0, 100)).toBe(7);
  });

  it("returns the fallback for non-numeric junk", () => {
    process.env.T_INT = "banana";
    expect(intFromEnv("T_INT", 7, 0, 100)).toBe(7);
  });

  it("parses a valid integer", () => {
    process.env.T_INT = "42";
    expect(intFromEnv("T_INT", 7, 0, 100)).toBe(42);
  });

  it("truncates a float rather than producing a fractional limit", () => {
    process.env.T_INT = "42.9";
    expect(intFromEnv("T_INT", 7, 0, 100)).toBe(42);
  });

  it("clamps to the allowed range in both directions", () => {
    process.env.T_INT = "1000";
    expect(intFromEnv("T_INT", 7, 0, 100)).toBe(100);
    process.env.T_INT = "-5";
    expect(intFromEnv("T_INT", 7, 0, 100)).toBe(0);
  });

  it("rejects Infinity", () => {
    process.env.T_INT = "Infinity";
    expect(intFromEnv("T_INT", 7, 0, 100)).toBe(7);
  });
});

describe("boolFromEnv", () => {
  it("defaults to the fallback when unset or blank", () => {
    expect(boolFromEnv("T_BOOL")).toBe(false);
    expect(boolFromEnv("T_BOOL", true)).toBe(true);
    process.env.T_BOOL = "  ";
    expect(boolFromEnv("T_BOOL", true)).toBe(true);
  });

  it("accepts 1 / true / yes in any case", () => {
    for (const v of ["1", "true", "TRUE", "Yes"]) {
      process.env.T_BOOL = v;
      expect(boolFromEnv("T_BOOL"), v).toBe(true);
    }
  });

  it("treats anything else as false", () => {
    for (const v of ["0", "false", "no", "maybe"]) {
      process.env.T_BOOL = v;
      expect(boolFromEnv("T_BOOL", true), v).toBe(false);
    }
  });
});

describe("shipped defaults", () => {
  it("rate limits at 60/min per client with a 600/min server ceiling", () => {
    expect(rateLimitConfig()).toEqual({ max: 60, windowMs: 60_000, globalMax: 600 });
  });

  it("caches phone results for 24 h, 1000 entries", () => {
    expect(phoneCacheConfig()).toEqual({ ttlMs: 86_400_000, maxEntries: 1000 });
  });

  it("caches email results for 24 h, 500 entries", () => {
    expect(emailCacheConfig()).toEqual({ ttlMs: 86_400_000, maxEntries: 500 });
  });

  it("times out a source at 8 s and fans out 12 wide", () => {
    expect(fetchTimeoutMs()).toBe(8_000);
    expect(fanoutConcurrency()).toBe(12);
  });
});

describe("environment overrides", () => {
  it("applies every rate-limit knob", () => {
    process.env.RATE_LIMIT_MAX = "5";
    process.env.RATE_LIMIT_WINDOW_MS = "30000";
    process.env.RATE_LIMIT_GLOBAL_MAX = "9";
    expect(rateLimitConfig()).toEqual({ max: 5, windowMs: 30_000, globalMax: 9 });
  });

  it("applies the cache knobs", () => {
    process.env.CACHE_TTL_MS = "1000";
    process.env.CACHE_MAX_ENTRIES = "5";
    expect(phoneCacheConfig()).toEqual({ ttlMs: 1000, maxEntries: 5 });
  });

  it("lets the email cache inherit the phone TTL but keep its own size", () => {
    process.env.CACHE_TTL_MS = "1234";
    expect(emailCacheConfig()).toEqual({ ttlMs: 1234, maxEntries: 500 });
  });

  it("lets the email cache override the inherited TTL", () => {
    process.env.CACHE_TTL_MS = "1234";
    process.env.EMAIL_CACHE_TTL_MS = "99";
    process.env.EMAIL_CACHE_MAX_ENTRIES = "3";
    expect(emailCacheConfig()).toEqual({ ttlMs: 99, maxEntries: 3 });
  });

  it("applies the timeout and fanout knobs", () => {
    process.env.SOURCE_TIMEOUT_MS = "1500";
    process.env.FANOUT_CONCURRENCY = "4";
    expect(fetchTimeoutMs()).toBe(1500);
    expect(fanoutConcurrency()).toBe(4);
  });

  it("reads the environment on every call, not once at import", () => {
    process.env.RATE_LIMIT_MAX = "11";
    expect(rateLimitConfig().max).toBe(11);
    process.env.RATE_LIMIT_MAX = "22";
    expect(rateLimitConfig().max).toBe(22);
  });
});
