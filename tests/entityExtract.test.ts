import { describe, it, expect } from "vitest";
import {
  entitiesFromPhone, entitiesFromEmail, entitiesFromUsername, entitiesFromIp, entitiesFromDomain,
} from "@/lib/analysis/entityExtract";
import type {
  LookupResponse, EmailLookupResponse, UsernameLookupResponse, IpLookupResponse, DomainLookupResponse,
} from "@/lib/types";

// The extractors seed a case with a result's primary + derived identifiers. The
// contract that matters: element 0 is always the primary, the list is deduped
// (kind + case-insensitive value), and noisy/absent fields never inject blanks.
// Payloads are minimal casts — only the fields each extractor reads are set.

describe("entitiesFromPhone", () => {
  const noFc = { sources: { fullContact: { ok: false } } };

  it("returns just the E.164 number when there's no FullContact enrichment", () => {
    const d = { input: { e164: "+14155552671" }, ...noFc } as unknown as LookupResponse;
    expect(entitiesFromPhone(d)).toEqual([{ kind: "phone", value: "+14155552671" }]);
  });

  it("captures FullContact-associated emails and social handles", () => {
    const d = {
      input: { e164: "+14155552671" },
      sources: { fullContact: { ok: true, data: {
        otherEmails: ["jane@example.com"],
        profiles: [
          { platform: "GitHub", url: "https://github.com/jane", username: "jane" },
          { platform: "Odd", url: "https://x/y", username: "" }, // blank handle → skipped
        ],
      } } },
    } as unknown as LookupResponse;
    expect(entitiesFromPhone(d)).toEqual([
      { kind: "phone", value: "+14155552671" },
      { kind: "email", value: "jane@example.com" },
      { kind: "username", value: "jane" },
    ]);
  });

  it("tolerates a FullContact payload missing the emails/profiles arrays", () => {
    const d = {
      input: { e164: "+1" },
      sources: { fullContact: { ok: true, data: {} } },
    } as unknown as LookupResponse;
    expect(entitiesFromPhone(d)).toEqual([{ kind: "phone", value: "+1" }]);
  });
});

describe("entitiesFromEmail", () => {
  it("returns the email plus its domain", () => {
    const d = { email: "jdoe@Example.com", analysis: { domain: "example.com" } } as EmailLookupResponse;
    expect(entitiesFromEmail(d)).toEqual([
      { kind: "email", value: "jdoe@Example.com" },
      { kind: "domain", value: "example.com" },
    ]);
  });
});

describe("entitiesFromUsername", () => {
  it("returns the handle plus each confirmed profile handle, deduped case-insensitively", () => {
    const d = {
      username: "torvalds",
      profiles: [
        { handle: "torvalds" },     // same as query → deduped
        { handle: "Torvalds" },     // case variant of the query → deduped
        { handle: "  " },           // blank → dropped entirely
        { handle: "linus-alt" },    // genuinely different → kept
      ],
    } as unknown as UsernameLookupResponse;
    expect(entitiesFromUsername(d)).toEqual([
      { kind: "username", value: "torvalds" },
      { kind: "username", value: "linus-alt" },
    ]);
  });

  it("handles a username with no rich profiles", () => {
    const d = { username: "ghost", profiles: [] } as unknown as UsernameLookupResponse;
    expect(entitiesFromUsername(d)).toEqual([{ kind: "username", value: "ghost" }]);
  });
});

describe("entitiesFromIp", () => {
  it("returns the IP plus a valid reverse-DNS hostname as a domain", () => {
    const d = { input: "8.8.8.8", ip: { reverse: "dns.google" } } as IpLookupResponse;
    expect(entitiesFromIp(d)).toEqual([
      { kind: "ip", value: "8.8.8.8" },
      { kind: "domain", value: "dns.google" },
    ]);
  });

  it("omits the reverse host when it's absent or a PTR arpa zone, and when ip is null", () => {
    expect(entitiesFromIp({ input: "1.2.3.4", ip: { reverse: null } } as IpLookupResponse))
      .toEqual([{ kind: "ip", value: "1.2.3.4" }]);
    expect(entitiesFromIp({ input: "1.2.3.4", ip: { reverse: "4.3.2.1.in-addr.arpa" } } as IpLookupResponse))
      .toEqual([{ kind: "ip", value: "1.2.3.4" }]);
    expect(entitiesFromIp({ input: "10.0.0.1", ip: null } as IpLookupResponse))
      .toEqual([{ kind: "ip", value: "10.0.0.1" }]);
  });
});

describe("entitiesFromDomain", () => {
  it("returns the domain plus its resolved A/AAAA IPs", () => {
    const d = { domain: "dns.google", dns: {
      a: [{ value: "8.8.8.8" }, { value: "8.8.4.4" }],
      aaaa: [{ value: "2001:4860:4860::8888" }],
    } } as unknown as DomainLookupResponse;
    expect(entitiesFromDomain(d)).toEqual([
      { kind: "domain", value: "dns.google" },
      { kind: "ip", value: "8.8.8.8" },
      { kind: "ip", value: "8.8.4.4" },
      { kind: "ip", value: "2001:4860:4860::8888" },
    ]);
  });

  it("caps the number of resolved IPs and drops malformed records", () => {
    const d = { domain: "many.example", dns: {
      a: [{ value: "1.1.1.1" }, { value: "bad" }, { value: "2.2.2.2" }, { value: "3.3.3.3" }],
      aaaa: [],
    } } as unknown as DomainLookupResponse;
    expect(entitiesFromDomain(d, 2)).toEqual([
      { kind: "domain", value: "many.example" },
      { kind: "ip", value: "1.1.1.1" },
      { kind: "ip", value: "2.2.2.2" },
    ]);
  });
});
