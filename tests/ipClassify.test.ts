import { describe, it, expect } from "vitest";
import { classifyIp } from "@/lib/analysis/ipClassify";

describe("classifyIp — IPv4 special-purpose scopes", () => {
  const cases: Array<[string, string, boolean]> = [
    ["0.0.0.0",         "unspecified",   false],
    ["10.1.2.3",        "private",       false],
    ["172.16.5.4",      "private",       false],
    ["172.31.255.255",  "private",       false],
    ["192.168.0.1",     "private",       false],
    ["100.64.0.1",      "cgnat",         false],
    ["100.127.255.255", "cgnat",         false],
    ["127.0.0.1",       "loopback",      false],
    ["169.254.10.10",   "link-local",    false],
    ["192.0.0.8",       "protocol",      false],
    ["192.88.99.1",     "protocol",      false],
    ["192.0.2.5",       "documentation", false],
    ["198.51.100.7",    "documentation", false],
    ["203.0.113.9",     "documentation", false],
    ["198.18.0.1",      "benchmarking",  false],
    ["224.0.0.1",       "multicast",     false],
    ["240.0.0.1",       "reserved",      false],
    ["255.255.255.255", "reserved",      false],
    ["8.8.8.8",         "global",        true],
    ["1.1.1.1",         "global",        true],
    ["100.128.0.1",     "global",        true], // just outside CGNAT /10
  ];
  it.each(cases)("classifies %s as %s (routable=%s)", (ip, scope, routable) => {
    const c = classifyIp(ip)!;
    expect(c.scope).toBe(scope);
    expect(c.isGloballyRoutable).toBe(routable);
    // A special scope always carries an RFC citation; global does not.
    expect(scope === "global" ? c.rfc : typeof c.rfc).toBe(scope === "global" ? null : "string");
  });

  it("gives global a clean public label and no RFC", () => {
    const c = classifyIp("8.8.8.8")!;
    expect(c.label).toBe("Public");
    expect(c.rfc).toBeNull();
    expect(c.description).toMatch(/public/i);
  });
});

describe("classifyIp — IPv6 special-purpose scopes", () => {
  const cases: Array<[string, string, boolean]> = [
    ["::1",                 "loopback",      false],
    ["::",                  "unspecified",   false],
    ["::ffff:1.2.3.4",      "translation",   false],
    ["64:ff9b::1",          "translation",   false],
    ["2001:db8::1",         "documentation", false],
    ["fc00::1",             "unique-local",  false],
    ["fd12:3456::1",        "unique-local",  false],
    ["fe80::1",             "link-local",    false],
    ["ff02::1",             "multicast",     false],
    ["2606:4700:4700::1111", "global",       true],
  ];
  it.each(cases)("classifies %s as %s (routable=%s)", (ip, scope, routable) => {
    const c = classifyIp(ip)!;
    expect(c.scope).toBe(scope);
    expect(c.isGloballyRoutable).toBe(routable);
  });

  it("parses a fully-expanded IPv6 and a zone-id suffix", () => {
    expect(classifyIp("2001:0db8:0000:0000:0000:0000:0000:0001")!.scope).toBe("documentation");
    expect(classifyIp("fe80::1%eth0")!.scope).toBe("link-local"); // zone id stripped
  });
});

describe("classifyIp — invalid input returns null", () => {
  it.each([
    "not-an-ip",
    "1.2.3",              // too few octets
    "1.2.3.4.5",          // too many octets
    "1.2.3.999",          // octet out of range
    "1.2.3.x",            // non-numeric octet
    "1::2::3",            // more than one "::"
    "gggg::1",            // non-hex group
    "1:2:3:4:5:6:7",      // 7 groups, no "::"
    "1:2:3:4:5:6:7:8::",  // "::" but already 8 groups
    "::ffff:1.2.3.999",   // bad embedded IPv4
  ])("returns null for %s", (bad) => {
    expect(classifyIp(bad)).toBeNull();
  });
});
