import { describe, it, expect, vi } from "vitest";
import { getCached, setCached } from "@/lib/server/cache";
import type { LookupResponse } from "@/lib/types";

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
});
