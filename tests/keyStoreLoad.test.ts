import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// keyStore caches on first load(), so the "read an existing keys.json" path can't
// be exercised in the main keyStore test (its first call writes/clears the cache).
// This isolated file (fresh module = null cache) pre-seeds a valid keys.json so
// the very first call hits the successful read+parse branch.
let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "hv-keyload-"));
  process.env.HV_DATA_DIR = dir;
  writeFileSync(join(dir, "keys.json"), JSON.stringify({ IPQS_API_KEY: "preloaded-secret" }), { mode: 0o600 });
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.HV_DATA_DIR;
});

describe("keyStore load (existing file)", () => {
  it("reads + parses a pre-existing keys.json on first access", async () => {
    const { resolveKey, configuredMap } = await import("@/lib/server/keyStore");
    expect(await resolveKey("IPQS_API_KEY")).toBe("preloaded-secret");
    expect((await configuredMap()).IPQS_API_KEY).toBe("ui");
  });
});
