import { describe, it, expect } from "vitest";
import {
  pivotsFromPhone, pivotsFromEmail, pivotsFromUsername, pivotsFromIp, pivotsFromDomain,
  edgesFromPivots, type PivotSuggestion,
} from "@/lib/analysis/autoPivot";
import type {
  LookupResponse, EmailLookupResponse, UsernameLookupResponse,
  IpLookupResponse, DomainLookupResponse,
} from "@/lib/types";

const off = { ok: false as const, error: "NOT_CONFIGURED" };
const values = (p: PivotSuggestion[]) => p.map((x) => `${x.kind}:${x.value}`);

// ── fixtures ─────────────────────────────────────────────────────────────────

const phone = (over: Partial<LookupResponse["sources"]> = {}): LookupResponse => ({
  input: { e164: "+14155552671" },
  sources: {
    numverify: off, ipqs: off, abstract: off, twilio: off,
    breachDirectory: off, fullContact: off, hudsonRock: off, leakCheck: off,
    ...over,
  },
} as unknown as LookupResponse);

const email = (over: Partial<EmailLookupResponse> = {}): EmailLookupResponse => ({
  email: "ada@example.com",
  analysis: { username: "ada", domain: "example.com" },
  gravatar: { found: false, preferredUsername: null, accounts: [] },
  emailrep: off, hunter: off, abstract: off, xon: off,
  breachDirectory: off, fullContact: off, hudsonRock: off, leakCheck: off,
  ...over,
} as unknown as EmailLookupResponse);

const domain = (over: Partial<DomainLookupResponse> = {}): DomainLookupResponse => ({
  domain: "example.com",
  dns: { a: [], aaaa: [], mx: [], txt: [], ns: [], cname: [] },
  subdomains: [],
  ...over,
} as unknown as DomainLookupResponse);

// ── shape validation (the no-false-positive contract) ────────────────────────

describe("auto-pivot refuses values that aren't usable identifiers", () => {
  it("drops Hudson Rock's masked IPs and logins", () => {
    // This is the exact shape the live free tier returns. A masked value is
    // evidence that something was captured — it is not an identifier, and
    // offering it would send the analyst to a dead lookup.
    const p = pivotsFromPhone(phone({
      hudsonRock: { ok: true, data: { total: 1, stealers: [{
        computerName: null, operatingSystem: null, malwareFamily: null, dateCompromised: null,
        ip: "82.167.***.**",
        topPasswords: [], topLogins: ["i****@gmail.com", "real.person@corp.com"],
      }] } },
    }));
    expect(values(p)).toEqual(["email:real.person@corp.com"]);
  });

  it("drops malformed emails, domains, handles, IPs and phone numbers", () => {
    const p = pivotsFromPhone(phone({
      fullContact: { ok: true, data: {
        otherEmails: ["no-at-sign", "a@b", "  ", "ok@fine.com"],
        profiles: [
          { platform: "GitHub", username: "has space", url: "" },
          { platform: "GitHub", username: "good-handle", url: "" },
        ],
      } },
      leakCheck: { ok: true, data: { found: 1, fields: [], sources: [
        { name: "Stealer Logs", date: null },   // a label, not a domain
        { name: "Trello.com", date: "2024-01" },
      ] } },
    } as unknown as Partial<LookupResponse["sources"]>));
    expect(values(p)).toEqual([
      "email:ok@fine.com",
      "username:good-handle",
      "domain:trello.com",
    ]);
  });

  it("never suggests the subject of the lookup itself", () => {
    const p = pivotsFromEmail(email({
      fullContact: { ok: true, data: { otherEmails: ["ADA@example.com"], phones: [], profiles: [] } },
    } as unknown as Partial<EmailLookupResponse>));
    expect(values(p)).not.toContain("email:ada@example.com");
  });

  it("de-dupes case-insensitively across sources", () => {
    const p = pivotsFromDomain(domain({
      dns: { a: [{ type: "A", value: "1.1.1.1" }], aaaa: [{ type: "AAAA", value: "1.1.1.1" }],
             mx: [], txt: [], ns: [], cname: [] },
      subdomains: ["WWW.example.com", "www.example.com"],
    } as unknown as Partial<DomainLookupResponse>));
    expect(values(p).filter((v) => v === "ip:1.1.1.1")).toHaveLength(1);
    expect(values(p).filter((v) => v === "domain:www.example.com")).toHaveLength(1);
  });
});

// ── ordering ─────────────────────────────────────────────────────────────────

describe("auto-pivot ranks confirmed links above related ones", () => {
  it("puts every confirmed suggestion first", () => {
    const p = pivotsFromEmail(email({
      fullContact: { ok: true, data: { otherEmails: ["work@corp.com"], phones: [], profiles: [] } },
    } as unknown as Partial<EmailLookupResponse>));
    const firstRelated = p.findIndex((x) => x.strength === "related");
    const lastConfirmed = p.map((x) => x.strength).lastIndexOf("confirmed");
    expect(lastConfirmed).toBeLessThan(firstRelated);
  });
});

// ── per-mode extraction ──────────────────────────────────────────────────────

describe("pivotsFromPhone", () => {
  it("pulls FullContact contacts, IPQS associated emails and LeakCheck sites", () => {
    const p = pivotsFromPhone(phone({
      fullContact: { ok: true, data: {
        otherEmails: ["ada@work.com"], phones: [],
        profiles: [{ platform: "GitHub", username: "ada", url: "" }],
      } },
      ipqs: { ok: true, data: { associated_email_addresses: { status: "ok", emails: ["seen@x.com"] } } },
      leakCheck: { ok: true, data: { found: 2, fields: [], sources: [{ name: "LinkedIn.com", date: "2021-06" }] } },
    } as unknown as Partial<LookupResponse["sources"]>));
    expect(values(p)).toEqual([
      "email:ada@work.com", "username:ada", "email:seen@x.com", "domain:linkedin.com",
    ]);
    expect(p[0].reason).toMatch(/FullContact/);
  });

  it("returns nothing when every source is unconfigured", () => {
    expect(pivotsFromPhone(phone())).toEqual([]);
  });

  it("tolerates FullContact data with the optional arrays absent", () => {
    const p = pivotsFromPhone(phone({ fullContact: { ok: true, data: {} } } as unknown as Partial<LookupResponse["sources"]>));
    expect(p).toEqual([]);
  });
});

describe("pivotsFromEmail", () => {
  it("offers the local part and domain as related pivots", () => {
    expect(values(pivotsFromEmail(email()))).toEqual(["username:ada", "domain:example.com"]);
  });

  it("pulls Gravatar handles and linked account hosts", () => {
    const p = pivotsFromEmail(email({
      gravatar: {
        found: true, preferredUsername: "adalovelace",
        accounts: [{ shortname: "github", username: "ada-l", url: "https://github.com/ada-l" }],
      },
    } as unknown as Partial<EmailLookupResponse>));
    expect(values(p)).toContain("username:adalovelace");
    expect(values(p)).toContain("username:ada-l");
    expect(values(p)).toContain("domain:github.com");
  });

  it("labels a linked account with no shortname generically", () => {
    const p = pivotsFromEmail(email({
      gravatar: { found: true, preferredUsername: null, accounts: [{ shortname: "", username: "solo", url: "" }] },
    } as unknown as Partial<EmailLookupResponse>));
    expect(p.find((x) => x.value === "solo")!.reason).toMatch(/linked account/);
  });

  it("pulls FullContact phones, XposedOrNot breach domains and the primary MX", () => {
    const p = pivotsFromEmail(email({
      fullContact: { ok: true, data: { otherEmails: [], phones: ["+442079460958"], profiles: [] } },
      xon: { ok: true, data: { breachCount: 1, breaches: [{ breach: "LinkedIn", domain: "linkedin.com" }], xposedDataTypes: [], yearwiseDetails: {} } },
      emailrep: { ok: true, data: { primaryMx: "aspmx.l.google.com" } },
    } as unknown as Partial<EmailLookupResponse>));
    expect(values(p)).toContain("phone:+442079460958");
    expect(values(p)).toContain("domain:linkedin.com");
    expect(values(p)).toContain("domain:aspmx.l.google.com");
  });

  it("pulls Hudson Rock and LeakCheck evidence", () => {
    const p = pivotsFromEmail(email({
      hudsonRock: { ok: true, data: { total: 1, stealers: [{
        computerName: null, operatingSystem: null, malwareFamily: null, dateCompromised: null,
        ip: "9.9.9.9", topPasswords: [], topLogins: [],
      }] } },
      leakCheck: { ok: true, data: { found: 1, fields: [], sources: [{ name: "Last.fm", date: "2012-07" }] } },
    } as unknown as Partial<EmailLookupResponse>));
    expect(values(p)).toContain("ip:9.9.9.9");
    expect(values(p)).toContain("domain:last.fm");
  });
});

describe("pivotsFromUsername", () => {
  const user = (over: Partial<UsernameLookupResponse> = {}): UsernameLookupResponse =>
    ({ username: "torvalds", profiles: [], leakCheck: off, ...over }) as unknown as UsernameLookupResponse;

  it("offers a confirmed handle that differs from the query", () => {
    const p = pivotsFromUsername(user({
      profiles: [
        { platform: "GitHub", handle: "torvalds" },      // same as query → skipped
        { platform: "GitLab", handle: "linus-t" },
      ],
    } as unknown as Partial<UsernameLookupResponse>));
    expect(values(p)).toEqual(["username:linus-t"]);
  });

  it("adds LeakCheck breached sites", () => {
    const p = pivotsFromUsername(user({
      leakCheck: { ok: true, data: { found: 5, fields: [], sources: [{ name: "Cracked.to", date: "2019-07" }] } },
    } as unknown as Partial<UsernameLookupResponse>));
    expect(values(p)).toEqual(["domain:cracked.to"]);
  });
});

describe("pivotsFromIp", () => {
  const ip = (over: Record<string, unknown> = {}): IpLookupResponse =>
    ({ input: "8.8.8.8", ip: { reverse: null, hostnames: null, ...over } }) as unknown as IpLookupResponse;

  it("offers the PTR host and Shodan hostnames", () => {
    const p = pivotsFromIp(ip({ reverse: "dns.google.", hostnames: ["dns.google", "one.example.com"] }));
    expect(values(p)).toEqual(["domain:dns.google", "domain:one.example.com"]);
  });

  it("skips an arpa PTR zone and a missing ip block", () => {
    expect(pivotsFromIp(ip({ reverse: "8.8.8.8.in-addr.arpa" }))).toEqual([]);
    expect(pivotsFromIp({ input: "8.8.8.8", ip: null } as unknown as IpLookupResponse)).toEqual([]);
  });
});

describe("pivotsFromDomain", () => {
  it("offers A/AAAA IPs, MX, NS, CNAME and capped subdomains", () => {
    const p = pivotsFromDomain(domain({
      dns: {
        a: [{ type: "A", value: "93.184.216.34" }],
        aaaa: [{ type: "AAAA", value: "2606:2800:220:1:248:1893:25c8:1946" }],
        mx: [{ type: "MX", value: "aspmx.l.google.com" }],
        ns: [{ type: "NS", value: "ns1.example.net." }],
        cname: [{ type: "CNAME", value: "cdn.fastly.net" }],
        txt: [],
      },
      subdomains: Array.from({ length: 12 }, (_, i) => `s${i}.example.com`),
    } as unknown as Partial<DomainLookupResponse>), 3);

    expect(values(p)).toContain("ip:93.184.216.34");
    expect(values(p)).toContain("ip:2606:2800:220:1:248:1893:25c8:1946");
    expect(values(p)).toContain("domain:aspmx.l.google.com");
    expect(values(p)).toContain("domain:ns1.example.net");    // trailing dot stripped
    expect(values(p)).toContain("domain:cdn.fastly.net");
    expect(values(p).filter((v) => /^domain:s\d/.test(v))).toHaveLength(3); // capped
  });

  it("ignores a record value that is not a parseable host", () => {
    const p = pivotsFromDomain(domain({
      dns: { a: [], aaaa: [], mx: [{ type: "MX", value: "" }], ns: [{ type: "NS", value: "http://" }], cname: [], txt: [] },
    } as unknown as Partial<DomainLookupResponse>));
    expect(p).toEqual([]);
  });
});

// ── edges ────────────────────────────────────────────────────────────────────

describe("edgesFromPivots", () => {
  it("roots every edge at the subject and carries the reason through", () => {
    const pivots = pivotsFromEmail(email());
    const edges = edgesFromPivots({ kind: "email", value: "ada@example.com" }, pivots);
    expect(edges).toHaveLength(pivots.length);
    expect(edges[0]).toEqual({
      from: { kind: "email", value: "ada@example.com" },
      to: { kind: "username", value: "ada" },
      reason: "Email local part",
    });
  });

  it("returns nothing when there is nothing to link", () => {
    expect(edgesFromPivots({ kind: "phone", value: "+1" }, [])).toEqual([]);
  });
});
