import { describe, it, expect } from "vitest";
import { isValidIp, ipVersion } from "@/lib/server/validation";

// Regression guard for the IPv6 bug: the old hand-rolled regex rejected any
// compressed address with hex groups on BOTH sides of "::" — which is how nearly
// every real IPv6 address is written, including the app's own placeholder. These
// must stay accepted so /api/ip-lookup never 400s a valid address again.

describe("isValidIp / ipVersion", () => {
  it("accepts compressed IPv6 (groups on both sides of ::) — the regressed case", () => {
    for (const ip of [
      "2606:4700:4700::1111", // app placeholder / Cloudflare
      "2001:4860:4860::8888", // Google public DNS v6
      "2001:db8::8a2e:370:7334",
      "fe80::1", // link-local
    ]) {
      expect(isValidIp(ip), ip).toBe(true);
      expect(ipVersion(ip), ip).toBe(6);
    }
  });

  it("accepts canonical, loopback and unspecified IPv6", () => {
    expect(ipVersion("2001:0db8:0000:0000:0000:ff00:0042:8329")).toBe(6);
    expect(ipVersion("::1")).toBe(6);
    expect(ipVersion("::")).toBe(6);
  });

  it("classifies IPv4", () => {
    expect(ipVersion("8.8.8.8")).toBe(4);
    expect(ipVersion("192.168.0.1")).toBe(4);
    expect(isValidIp("1.1.1.1")).toBe(true);
  });

  it("rejects malformed input", () => {
    for (const bad of ["999.1.1.1", "1.2.3", "notanip", "", "2606:4700:::1111", "::gggg"]) {
      expect(isValidIp(bad), bad).toBe(false);
      expect(ipVersion(bad), bad).toBe(0);
    }
  });
});
