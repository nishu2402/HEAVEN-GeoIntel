// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { installMemoryLocalStorage, installResizeObserver } from "./testUtils";
import DomainResultsDashboard from "@/components/network/DomainResultsDashboard";
import type { DomainLookupResponse, DnsRecord } from "@/lib/types";

// GlanceCard/CopyLinkButton/Tilt3D read localStorage + ResizeObserver.
beforeAll(() => { installMemoryLocalStorage(); installResizeObserver(); });
beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const rec = (value: string, over: Partial<DnsRecord> = {}): DnsRecord => ({ type: "A", value, ...over });

const domainData = (over: Partial<DomainLookupResponse> = {}): DomainLookupResponse => ({
  domain: "example.com", isValid: true,
  dns: { a: [rec("93.184.216.34")], aaaa: [], mx: [rec("mail.example.com", { type: "MX", priority: 10, ttl: 3600 })],
    txt: [], ns: [rec("ns1.example.com", { type: "NS" })], cname: [] },
  whois: { registrar: "MarkMonitor", createdDate: "2007-01-01T00:00:00Z", updatedDate: "2024-01-01T00:00:00Z",
    expiresDate: "2027-01-01T00:00:00Z", nameservers: [], statuses: ["clientTransferProhibited"],
    registrantOrg: "Example Inc", registrantCountry: "US" },
  subdomains: ["www.example.com", "api.example.com"],
  emailSecurity: { hasSpf: true, spf: "v=spf1 -all", hasDmarc: true, dmarcPolicy: "quarantine", hasMx: true },
  dnssec: true,
  wayback: { available: true, firstSnapshot: "2001-05-01", snapshotUrl: "https://web.archive.org/x" },
  http: null,
  pivots: [{ label: "crt.sh", url: "https://crt.sh/?q=example.com", note: "certificate transparency" }],
  ...over,
});

describe("<DomainResultsDashboard>", () => {
  it("renders the header, DNS record blocks, WHOIS, subdomains and pivots", () => {
    render(<DomainResultsDashboard data={domainData()} />);
    expect(screen.getByText("example.com")).toBeTruthy();
    expect(screen.getByText(/1 A · 1 MX · 1 NS · 2 subdomains/)).toBeTruthy();
    expect(screen.getByText("93.184.216.34")).toBeTruthy();
    expect(screen.getByText("mail.example.com")).toBeTruthy();
    expect(screen.getByText("10")).toBeTruthy();        // MX priority
    expect(screen.getByText("ttl 3600")).toBeTruthy();
    expect(screen.getByText("MarkMonitor")).toBeTruthy();
    expect(screen.getByText("2007-01-01")).toBeTruthy(); // formatted created date
    expect(screen.getByText("Example Inc")).toBeTruthy();
    expect(screen.getByText("clientTransferProhibited")).toBeTruthy();
    expect(screen.getByText(/Signed \(DNSKEY present\)/)).toBeTruthy();
    expect(screen.getByText("2001-05-01")).toBeTruthy(); // wayback
    expect(screen.getByText("www.example.com")).toBeTruthy();
    expect(screen.getByText("crt.sh")).toBeTruthy();
    expect(screen.getByText(/SPF: v=spf1 -all/)).toBeTruthy();
  });

  it("shows the offline catalog's known breaches for the domain when present", () => {
    render(<DomainResultsDashboard data={domainData({
      knownBreaches: [
        { name: "Adobe", domain: "example.com", date: "2013-10-04", records: 152_000_000,
          dataClasses: ["Passwords", "Email addresses"], verified: true },
      ],
    })} />);
    expect(screen.getByText(/1 breach in the public catalog is recorded against example.com/)).toBeTruthy();
    expect(screen.getByText("Adobe")).toBeTruthy();
    // The jump chip appears only when there are breaches.
    expect(screen.getAllByText("Breaches").length).toBeGreaterThan(0);
  });

  it("offers the IP pivot when an A record resolves and a handler is supplied", () => {
    const onIpLookup = vi.fn();
    render(<DomainResultsDashboard data={domainData()} onIpLookup={onIpLookup} />);
    fireEvent.click(screen.getByRole("button", { name: /look up .* as ip/i }));
    expect(onIpLookup).toHaveBeenCalledWith("93.184.216.34");
  });

  it("hides the IP pivot when no handler is supplied", () => {
    render(<DomainResultsDashboard data={domainData()} />);
    expect(screen.queryByRole("button", { name: /as ip/i })).toBeNull();
  });

  it("hides the IP pivot when there is no resolvable address", () => {
    render(<DomainResultsDashboard data={domainData({ dns: { a: [], aaaa: [], mx: [], txt: [], ns: [], cname: [] } })}
      onIpLookup={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /as ip/i })).toBeNull();
  });

  it("shows the empty-DNS notice and the spoofable email-security posture", () => {
    render(<DomainResultsDashboard data={domainData({
      dns: { a: [], aaaa: [], mx: [], txt: [], ns: [], cname: [] },
      emailSecurity: { hasSpf: false, spf: null, hasDmarc: false, dmarcPolicy: null, hasMx: false },
      subdomains: [],
    })} />);
    expect(screen.getByText(/No DNS records resolved/i)).toBeTruthy();
    expect(screen.getByText(/No SPF: spoofable/)).toBeTruthy();
    expect(screen.getByText(/No DMARC: spoofable/)).toBeTruthy();
    expect(screen.getByText(/No mail servers/)).toBeTruthy();
    // no SPF string row when spf is null
    expect(screen.queryByText(/^SPF: /)).toBeNull();
  });

  it("renders the WHOIS-unavailable and unsigned-DNSSEC states", () => {
    render(<DomainResultsDashboard data={domainData({
      whois: null, dnssec: false, wayback: null,
      emailSecurity: { hasSpf: true, spf: "v=spf1", hasDmarc: true, dmarcPolicy: null, hasMx: true },
    })} />);
    expect(screen.getByText(/WHOIS unavailable/i)).toBeTruthy();
    expect(screen.getByText(/Not signed: DNS responses are forgeable/)).toBeTruthy();
    // DMARC with no explicit policy falls back to "set"
    expect(screen.getByText(/policy: set/)).toBeTruthy();
  });

  it("drops the Subdomains jump link and section when there are none", () => {
    render(<DomainResultsDashboard data={domainData({ subdomains: [] })} />);
    expect(screen.queryByText(/via certificate transparency/i)).toBeNull();
  });

  it("colours DMARC by policy: reject is the strongest", () => {
    render(<DomainResultsDashboard data={domainData({
      emailSecurity: { hasSpf: true, spf: null, hasDmarc: true, dmarcPolicy: "reject", hasMx: true },
    })} />);
    // the DMARC glance tile shows the policy value
    expect(screen.getAllByText("reject").length).toBeGreaterThan(0);
  });

  it("uses a placeholder href when the wayback snapshot URL is missing", () => {
    render(<DomainResultsDashboard data={domainData({
      wayback: { available: true, firstSnapshot: "1999-12-31", snapshotUrl: null },
    })} />);
    const link = screen.getByText("1999-12-31").closest("a")!;
    expect(link.getAttribute("href")).toBe("#");
  });

  it("falls back to the raw WHOIS date when it cannot be parsed", () => {
    render(<DomainResultsDashboard data={domainData({
      whois: { registrar: "R", createdDate: "garbage", updatedDate: null, expiresDate: null,
        nameservers: [], statuses: [], registrantOrg: null, registrantCountry: null },
    })} />);
    expect(screen.getByText("garbage")).toBeTruthy();
  });
});

describe("<DomainResultsDashboard>: live HTTP layer", () => {
  const httpProbe = (grade: "A" | "B" | "C" | "D" | "F") => ({
    url: "https://example.com/", status: 200, redirectChain: [], httpsRedirect: true,
    security: {
      checks: [{ name: "X-Content-Type-Options", present: true, value: "nosniff", score: 15, max: 15, note: "nosniff" }],
      score: 15, max: 100, percent: 15, grade,
    },
    tech: [], disclosures: [], cookies: [], title: "Example Domain", tls: null,
  });

  it("shows the HTTP panel, the grade tile and the jump link when a probe ran", () => {
    render(<DomainResultsDashboard data={domainData({ http: httpProbe("B") })} />);
    expect(screen.getByText(/LIVE HTTP & TLS POSTURE/)).toBeTruthy();
    expect(screen.getByText("HTTP hdrs")).toBeTruthy();
    expect(screen.getByText("HTTP/TLS")).toBeTruthy();
  });

  it.each(["A", "B", "C", "D", "F"] as const)("paints the %s grade on the glance tile", (grade) => {
    render(<DomainResultsDashboard data={domainData({ http: httpProbe(grade) })} />);
    // The grade appears on the tile and again inside the panel's badge.
    expect(screen.getAllByText(grade).length).toBeGreaterThanOrEqual(1);
  });

  it("omits the panel, the tile and the jump link when nothing answered on 443", () => {
    render(<DomainResultsDashboard data={domainData({ http: null })} />);
    expect(screen.queryByText(/LIVE HTTP & TLS POSTURE/)).toBeNull();
    expect(screen.queryByText("HTTP hdrs")).toBeNull();
    expect(screen.queryByText("HTTP/TLS")).toBeNull();
  });

  it("always offers the email permutation panel: it needs only the domain", () => {
    render(<DomainResultsDashboard data={domainData({ http: null })} />);
    expect(screen.getByText("EMAIL PERMUTATIONS")).toBeTruthy();
    expect(screen.getByPlaceholderText("known.person@example.com")).toBeTruthy();
  });
});
