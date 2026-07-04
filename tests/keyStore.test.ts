import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setKey, clearKey, clearAllKeys, resolveKey, configuredMap, KEY_NAMES } from "@/lib/server/keyStore";

// Write-path tests run against a hermetic temp dir (never the real .data) via the
// HV_DATA_DIR override; the reject-path tests below return before any file I/O.
let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "hv-keystore-"));
  process.env.HV_DATA_DIR = dir;
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.HV_DATA_DIR;
});

describe("keyStore allow-list", () => {
  it("exposes the expected provider key names", () => {
    expect(KEY_NAMES).toContain("IPQS_API_KEY");
    expect(KEY_NAMES).toContain("TWILIO_ACCOUNT_SID");
    expect(KEY_NAMES).toContain("RAPIDAPI_KEY");
    expect(KEY_NAMES.length).toBeGreaterThanOrEqual(9);
  });

  it("rejects writes/clears for names not on the allow-list (no arbitrary env injection)", async () => {
    expect(await setKey("EVIL_NAME", "x")).toBe(false);
    expect(await setKey("PATH", "/etc/passwd")).toBe(false);
    expect(await setKey("__proto__", "x")).toBe(false);
    expect(await clearKey("EVIL_NAME")).toBe(false);
  });

  it("rejects an empty value for a valid key name", async () => {
    expect(await setKey("IPQS_API_KEY", "   ")).toBe(false);
  });
});

describe("keyStore write path", () => {
  beforeEach(async () => {
    await clearAllKeys();
  });

  it("stores (trimmed), resolves, and clears a valid key", async () => {
    expect(await setKey("IPQS_API_KEY", "  secret-123  ")).toBe(true);
    expect(await resolveKey("IPQS_API_KEY")).toBe("secret-123"); // trimmed
    expect((await configuredMap()).IPQS_API_KEY).toBe("ui");

    expect(await clearKey("IPQS_API_KEY")).toBe(true);
    expect((await configuredMap()).IPQS_API_KEY).not.toBe("ui");
  });

  it("persists every key when concurrent setKey calls race (regression: no lost write)", async () => {
    const names = KEY_NAMES.slice(0, 6);
    await Promise.all(names.map((n, i) => setKey(n, `value-${i}`)));
    const map = await configuredMap();
    for (const n of names) expect(map[n], n).toBe("ui");
  });
});
