import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearAllKeys, clearKey, setKey } from "@/lib/server/keyStore";
import { cacheStats, getCached, setCached, setCachedEmail } from "@/lib/server/cache";
import type { EmailLookupResponse, LookupResponse } from "@/lib/types";

// Regression test for the P1 defect: a result fetched with no API keys stayed
// cached for 24 h, so adding a key in the UI appeared to do nothing and users
// concluded the key was broken. Any change to the key set must drop the caches.

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hv-keycache-"));
  process.env.HV_DATA_DIR = dir;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.HV_DATA_DIR;
});

function seedCaches(): void {
  setCached("+14155552671", { threatScore: 0 } as unknown as LookupResponse);
  setCachedEmail("t@example.test", { email: "t@example.test" } as unknown as EmailLookupResponse);
  expect(cacheStats().phone).toBeGreaterThan(0);
  expect(cacheStats().email).toBeGreaterThan(0);
}

describe("adding or removing an API key invalidates cached results", () => {
  it("drops both caches when a key is stored", async () => {
    seedCaches();
    expect(await setKey("IPQS_API_KEY", "new-key-value")).toBe(true);
    expect(cacheStats()).toEqual({ phone: 0, email: 0 });
    // The next lookup must re-fetch rather than serve the keyless answer.
    expect(getCached("+14155552671")).toBeNull();
  });

  it("drops both caches when a key is removed", async () => {
    await setKey("IPQS_API_KEY", "value");
    seedCaches();
    expect(await clearKey("IPQS_API_KEY")).toBe(true);
    expect(cacheStats()).toEqual({ phone: 0, email: 0 });
  });

  it("drops both caches when every key is cleared", async () => {
    await setKey("IPQS_API_KEY", "value");
    seedCaches();
    await clearAllKeys();
    expect(cacheStats()).toEqual({ phone: 0, email: 0 });
  });

  it("leaves the caches alone when the mutation was rejected", async () => {
    seedCaches();
    const before = cacheStats();

    // Not in the allow-list, and an empty value — neither changes the key set.
    expect(await setKey("NOT_A_REAL_KEY", "x")).toBe(false);
    expect(await setKey("IPQS_API_KEY", "   ")).toBe(false);
    expect(await clearKey("NOT_A_REAL_KEY")).toBe(false);

    expect(cacheStats()).toEqual(before);
  });

  it("still invalidates when clearing a key that was never set", async () => {
    seedCaches();
    // The name is valid but absent — the store is a no-op, yet dropping the
    // caches is harmless and keeps the rule simple: valid mutation ⇒ invalidate.
    expect(await clearKey("HUNTER_API_KEY")).toBe(true);
    expect(cacheStats()).toEqual({ phone: 0, email: 0 });
  });
});
