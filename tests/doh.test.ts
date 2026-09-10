import { describe, it, expect } from "vitest";
import { DOH_URL, dohFailure } from "@/lib/server/doh";

// Cloudflare's DoH JSON answers HTTP 200 even when the lookup failed; the RCODE
// in `Status` is the real outcome. Only NOERROR and NXDOMAIN are answers.

describe("dohFailure", () => {
  it("treats NOERROR, NXDOMAIN and a body with no Status as answers", () => {
    expect(dohFailure(0)).toBeNull();
    expect(dohFailure(3)).toBeNull();
    expect(dohFailure(undefined)).toBeNull();
  });

  it("names the failed RCODEs, and numbers one it does not know", () => {
    expect(dohFailure(2)).toBe("DNS SERVFAIL");
    expect(dohFailure(5)).toBe("DNS REFUSED");
    expect(dohFailure(9)).toBe("DNS rcode 9");
  });

  it("targets Cloudflare's JSON endpoint", () => {
    expect(DOH_URL).toBe("https://cloudflare-dns.com/dns-query");
  });
});
