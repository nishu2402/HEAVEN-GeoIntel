import { describe, it, expect } from "vitest";
import { domainToIpPivot, ipToDomainPivot, ipsFromRecords } from "@/lib/analysis/crossPivots";

describe("ipsFromRecords", () => {
  it("returns every valid IP, de-duplicated in order, skipping junk", () => {
    expect(ipsFromRecords([
      { value: "1.1.1.1" }, { value: "bad" }, { value: "1.1.1.1" }, { value: "2001:db8::1" },
    ])).toEqual(["1.1.1.1", "2001:db8::1"]);
  });
  it("returns an empty array when nothing is a valid IP", () => {
    expect(ipsFromRecords([{ value: "" }, { value: "nope" }])).toEqual([]);
  });
});

describe("domainToIpPivot", () => {
  it("returns the first valid IP from the address records", () => {
    expect(domainToIpPivot([{ value: "93.184.216.34" }])).toBe("93.184.216.34");
    expect(domainToIpPivot([{ value: "2606:2800:220:1:248:1893:25c8:1946" }])).toBe("2606:2800:220:1:248:1893:25c8:1946");
  });

  it("skips malformed records and picks the first usable one", () => {
    expect(domainToIpPivot([{ value: "not-an-ip" }, { value: "10.0.0.1" }])).toBe("10.0.0.1");
    expect(domainToIpPivot([{ value: "999.1.1.1" }, { value: "1.1.1.1" }])).toBe("1.1.1.1"); // octet > 255 rejected
    expect(domainToIpPivot([{ value: "01.2.3.4" }, { value: "8.8.8.8" }])).toBe("8.8.8.8"); // leading zero rejected
  });

  it("tolerates a record with a missing value", () => {
    expect(domainToIpPivot([{ value: undefined as unknown as string }, { value: "1.1.1.1" }])).toBe("1.1.1.1");
  });

  it("returns null when there is no usable address record", () => {
    expect(domainToIpPivot([])).toBeNull();
    expect(domainToIpPivot([{ value: "" }, { value: "nope" }])).toBeNull();
  });
});

describe("ipToDomainPivot", () => {
  it("returns a plausible reverse-DNS hostname, normalised", () => {
    expect(ipToDomainPivot("dns.google")).toBe("dns.google");
    expect(ipToDomainPivot("One.One.One.One.")).toBe("one.one.one.one"); // lowercased, trailing dot stripped
    expect(ipToDomainPivot("ec2-1-2-3-4.compute-1.amazonaws.com")).toBe("ec2-1-2-3-4.compute-1.amazonaws.com");
  });

  it("rejects PTR arpa zones, single labels, and empty input", () => {
    expect(ipToDomainPivot("4.3.2.1.in-addr.arpa")).toBeNull();
    expect(ipToDomainPivot("b.a.9.8.ip6.arpa")).toBeNull();
    expect(ipToDomainPivot("localhost")).toBeNull(); // single label, no TLD
    expect(ipToDomainPivot(null)).toBeNull();
    expect(ipToDomainPivot(undefined)).toBeNull();
    expect(ipToDomainPivot("")).toBeNull();
  });
});
