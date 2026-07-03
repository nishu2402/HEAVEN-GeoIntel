import { describe, it, expect } from "vitest";
import { setKey, clearKey, KEY_NAMES } from "@/lib/server/keyStore";

// These assertions deliberately exercise only the reject paths, which return
// BEFORE any file write — so the test never touches a real .data/keys.json.
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
