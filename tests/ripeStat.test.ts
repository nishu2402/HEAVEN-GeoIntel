import { describe, it, expect } from "vitest";
import { parseAbuse, parseNetwork, parseAnnounced } from "@/lib/analysis/ripeStat";

describe("parseAbuse", () => {
  it("extracts the first abuse contact", () => {
    expect(parseAbuse({ data: { abuse_contacts: ["abuse@example.net", "b@x"] } })).toBe("abuse@example.net");
  });
  it("trims whitespace", () => {
    expect(parseAbuse({ data: { abuse_contacts: ["  abuse@x  "] } })).toBe("abuse@x");
  });
  it("returns null for empty, blank, non-string, or malformed input", () => {
    expect(parseAbuse({ data: { abuse_contacts: [] } })).toBeNull();
    expect(parseAbuse({ data: { abuse_contacts: ["   "] } })).toBeNull();
    expect(parseAbuse({ data: { abuse_contacts: [42] } })).toBeNull();
    expect(parseAbuse({ data: {} })).toBeNull();
    expect(parseAbuse({})).toBeNull();
    expect(parseAbuse(null)).toBeNull();
  });
});

describe("parseNetwork", () => {
  it("extracts the covering prefix and first ASN", () => {
    expect(parseNetwork({ data: { prefix: "8.8.8.0/24", asns: ["15169", "36040"] } }))
      .toEqual({ prefix: "8.8.8.0/24", asn: "15169" });
  });
  it("handles a missing prefix or ASN independently", () => {
    expect(parseNetwork({ data: { asns: ["15169"] } })).toEqual({ prefix: null, asn: "15169" });
    expect(parseNetwork({ data: { prefix: "1.0.0.0/24" } })).toEqual({ prefix: "1.0.0.0/24", asn: null });
    expect(parseNetwork({ data: { prefix: "  ", asns: [""] } })).toEqual({ prefix: null, asn: null });
    expect(parseNetwork({ data: { asns: [7] } })).toEqual({ prefix: null, asn: null });
    expect(parseNetwork(null)).toEqual({ prefix: null, asn: null });
  });
});

describe("parseAnnounced", () => {
  it("counts announced prefixes", () => {
    expect(parseAnnounced({ data: { prefixes: [{ prefix: "a" }, { prefix: "b" }] } })).toBe(2);
    expect(parseAnnounced({ data: { prefixes: [] } })).toBe(0);
  });
  it("returns null when there is no prefix list", () => {
    expect(parseAnnounced({ data: {} })).toBeNull();
    expect(parseAnnounced(null)).toBeNull();
  });
});
