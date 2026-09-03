// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import HttpPosturePanel from "@/components/network/HttpPosturePanel";
import { gradeSecurityHeaders } from "@/lib/analysis/httpPosture";
import type { HttpProbe, HeaderMap } from "@/lib/types";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const probe = (over: Partial<HttpProbe> = {}, headers: HeaderMap = {}): HttpProbe => ({
  url: "https://example.com/",
  status: 200,
  redirectChain: [],
  httpsRedirect: true,
  security: gradeSecurityHeaders(headers),
  tech: [],
  disclosures: [],
  cookies: [],
  title: "Example Domain",
  tls: null,
  ...over,
});

describe("<HttpPosturePanel>", () => {
  it("renders the status line, title and header grade", () => {
    render(<HttpPosturePanel http={probe()} />);
    expect(screen.getByText(/LIVE HTTP & TLS POSTURE/)).toBeTruthy();
    expect(screen.getByText(/HTTP 200 · https:\/\/example\.com\//)).toBeTruthy();
    expect(screen.getByText("Example Domain")).toBeTruthy();
    expect(screen.getByText("F")).toBeTruthy();   // no security headers at all
    expect(screen.getByText("0%")).toBeTruthy();
  });

  it("omits the title line when the page has no <title>", () => {
    render(<HttpPosturePanel http={probe({ title: null })} />);
    expect(screen.queryByText("Example Domain")).toBeNull();
  });

  it("confirms an http→https upgrade", () => {
    render(<HttpPosturePanel http={probe({ httpsRedirect: true })} />);
    expect(screen.getByText(/http:\/\/ redirects to https:\/\//)).toBeTruthy();
  });

  it("warns when http serves cleartext", () => {
    render(<HttpPosturePanel http={probe({ httpsRedirect: false })} />);
    expect(screen.getByText(/does NOT redirect/)).toBeTruthy();
  });

  it("says nothing about the upgrade when port 80 was unreachable", () => {
    render(<HttpPosturePanel http={probe({ httpsRedirect: null })} />);
    expect(screen.queryByText(/redirects to https/)).toBeNull();
    expect(screen.queryByText(/does NOT redirect/)).toBeNull();
  });

  it("lists every redirect hop", () => {
    render(<HttpPosturePanel http={probe({
      redirectChain: ["301 https://a/ → https://b/", "302 https://b/ → https://c/"],
    })} />);
    expect(screen.getByText("301 https://a/ → https://b/")).toBeTruthy();
    expect(screen.getByText("302 https://b/ → https://c/")).toBeTruthy();
  });

  it("marks a passing check differently from a partial and a failing one", () => {
    render(<HttpPosturePanel http={probe({}, {
      "x-content-type-options": "nosniff",                    // full marks
      "referrer-policy": "unsafe-url",                        // partial
      // Permissions-Policy absent                            // zero
    })} />);
    expect(screen.getByText(/nosniff: MIME confusion blocked/)).toBeTruthy();
    expect(screen.getByText(/still forwards the full URL/)).toBeTruthy();
    expect(screen.getByText(/powerful browser APIs are unrestricted/)).toBeTruthy();
  });

  it.each([
    ["A", { "strict-transport-security": "max-age=31536000; includeSubDomains; preload",
            "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
            "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
            "permissions-policy": "camera=()", "cross-origin-opener-policy": "same-origin" }],
    ["B", { "strict-transport-security": "max-age=31536000; includeSubDomains; preload",
            "x-content-type-options": "nosniff", "x-frame-options": "DENY",
            "referrer-policy": "no-referrer", "permissions-policy": "camera=()",
            "cross-origin-opener-policy": "same-origin" }],
    ["C", { "strict-transport-security": "max-age=31536000; includeSubDomains; preload",
            "x-content-type-options": "nosniff", "x-frame-options": "DENY",
            "referrer-policy": "no-referrer", "permissions-policy": "camera=()" }],
    ["D", { "strict-transport-security": "max-age=31536000; includeSubDomains; preload",
            "x-content-type-options": "nosniff", "x-frame-options": "DENY" }],
    ["F", {}],
  ])("colours the %s grade badge", (grade, headers) => {
    render(<HttpPosturePanel http={probe({}, headers as HeaderMap)} />);
    expect(screen.getByText(grade)).toBeTruthy();
  });

  it("renders the certificate block with a trusted chain", () => {
    render(<HttpPosturePanel http={probe({
      tls: {
        protocol: "TLSv1.3", cipher: "TLS_AES_128_GCM_SHA256",
        issuer: "Let's Encrypt", subject: "example.com",
        altNames: ["example.com", "www.example.com"],
        validFrom: "2026-01-01", validTo: "2027-01-01", daysRemaining: 200,
        trusted: true, trustError: null,
      },
    })} />);
    expect(screen.getByText("TLSv1.3")).toBeTruthy();
    expect(screen.getByText("Let's Encrypt")).toBeTruthy();
    expect(screen.getByText("2027-01-01 (200d)")).toBeTruthy();
    expect(screen.getByText("trusted")).toBeTruthy();
    expect(screen.getByText(/SAN \(2\)/)).toBeTruthy();
  });

  it("surfaces an untrusted chain and its reason", () => {
    render(<HttpPosturePanel http={probe({
      tls: {
        protocol: null, cipher: null, issuer: null, subject: null, altNames: [],
        validFrom: null, validTo: null, daysRemaining: null,
        trusted: false, trustError: "self signed certificate",
      },
    })} />);
    expect(screen.getByText("UNTRUSTED")).toBeTruthy();
    expect(screen.getByText("self signed certificate")).toBeTruthy();
    // Every unknown field renders an em dash rather than a fabricated value.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("omits the trust reason when the chain failed without one", () => {
    render(<HttpPosturePanel http={probe({
      tls: {
        protocol: "TLSv1.2", cipher: "x", issuer: "CA", subject: "s", altNames: [],
        validFrom: null, validTo: null, daysRemaining: null, trusted: false, trustError: null,
      },
    })} />);
    expect(screen.getByText("UNTRUSTED")).toBeTruthy();
  });

  it.each([
    [-3, "expired"], [7, "under two weeks"], [20, "under a month"], [200, "comfortable"],
  ])("colours a certificate with %i days left (%s)", (daysRemaining) => {
    render(<HttpPosturePanel http={probe({
      tls: {
        protocol: "TLSv1.3", cipher: "c", issuer: "CA", subject: "s", altNames: [],
        validFrom: "2026-01-01", validTo: "2026-06-01", daysRemaining, trusted: true, trustError: null,
      },
    })} />);
    expect(screen.getByText(`2026-06-01 (${daysRemaining}d)`)).toBeTruthy();
  });

  it("truncates a very long SAN list rather than flooding the panel", () => {
    const altNames = Array.from({ length: 20 }, (_, i) => `h${i}.example.com`);
    render(<HttpPosturePanel http={probe({
      tls: {
        protocol: "TLSv1.3", cipher: "c", issuer: "CA", subject: "s", altNames,
        validFrom: null, validTo: null, daysRemaining: null, trusted: true, trustError: null,
      },
    })} />);
    expect(screen.getByText(/SAN \(20\).*\+8 more/)).toBeTruthy();
  });

  it("omits the certificate block entirely when the handshake failed", () => {
    render(<HttpPosturePanel http={probe({ tls: null })} />);
    expect(screen.queryByText("CERTIFICATE")).toBeNull();
  });

  it("renders each technology with its evidence as a tooltip", () => {
    render(<HttpPosturePanel http={probe({
      tech: [
        { name: "nginx", kind: "server", version: "1.24.0", evidence: "server: nginx/1.24.0" },
        { name: "WordPress", kind: "cms", version: null, evidence: "/wp-content/ asset path" },
        { name: "Unknownish", kind: "security", version: null, evidence: "x" },
      ],
    })} />);
    expect(screen.getByText(/nginx 1\.24\.0/).getAttribute("title")).toBe("server: nginx/1.24.0");
    expect(screen.getByText(/WordPress/).getAttribute("title")).toBe("/wp-content/ asset path");
    expect(screen.getByText("TECHNOLOGY")).toBeTruthy();
  });

  it("omits the technology block when nothing was fingerprinted", () => {
    render(<HttpPosturePanel http={probe({ tech: [] })} />);
    expect(screen.queryByText("TECHNOLOGY")).toBeNull();
  });

  it("reports a version-disclosing header as a leak", () => {
    render(<HttpPosturePanel http={probe({
      disclosures: [
        { header: "server", value: "nginx/1.24.0", hasVersion: true },
        { header: "x-powered-by", value: "PHP", hasVersion: false },
      ],
    })} />);
    expect(screen.getByText(/server: nginx\/1\.24\.0: discloses a version/)).toBeTruthy();
    // A versionless header is recorded but is not a finding.
    expect(screen.queryByText(/x-powered-by: PHP/)).toBeNull();
  });

  it("names exactly the cookie flags that are missing", () => {
    render(<HttpPosturePanel http={probe({
      cookies: [
        { name: "bare", secure: false, httpOnly: false, sameSite: null },
        { name: "half", secure: true, httpOnly: false, sameSite: "lax" },
        { name: "good", secure: true, httpOnly: true, sameSite: "strict" },
      ],
    })} />);
    expect(screen.getByText(/missing Secure \+ HttpOnly \+ SameSite/)).toBeTruthy();
    expect(screen.getByText(/missing HttpOnly$/)).toBeTruthy();
    expect(screen.queryByText("good")).toBeNull();
  });

  it("omits the leaks block when there is nothing to report", () => {
    render(<HttpPosturePanel http={probe({
      disclosures: [{ header: "server", value: "nginx", hasVersion: false }],
      cookies: [{ name: "ok", secure: true, httpOnly: true, sameSite: "lax" }],
    })} />);
    expect(screen.queryByText("LEAKS")).toBeNull();
  });
});
