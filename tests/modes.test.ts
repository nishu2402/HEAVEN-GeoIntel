import { describe, it, expect } from "vitest";
import { MODES, LOOKUP_MODES, modeName, detectMode, toMode, type Mode } from "@/lib/client/modes";

// The mode registry backs the tab switcher, command palette, and the
// shareable-URL round-trip; detectMode powers the palette's "smart run".

describe("MODES registry invariants", () => {
  it("has 11 modes with unique ids", () => {
    expect(MODES).toHaveLength(11);
    expect(new Set(MODES.map((m) => m.id)).size).toBe(11);
  });

  it("exposes exactly the 7 single-input lookup modes, each with a placeholder", () => {
    // `image` is a client-only mode (EXIF parsed in the browser, no API), so it
    // is deliberately NOT a lookup mode and carries no placeholder.
    expect(LOOKUP_MODES.map((m) => m.id)).toEqual(["phone", "email", "username", "ip", "domain", "wallet", "hash"]);
    for (const m of LOOKUP_MODES) expect(m.placeholder, m.id).toBeTruthy();
  });

  it("gives every mode a non-empty label and glyph", () => {
    for (const m of MODES) {
      expect(m.label, m.id).toBeTruthy();
      expect(m.glyph, m.id).toBeTruthy();
    }
  });
});

describe("modeName: proper-case menu label", () => {
  it("keeps the IP acronym whole instead of title-casing it to 'Ip'", () => {
    const ip = MODES.find((m) => m.id === "ip")!;
    expect(modeName(ip)).toBe("IP");
  });

  it("title-cases an ordinary word label", () => {
    const phone = MODES.find((m) => m.id === "phone")!;
    expect(modeName(phone)).toBe("Phone");
  });

  it("produces a non-empty proper-case name for every mode", () => {
    for (const m of MODES) {
      const name = modeName(m);
      expect(name, m.id).toBeTruthy();
      // No mode should render as an all-caps shout except a deliberate acronym.
      expect(/^[A-Z][a-z]*$/.test(name) || name === m.label, m.id).toBe(true);
    }
  });
});

describe("detectMode: best-effort classification", () => {
  const cases: [string, Mode][] = [
    ["+14155552671", "phone"],
    ["+1 415 555 2671", "phone"],
    ["target@domain.com", "email"],
    ["8.8.8.8", "ip"],
    ["2606:4700:4700::1111", "ip"],
    ["github.com", "domain"],
    ["sub.example.co.uk", "domain"],
    ["0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", "wallet"], // ETH
    ["1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", "wallet"],         // BTC legacy
    ["bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", "wallet"], // BTC bech32
    ["vitalik.eth", "wallet"],                                // ENS name → wallet, not domain
    ["8ed4b4ed952526d89899e723f3488de4", "hash"],             // MD5 (32 hex)
    ["da39a3ee5e6b4b0d3255bfef95601890afd80709", "hash"],     // SHA-1 (40 hex)
    ["e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "hash"], // SHA-256 (64 hex)
    ["torvalds", "username"],
    ["", "username"],
  ];
  it.each(cases)("classifies %j as %s", (input, mode) => {
    expect(detectMode(input)).toBe(mode);
  });
});

describe("toMode: narrowing an untrusted URL parameter", () => {
  it("accepts every id in the registry", () => {
    for (const m of MODES) expect(toMode(m.id)).toBe(m.id);
  });

  it("rejects anything that is not a mode", () => {
    // ?mode= comes straight off the address bar, so it is attacker-controlled
    // in the sense that any string can arrive. Non-modes fall back to null and
    // the caller keeps its default rather than rendering an unknown tab.
    for (const junk of ["", "PHONE", "telephone", "graph ", "__proto__", "toString"]) {
      expect(toMode(junk), junk).toBeNull();
    }
    expect(toMode(null)).toBeNull();
    expect(toMode(undefined)).toBeNull();
  });
});
