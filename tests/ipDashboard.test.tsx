// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { installMemoryLocalStorage, installResizeObserver } from "./testUtils";
import IpResultsDashboard from "@/components/network/IpResultsDashboard";
import type { IpLookupResponse, IpLookupData } from "@/lib/types";

beforeAll(() => { installMemoryLocalStorage(); installResizeObserver(); });
beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const ipData = (over: Partial<IpLookupData> = {}): IpLookupData => ({
  ip: "8.8.8.8", type: "IPv4", city: "Mountain View", region: "California", country: "United States",
  countryCode: "US", continent: "North America", latitude: 37.4, longitude: -122.0, postal: "94043",
  timezone: "America/Los_Angeles", utcOffset: "-08:00", asn: 15169, asnOrg: "Google LLC", isp: "Google",
  org: "Google Public DNS", isProxy: false, isVpn: false, isTor: false, isHosting: true, isMobile: false,
  flagEmoji: "🇺🇸", reverse: "dns.google", ports: [53, 443], vulns: ["CVE-2021-1234"],
  hostnames: ["dns.google"], tags: ["cdn"],
  greyNoise: { classification: "benign", noise: true, riot: true, name: "Google", lastSeen: "2025-01-01" },
  ...over,
});

const resp = (over: Partial<IpLookupResponse> = {}): IpLookupResponse => ({
  input: "8.8.8.8", ip: ipData(), pivots: [{ label: "Censys", url: "https://censys.io/8.8.8.8", note: "host data" }],
  threatScore: 10, threatLabel: "CLEAN",
  sources: [{ source: "ip-api", ok: true, ms: 42, fetchedAt: Date.now() }],
  ...over,
});

describe("<IpResultsDashboard> non-routable / error", () => {
  it("renders the offline classification for a non-routable address", () => {
    render(<IpResultsDashboard data={{
      input: "10.0.0.1", ip: null, pivots: [], threatScore: 0, threatLabel: "N/A",
      classification: { scope: "private", label: "Private (RFC 1918)", description: "Internal network address.",
        isGloballyRoutable: false, rfc: "RFC 1918" },
    }} />);
    expect(screen.getByText(/NON-ROUTABLE ADDRESS/)).toBeTruthy();
    expect(screen.getByText("PRIVATE (RFC 1918)")).toBeTruthy();
    expect(screen.getByText("RFC 1918")).toBeTruthy();
    expect(screen.getByText(/Internal network address/)).toBeTruthy();
  });

  it("omits the RFC chip when the classification has none", () => {
    render(<IpResultsDashboard data={{
      input: "0.0.0.0", ip: null, pivots: [], threatScore: 0, threatLabel: "N/A",
      classification: { scope: "unspecified", label: "Unspecified", description: "The any address.",
        isGloballyRoutable: false, rfc: null },
    }} />);
    expect(screen.getByText("UNSPECIFIED")).toBeTruthy();
    expect(screen.queryByText(/^RFC/)).toBeNull();
  });

  it("renders the failure state when the lookup returned no data", () => {
    const { unmount } = render(<IpResultsDashboard data={{ input: "8.8.8.8", ip: null, pivots: [], threatScore: 0, threatLabel: "N/A", error: "timeout" }} />);
    expect(screen.getByText(/IP LOOKUP FAILED/)).toBeTruthy();
    expect(screen.getByText("timeout")).toBeTruthy();
    unmount();
    // routable-but-null with no error → "No data"
    render(<IpResultsDashboard data={{ input: "8.8.8.8", ip: null, pivots: [], threatScore: 0, threatLabel: "N/A",
      classification: { scope: "global", label: "Global", description: "x", isGloballyRoutable: true, rfc: null } }} />);
    expect(screen.getByText("No data")).toBeTruthy();
  });
});

describe("<IpResultsDashboard> full result", () => {
  it("renders geo, network, exposure and pivots", () => {
    render(<IpResultsDashboard data={resp()} />);
    expect(screen.getByText("8.8.8.8")).toBeTruthy();
    expect(screen.getByText("Mountain View")).toBeTruthy();
    expect(screen.getByText(/United States \(US\)/)).toBeTruthy();
    expect(screen.getByText("37.4, -122")).toBeTruthy();
    expect(screen.getByText(/America\/Los_Angeles \(-08:00\)/)).toBeTruthy();
    expect(screen.getAllByText("AS15169").length).toBeGreaterThan(0); // glance tile + network row
    expect(screen.getAllByText("dns.google").length).toBe(2);          // reverse DNS + hostname
    expect(screen.getByText(/Open ports \(2\)/)).toBeTruthy();
    expect(screen.getByText("53")).toBeTruthy();
    expect(screen.getByText(/Known CVEs \(1\)/)).toBeTruthy();
    expect(screen.getByText("CVE-2021-1234")).toBeTruthy();
    expect(screen.getByText("cdn")).toBeTruthy();
    expect(screen.getByText("Censys")).toBeTruthy();
    expect(screen.getByText(/View on OpenStreetMap/)).toBeTruthy();
    // GreyNoise chip with RIOT + SCANNER suffixes
    expect(screen.getByText(/GREYNOISE: BENIGN · RIOT · SCANNER/)).toBeTruthy();
    // source provenance chip
    expect(screen.getByText(/ip-api · 42ms/)).toBeTruthy();
  });

  it("offers the reverse-DNS domain pivot only with a handler and a hostname", () => {
    const onDomainLookup = vi.fn();
    const { unmount } = render(<IpResultsDashboard data={resp()} onDomainLookup={onDomainLookup} />);
    fireEvent.click(screen.getByRole("button", { name: /investigate .* as domain/i }));
    expect(onDomainLookup).toHaveBeenCalledWith("dns.google");
    unmount();

    // no handler → no button
    render(<IpResultsDashboard data={resp()} />);
    expect(screen.queryByRole("button", { name: /as domain/i })).toBeNull();
  });

  it("suppresses the domain pivot for an arpa reverse-DNS name", () => {
    render(<IpResultsDashboard data={resp({ ip: ipData({ reverse: "1.0.0.10.in-addr.arpa" }) })} onDomainLookup={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /as domain/i })).toBeNull();
  });

  it("falls back to the globe emoji and hides map link when coords are absent", () => {
    render(<IpResultsDashboard data={resp({ ip: ipData({ flagEmoji: null, latitude: null, longitude: null }) })} />);
    expect(screen.getByText("🌐")).toBeTruthy();
    expect(screen.queryByText(/View on OpenStreetMap/)).toBeNull();
  });

  it("hides the exposure section entirely when Shodan returned nothing", () => {
    render(<IpResultsDashboard data={resp({ ip: ipData({ ports: null, vulns: null, hostnames: null, tags: null }) })} />);
    expect(screen.queryByText(/INTERNET EXPOSURE/)).toBeNull();
  });

  it("hides the Tor flag when its state is unknown and shows an unknown-VPN glance dash", () => {
    render(<IpResultsDashboard data={resp({ ip: ipData({ isTor: null, isVpn: null, isHosting: null }) })} />);
    expect(screen.queryByText(/^TOR:/)).toBeNull();
    // VPN / proxy glance tile shows "—" for unknown
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("colours a malicious GreyNoise classification and omits the ASN-org fallback label", () => {
    render(<IpResultsDashboard data={resp({
      ip: ipData({ asnOrg: null, greyNoise: { classification: "malicious", noise: false, riot: false, name: null, lastSeen: null } }),
    })} />);
    expect(screen.getByText(/GREYNOISE: MALICIOUS/)).toBeTruthy();
    // ASN glance tile falls back to AS<n> when asnOrg is null (also in the network row)
    expect(screen.getAllByText("AS15169").length).toBeGreaterThan(0);
  });

  it("shows a failed source provenance chip with its error", () => {
    render(<IpResultsDashboard data={resp({ sources: [{ source: "shodan", ok: false, ms: 12, fetchedAt: Date.now(), error: "429" }] })} />);
    expect(screen.getByText(/shodan · 12ms · 429/)).toBeTruthy();
  });

  it("handles an unknown GreyNoise classification and a missing ASN", () => {
    render(<IpResultsDashboard data={resp({
      ip: ipData({ asn: null, greyNoise: { classification: "unknown", noise: false, riot: false, name: "x", lastSeen: null } }),
    })} />);
    expect(screen.getByText(/GREYNOISE: UNKNOWN/)).toBeTruthy();
  });

  it("marks VPN and hosting as Yes in the glance tiles when confirmed", () => {
    render(<IpResultsDashboard data={resp({ ip: ipData({ isVpn: true, isHosting: true }) })} />);
    // both glance tiles read "Yes"
    expect(screen.getAllByText("Yes").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/VPN\/PROXY: YES/)).toBeTruthy(); // flag chip too
  });

  it("marks hosting as No when the source explicitly says so", () => {
    render(<IpResultsDashboard data={resp({ ip: ipData({ isVpn: false, isHosting: false }) })} />);
    // Hosting glance tile reads "No" (=== false branch)
    expect(screen.getAllByText("No").length).toBeGreaterThan(0);
    expect(screen.getByText(/HOSTING: NO/)).toBeTruthy();
  });

  it("colours the risk bar and tile across every threat band", () => {
    for (const [score, label] of [[85, "CRITICAL"], [55, "HIGH"], [25, "MODERATE"], [5, "CLEAN"]] as const) {
      cleanup();
      render(<IpResultsDashboard data={resp({ threatScore: score, threatLabel: label })} />);
      expect(screen.getAllByText(String(score)).length).toBeGreaterThan(0);
      expect(screen.getByText(new RegExp(`${score} · ${label}`))).toBeTruthy();
    }
  });

  it("shows dashes and 'Location unknown' when geography is entirely absent", () => {
    render(<IpResultsDashboard data={resp({ ip: ipData({
      country: null, countryCode: null, city: null, region: null,
      timezone: null, utcOffset: null, asnOrg: null, asn: null,
    }) })} />);
    expect(screen.getByText(/Location unknown/)).toBeTruthy();
    // Country + Timezone rows are omitted entirely when null (Row returns null)
    expect(screen.queryByText("Timezone")).toBeNull();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0); // glance dashes
  });

  it("renders country without a code and timezone without an offset", () => {
    render(<IpResultsDashboard data={resp({ ip: ipData({ countryCode: null, utcOffset: null }) })} />);
    expect(screen.getAllByText("United States").length).toBeGreaterThan(0); // no "(US)" — glance tile + geo row
    expect(screen.queryByText(/United States \(/)).toBeNull();               // no parenthetical code
    expect(screen.getByText("America/Los_Angeles")).toBeTruthy();            // no "(-08:00)"
  });
});
