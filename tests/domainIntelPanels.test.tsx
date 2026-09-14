// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import {
  SubdomainCoveragePanel, PassiveDnsPanel, HostExposurePanel, ReverseIpPanel, LeiPanel,
} from "@/components/network/DomainIntelPanels";
import type {
  DomainLookupResponse, HostExposureRecord, LeiRecord, PassiveDnsRecord,
} from "@/lib/types";

// Each of these panels reports a number that is easy to over-read: a subdomain
// count is only as good as the sources behind it, a passive-DNS row is history
// rather than the present, a CVE is a banner match, and a co-hosted name on a
// CDN says nothing about ownership. The scope note is the finding, so these
// assert the notes as hard as the numbers.

beforeEach(cleanup);

const domain = (over: Partial<DomainLookupResponse>) => ({ ...over }) as DomainLookupResponse;

const pdns = (over: Partial<PassiveDnsRecord> = {}): PassiveDnsRecord => ({
  query: "example.com", answer: "1.2.3.4", rrtype: "A",
  firstSeen: "2024-01-01", lastSeen: "2025-06-30", times: 12, ...over,
});

const host = (over: Partial<HostExposureRecord> = {}): HostExposureRecord => ({
  ip: "1.2.3.4", ports: null, vulns: null, hostnames: null, tags: null,
  greyNoise: null, isTor: null, isVpn: null, isProxy: null, ...over,
});

const lei = (over: Partial<LeiRecord> = {}): LeiRecord => ({
  lei: "5493001KJTIIGC8Y1R12", legalName: "Acme Holdings PLC", status: "ISSUED",
  country: "GB", legalAddress: "1 High St, London", headquartersAddress: null,
  registeredAs: "01234567", entityStatus: "ACTIVE", exact: true, ...over,
});

describe("SubdomainCoveragePanel", () => {
  it("renders nothing without a coverage breakdown", () => {
    const { container } = render(<SubdomainCoveragePanel data={domain({})} />);
    expect(container.firstChild).toBeNull();
  });

  it("splits the count by source and distinguishes silence from emptiness", () => {
    // "0 found" and "no answer" are different claims; collapsing them is how a
    // subdomain count starts lying.
    render(<SubdomainCoveragePanel data={domain({
      subdomainCoverage: {
        sources: [
          { source: "crt.sh", ok: true, found: 9 },
          { source: "hackertarget", ok: false, found: 0 },
        ],
        distinct: 9, limit: 200, capped: false,
      },
    })} />);
    expect(screen.getByText(/SUBDOMAIN COVERAGE: 9 distinct/)).toBeTruthy();
    expect(screen.getByText("9 found")).toBeTruthy();
    expect(screen.getByText("no answer")).toBeTruthy();
    expect(screen.getByText(/contributed nothing, which is not the same as finding nothing/)).toBeTruthy();
  });

  it("says when the list shown is only a prefix of what was found", () => {
    render(<SubdomainCoveragePanel data={domain({
      subdomainCoverage: {
        sources: [{ source: "crt.sh", ok: true, found: 900 }],
        distinct: 900, limit: 200, capped: true,
      },
    })} />);
    expect(screen.getByText(/Showing the first 200 of 900/)).toBeTruthy();
  });
});

describe("PassiveDnsPanel", () => {
  it("renders nothing when the source is absent or held no records", () => {
    expect(render(<PassiveDnsPanel data={domain({})} />).container.firstChild).toBeNull();
    cleanup();
    expect(render(<PassiveDnsPanel data={domain({
      passiveDns: { records: [], total: 0, capped: false, degraded: false },
    })} />).container.firstChild).toBeNull();
  });

  it("shows each historical pair with the window it was observed in", () => {
    render(<PassiveDnsPanel data={domain({
      passiveDns: { records: [pdns()], total: 1, capped: false, degraded: false },
    })} />);
    expect(screen.getByText(/PASSIVE DNS: 1 historical records/)).toBeTruthy();
    expect(screen.getByText("A")).toBeTruthy();
    expect(screen.getByText("2024-01-01 to 2025-06-30")).toBeTruthy();
    expect(screen.getByText(/an address here may have been abandoned years ago/)).toBeTruthy();
  });

  it("reads a missing last-seen as still current, and omits the window entirely when unseen", () => {
    render(<PassiveDnsPanel data={domain({
      passiveDns: {
        records: [pdns({ lastSeen: null }), pdns({ answer: "5.6.7.8", firstSeen: null })],
        total: 2, capped: false, degraded: false,
      },
    })} />);
    expect(screen.getByText("2024-01-01 to now")).toBeTruthy();
    expect(screen.queryByText(/to 2025-06-30/)).toBeNull();
  });

  it("shows at most forty rows and says so when the source holds more", () => {
    const many = Array.from({ length: 45 }, (_, i) => pdns({ answer: `10.0.0.${i}` }));
    const { container } = render(<PassiveDnsPanel data={domain({
      passiveDns: { records: many, total: 5000, capped: true, degraded: false },
    })} />);
    expect(within(container).getAllByText("A")).toHaveLength(40);
    expect(screen.getByText(/Showing 40 of 5,000/)).toBeTruthy();
  });

  it("warns when the source dropped record types rather than guessing them", () => {
    render(<PassiveDnsPanel data={domain({
      passiveDns: { records: [pdns()], total: 1, capped: false, degraded: true },
    })} />);
    expect(screen.getByText(/records without their types this time/)).toBeTruthy();
  });
});

describe("HostExposurePanel", () => {
  it("renders nothing when no address carried any exposure at all", () => {
    expect(render(<HostExposurePanel data={domain({})} />).container.firstChild).toBeNull();
    cleanup();
    // A record with every field unlearned is not a finding, so it is dropped
    // rather than rendered as an empty card.
    expect(render(<HostExposurePanel data={domain({ hostExposure: [host()] })} />).container.firstChild).toBeNull();
  });

  it("lists ports, CVEs, tags and scanner reputation for an address", () => {
    render(<HostExposurePanel data={domain({
      hostExposure: [host({
        ports: [22, 443],
        vulns: ["CVE-2024-0001"],
        tags: ["cdn"],
        greyNoise: { classification: "malicious", noise: true, riot: false, name: "Mirai", lastSeen: "2026-09-01" },
      })],
    })} />);
    expect(screen.getByText("ports: 22, 443")).toBeTruthy();
    expect(screen.getByText(/CVE-2024-0001/)).toBeTruthy();
    expect(screen.getByText("tags: cdn")).toBeTruthy();
    expect(screen.getByText("GreyNoise: malicious (Mirai)")).toBeTruthy();
    expect(screen.getByText(/not a confirmed exploitable finding/)).toBeTruthy();
  });

  it("names an unnamed actor no further than its classification", () => {
    render(<HostExposurePanel data={domain({
      hostExposure: [host({ greyNoise: { classification: "benign", noise: false, riot: true, name: null, lastSeen: null } })],
    })} />);
    expect(screen.getByText("GreyNoise: benign")).toBeTruthy();
  });

  it("truncates a long CVE list and says how many it left out", () => {
    const vulns = Array.from({ length: 15 }, (_, i) => `CVE-2024-00${i}`);
    render(<HostExposurePanel data={domain({ hostExposure: [host({ vulns })] })} />);
    expect(screen.getByText(/\+3 more/)).toBeTruthy();
  });

  it("shows only the fields an address actually carried", () => {
    render(<HostExposurePanel data={domain({ hostExposure: [host({ ports: [80] })] })} />);
    expect(screen.getByText("ports: 80")).toBeTruthy();
    expect(screen.queryByText(/^tags:/)).toBeNull();
    expect(screen.queryByText(/^CVEs/)).toBeNull();
    expect(screen.queryByText(/^GreyNoise:/)).toBeNull();
  });
});

describe("ReverseIpPanel", () => {
  it("renders nothing without co-hosted names", () => {
    expect(render(<ReverseIpPanel data={domain({})} />).container.firstChild).toBeNull();
    cleanup();
    expect(render(<ReverseIpPanel data={domain({
      reverseIp: { ip: "1.2.3.4", hosts: [], total: 0 },
    })} />).container.firstChild).toBeNull();
  });

  it("links each name back into domain mode and warns what shared hosting means", () => {
    render(<ReverseIpPanel data={domain({
      reverseIp: { ip: "1.2.3.4", hosts: ["a.test", "b.test"], total: 2 },
    })} />);
    expect(screen.getByText(/CO-HOSTED: 2 names on 1\.2\.3\.4/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "a.test" }).getAttribute("href")).toBe("?mode=domain&q=a.test");
    expect(screen.getByText(/means nothing about their owners/)).toBeTruthy();
    expect(screen.queryByText(/Showing 2 of/)).toBeNull();
  });

  it("says when the address holds more names than are listed", () => {
    render(<ReverseIpPanel data={domain({
      reverseIp: { ip: "1.2.3.4", hosts: ["a.test"], total: 400 },
    })} />);
    expect(screen.getByText(/Showing 1 of 400/)).toBeTruthy();
  });
});

describe("LeiPanel", () => {
  it("renders nothing without a register hit", () => {
    expect(render(<LeiPanel data={domain({})} />).container.firstChild).toBeNull();
    cleanup();
    expect(render(<LeiPanel data={domain({
      lei: { records: [], total: 0, query: "Acme", source: "registrant" },
    })} />).container.firstChild).toBeNull();
  });

  it("identifies the company on an exact match, with its register details", () => {
    render(<LeiPanel data={domain({
      lei: { records: [lei()], total: 1, query: "Acme Holdings PLC", source: "registrant" },
    })} />);
    expect(screen.getByText("Acme Holdings PLC")).toBeTruthy();
    expect(screen.getByText("LEI 5493001KJTIIGC8Y1R12")).toBeTruthy();
    expect(screen.getByText("company number 01234567")).toBeTruthy();
    expect(screen.getByText("1 High St, London")).toBeTruthy();
    expect(screen.getByText(/registration ISSUED · entity ACTIVE/)).toBeTruthy();
    expect(screen.getByText(/the domain's WHOIS registrant/)).toBeTruthy();
  });

  it("says 'unknown' rather than leaving a status blank", () => {
    render(<LeiPanel data={domain({
      lei: {
        records: [lei({ status: null, entityStatus: null, registeredAs: null, legalAddress: null })],
        total: 1, query: "Acme", source: "certificate",
      },
    })} />);
    expect(screen.getByText(/registration unknown · entity unknown/)).toBeTruthy();
    expect(screen.queryByText(/company number/)).toBeNull();
    expect(screen.getByText(/OV\/EV TLS certificate/)).toBeTruthy();
  });

  it("keeps a word-match apart from the registrant", () => {
    // The register matches on words, so a near-name is a coincidence until an
    // exact match says otherwise. Listing it as the registrant is the false
    // positive that once named three companies as one.
    render(<LeiPanel data={domain({
      lei: {
        records: [lei(), lei({ lei: "X2", legalName: "Acme Trading Ltd", exact: false })],
        total: 2, query: "Acme Holdings PLC", source: "registrant",
      },
    })} />);
    expect(screen.getByText(/similar names in the register: Acme Trading Ltd/)).toBeTruthy();
    expect(screen.getByText(/only an exact name match identifies the company/)).toBeTruthy();
  });

  it("shows no 'similar names' line when every hit was exact", () => {
    render(<LeiPanel data={domain({
      lei: { records: [lei()], total: 1, query: "Acme Holdings PLC", source: "registrant" },
    })} />);
    expect(screen.queryByText(/similar names in the register/)).toBeNull();
  });
});
