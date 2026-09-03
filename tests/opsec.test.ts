import { describe, it, expect } from "vitest";
import { opsecProfile, lookupOpsecProfiles, GLOBAL_OPSEC_NOTES } from "@/lib/analysis/opsec";

describe("opsecProfile", () => {
  it("marks domain as the only mode that touches the target directly", () => {
    const domain = opsecProfile("domain");
    expect(domain?.contactsTarget).toBe(true);
    expect(domain?.targetNote).toMatch(/HTTP\/TLS/);
    expect(domain?.thirdParties.length).toBeGreaterThan(0);
  });

  it("marks image as fully client-side with no third parties", () => {
    const image = opsecProfile("image");
    expect(image?.clientSide).toBe(true);
    expect(image?.contactsTarget).toBe(false);
    expect(image?.thirdParties).toEqual([]);
  });

  it("derives the third-party list from the keyless manifest sources", () => {
    const wallet = opsecProfile("wallet");
    expect(wallet?.contactsTarget).toBe(false);
    expect(wallet?.thirdParties).toEqual(expect.arrayContaining(["mempool.space"]));

    const hash = opsecProfile("hash");
    expect(hash?.thirdParties).toEqual(["CIRCL hashlookup"]);
  });

  it("returns null for a mode with no footprint model", () => {
    expect(opsecProfile("bulk")).toBeNull();
    expect(opsecProfile("cases")).toBeNull();
  });
});

describe("lookupOpsecProfiles", () => {
  it("covers the eight lookup/parse modes in disclosure order", () => {
    const modes = lookupOpsecProfiles().map((p) => p.mode);
    expect(modes).toEqual(["phone", "email", "username", "ip", "domain", "wallet", "hash", "image"]);
  });
});

describe("GLOBAL_OPSEC_NOTES", () => {
  it("states the server-side proxying and authorization facts", () => {
    const joined = GLOBAL_OPSEC_NOTES.join(" ");
    expect(joined).toMatch(/server-side/i);
    expect(joined).toMatch(/authorized/i);
  });
});
