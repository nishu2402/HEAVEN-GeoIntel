// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import SubdomainTakeoverPanel from "@/components/network/SubdomainTakeoverPanel";
import TyposquatPanel from "@/components/network/TyposquatPanel";
import type { TakeoverCandidate } from "@/lib/types";

beforeEach(cleanup);

describe("SubdomainTakeoverPanel", () => {
  it("renders nothing when there are no candidates", () => {
    const { container } = render(<SubdomainTakeoverPanel candidates={undefined} />);
    expect(container.firstChild).toBeNull();
    const { container: c2 } = render(<SubdomainTakeoverPanel candidates={[]} />);
    expect(c2.firstChild).toBeNull();
  });

  it("renders candidate names, services, fingerprints and status colours", () => {
    const candidates: TakeoverCandidate[] = [
      { name: "vuln.acme.test", host: "victim.github.io", service: "GitHub Pages", status: "edge-case", fingerprint: "There isn't a GitHub Pages site here.", reference: "https://example.com/ref" },
      { name: "acme.test", host: "b.s3.amazonaws.com", service: "AWS S3", status: "vulnerable", fingerprint: "NoSuchBucket", reference: "https://example.com/ref" },
    ];
    render(<SubdomainTakeoverPanel candidates={candidates} />);
    expect(screen.getByText(/SUBDOMAIN-TAKEOVER CANDIDATES: 2/)).toBeTruthy();
    expect(screen.getAllByText("vuln.acme.test").length).toBeGreaterThan(0);
    expect(screen.getByText(/GitHub Pages · EDGE-CASE/)).toBeTruthy();
    expect(screen.getByText(/AWS S3 · VULNERABLE/)).toBeTruthy();
    expect(screen.getByText(/There isn't a GitHub Pages site here/)).toBeTruthy();
    expect(screen.getAllByText(/can-i-take-over-xyz reference/)).toHaveLength(2);
  });
});

describe("TyposquatPanel", () => {
  it("renders nothing for an unparseable domain", () => {
    const { container } = render(<TyposquatPanel domain="localhost" />);
    expect(container.firstChild).toBeNull();
  });

  it("lists look-alike variants as new-tab domain-lookup deep links", () => {
    render(<TyposquatPanel domain="example.com" />);
    expect(screen.getByText(/LOOK-ALIKE DOMAINS/)).toBeTruthy();
    const link = screen.getByText("example.net").closest("a") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("?mode=domain&q=example.net");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("copies all variants and reverts the confirmation", () => {
    render(<TyposquatPanel domain="example.com" />);
    vi.useFakeTimers();
    fireEvent.click(screen.getByText("Copy all"));
    expect(screen.getByText("Copied")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(1700); });
    vi.useRealTimers();
    expect(screen.getByText("Copy all")).toBeTruthy();
  });
});
