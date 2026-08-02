import { describe, it, expect, vi, afterEach } from "vitest";
import {
  cacheStats,
  clearAllCaches,
  getCached,
  getCachedEmail,
  setCached,
  setCachedEmail,
} from "@/lib/server/cache";
import type { EmailLookupResponse, LookupResponse } from "@/lib/types";

// In-memory phone-lookup cache: 24h TTL, 1000-entry cap with oldest-first
// eviction. The store is module-global (no reset export), so every test uses
// unique keys to stay independent.

const mk = (id: string) => ({ ok: true, id } as unknown as LookupResponse);

describe("cache get/set", () => {
  it("round-trips a value and stamps cachedAt", () => {
    const key = "+1000000001";
    expect(getCached(key)).toBeNull(); // cold
    setCached(key, mk(key));
    const got = getCached(key) as unknown as { id: string; cachedAt: number };
    expect(got.id).toBe(key);
    expect(typeof got.cachedAt).toBe("number");
  });

  it("returns null for an unknown key", () => {
    expect(getCached("+1999999999")).toBeNull();
  });

  it("expires entries after the TTL and evicts them", () => {
    const key = "+1000000002";
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(1_000_000);
    setCached(key, mk(key));
    expect(getCached(key)).not.toBeNull(); // still fresh at t0

    now.mockReturnValue(1_000_000 + 24 * 60 * 60 * 1000 + 1); // just past TTL
    expect(getCached(key)).toBeNull();
    now.mockRestore();
    // re-fetch after restore confirms the expired entry was deleted, not just hidden
    expect(getCached(key)).toBeNull();
  });
});

describe("cache eviction (memory cap)", () => {
  it("never grows past the cap: oldest key is dropped, newest survives", () => {
    // Insert comfortably more than MAX_SIZE (1000) distinct keys so the earliest
    // is guaranteed evicted regardless of any entries left by earlier tests.
    const first = "evk-0";
    setCached(first, mk(first));
    let last = first;
    for (let i = 1; i <= 1100; i++) {
      last = "evk-" + i;
      setCached(last, mk(last));
    }
    expect(getCached(first)).toBeNull();   // oldest evicted
    expect(getCached(last)).not.toBeNull(); // newest retained
  });

  it("honours CACHE_MAX_ENTRIES from the environment", () => {
    clearAllCaches();
    process.env.CACHE_MAX_ENTRIES = "2";
    try {
      setCached("a", mk("a"));
      setCached("b", mk("b"));
      setCached("c", mk("c"));
      expect(getCached("a")).toBeNull(); // evicted at the new, smaller cap
      expect(getCached("c")).not.toBeNull();
    } finally {
      delete process.env.CACHE_MAX_ENTRIES;
      clearAllCaches();
    }
  });

  it("refreshes an existing key without evicting anything", () => {
    clearAllCaches();
    process.env.CACHE_MAX_ENTRIES = "2";
    try {
      setCached("a", mk("a"));
      setCached("b", mk("b"));
      setCached("b", mk("b2")); // at capacity but the key already exists
      expect(getCached("a")).not.toBeNull();
      expect((getCached("b") as unknown as { id: string }).id).toBe("b2");
    } finally {
      delete process.env.CACHE_MAX_ENTRIES;
      clearAllCaches();
    }
  });
});

describe("email cache", () => {
  const mkEmail = (id: string) => ({ email: id } as unknown as EmailLookupResponse);

  afterEach(clearAllCaches);

  it("round-trips independently of the phone cache", () => {
    setCachedEmail("a@x.test", mkEmail("a@x.test"));
    expect(getCachedEmail("a@x.test")?.email).toBe("a@x.test");
    expect(getCached("a@x.test")).toBeNull(); // separate namespace
  });

  it("expires after its TTL", () => {
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(2_000_000);
    setCachedEmail("t@x.test", mkEmail("t@x.test"));
    now.mockReturnValue(2_000_000 + 24 * 60 * 60 * 1000 + 1);
    expect(getCachedEmail("t@x.test")).toBeNull();
    now.mockRestore();
  });
});

describe("clearAllCaches", () => {
  it("empties both caches — the hook that makes a newly-added API key take effect", () => {
    setCached("+1555", mk("+1555"));
    setCachedEmail("k@x.test", { email: "k@x.test" } as unknown as EmailLookupResponse);
    expect(cacheStats().phone).toBeGreaterThan(0);
    expect(cacheStats().email).toBeGreaterThan(0);

    clearAllCaches();

    expect(cacheStats()).toEqual({ phone: 0, email: 0 });
    expect(getCached("+1555")).toBeNull();
    expect(getCachedEmail("k@x.test")).toBeNull();
  });
});
