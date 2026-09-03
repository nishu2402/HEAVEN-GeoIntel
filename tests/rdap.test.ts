import { describe, it, expect, afterEach, vi } from "vitest";
import {
  fetchWhois, parseRdapDomain, indexBootstrap, resetBootstrapCache, type RdapDomain,
} from "@/lib/server/rdap";

// RDAP is the tool's only registration-data source, and it was silently dead:
// rdap.org sits behind Cloudflare and answers a request carrying no User-Agent
// with HTTP 403. Node's fetch sends none, so `whois` was null for EVERY domain
// while the UI reported "WHOIS unavailable for this TLD via RDAP" — a false
// statement about .com, which has had RDAP since 2013.
//
// These tests pin both halves of the fix: the User-Agent actually goes out, and
// a broker failure falls through to the authoritative registry rather than
// taking the whole source down with it.

afterEach(() => {
  vi.unstubAllGlobals();
  resetBootstrapCache();
});

const json = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

/** A .com-shaped registry response, trimmed to the fields we read. */
const VERISIGN_STYLE: RdapDomain = {
  events: [
    { eventAction: "registration", eventDate: "2007-10-09T18:20:50Z" },
    { eventAction: "expiration", eventDate: "2026-10-09T18:20:50Z" },
    { eventAction: "last changed", eventDate: "2024-09-07T09:16:32Z" },
  ],
  entities: [
    { roles: ["registrar"], vcardArray: ["vcard", [["fn", {}, "text", "MarkMonitor Inc."]]] },
  ],
  nameservers: [{ ldhName: "DNS1.P08.NSONE.NET" }, { ldhName: "NS-520.AWSDNS-01.NET" }],
  status: ["client delete prohibited", "client transfer prohibited"],
};

const BOOTSTRAP = {
  services: [
    [["com", "net"], ["https://rdap.verisign.com/com/v1/"]],
    [["org"], ["https://rdap.publicinterestregistry.org/rdap/"]],
  ] as [string[], string[]][],
};

describe("parseRdapDomain", () => {
  it("pulls registrar, dates, nameservers and statuses out of a registry response", () => {
    const w = parseRdapDomain(VERISIGN_STYLE);
    expect(w.registrar).toBe("MarkMonitor Inc.");
    expect(w.createdDate).toBe("2007-10-09T18:20:50Z");
    expect(w.expiresDate).toBe("2026-10-09T18:20:50Z");
    expect(w.updatedDate).toBe("2024-09-07T09:16:32Z");
    // Registries publish nameservers upper-cased; DNS is case-insensitive and
    // the rest of the UI shows them lower-cased.
    expect(w.nameservers).toEqual(["dns1.p08.nsone.net", "ns-520.awsdns-01.net"]);
    expect(w.statuses).toEqual(["client delete prohibited", "client transfer prohibited"]);
  });

  it("reads the registrant country from a jCard `cc` parameter", () => {
    // registrantCountry used to be a `const … = null`, so the row could never
    // populate even when the registry published it.
    const w = parseRdapDomain({
      entities: [{
        roles: ["registrant"],
        vcardArray: ["vcard", [
          ["fn", {}, "text", "Example Holdings Ltd"],
          ["adr", { cc: "gb" }, "text", ["", "", "1 Example St", "London", "", "EC1", "United Kingdom"]],
        ]],
      }],
    });
    expect(w.registrantOrg).toBe("Example Holdings Ltd");
    expect(w.registrantCountry).toBe("GB");
  });

  it("falls back to the positional country when there is no `cc` parameter", () => {
    const w = parseRdapDomain({
      entities: [{
        roles: ["registrant"],
        vcardArray: ["vcard", [
          ["adr", {}, "text", ["", "", "1 Example St", "Berlin", "", "10115", "Germany"]],
        ]],
      }],
    });
    expect(w.registrantCountry).toBe("Germany");
  });

  it("survives a fully redacted record without inventing anything", () => {
    // Most ccTLDs redact every contact under GDPR and return events only.
    const w = parseRdapDomain({ events: [{ eventAction: "registration", eventDate: "2020-01-01Z" }] });
    expect(w.registrar).toBeNull();
    expect(w.registrantOrg).toBeNull();
    expect(w.registrantCountry).toBeNull();
    expect(w.nameservers).toEqual([]);
    expect(w.statuses).toEqual([]);
    expect(w.expiresDate).toBeNull();
  });

  it("tolerates malformed jCards and missing fields", () => {
    const w = parseRdapDomain({
      entities: [
        { roles: ["registrar"], vcardArray: "not-an-array", handle: "292" },
        { roles: ["registrant"], vcardArray: ["vcard", "also-not-an-array"] },
        { /* no roles at all */ },
      ],
      nameservers: [{ ldhName: "" }, {}],
    });
    // No `fn` to read, so the registrar falls back to its handle.
    expect(w.registrar).toBe("292");
    expect(w.registrantCountry).toBeNull();
    expect(w.nameservers).toEqual([]); // blank/absent names dropped, not kept as ""
  });

  it("returns no country when the address value is not a jCard address array", () => {
    const w = parseRdapDomain({
      entities: [{ roles: ["registrant"], vcardArray: ["vcard", [["adr", {}, "text", "123 Somewhere"]]] }],
    });
    expect(w.registrantCountry).toBeNull();
  });

  it("ignores a blank `cc` parameter and an empty positional country", () => {
    const blankCc = parseRdapDomain({
      entities: [{ roles: ["registrant"], vcardArray: ["vcard", [["adr", { cc: "  " }, "text", ["", "", "", "", "", "", ""]]]] }],
    });
    expect(blankCc.registrantCountry).toBeNull();
  });

  it("ignores an `adr` whose parameters are not an object", () => {
    const w = parseRdapDomain({
      entities: [{ roles: ["registrant"], vcardArray: ["vcard", [["adr", ["array"], "text", ["", "", "", "", "", "", "NL"]]]] }],
    });
    expect(w.registrantCountry).toBe("NL"); // falls through to the positional form
  });

  it("keeps the first registrant country when a record lists several", () => {
    const w = parseRdapDomain({
      entities: [
        { roles: ["registrant"], vcardArray: ["vcard", [["adr", { cc: "US" }, "text", []]]] },
        { roles: ["registrant"], vcardArray: ["vcard", [["adr", { cc: "JP" }, "text", []]]] },
      ],
    });
    expect(w.registrantCountry).toBe("US");
  });

  it("accepts the alternative spelling of the updated-date event", () => {
    const w = parseRdapDomain({
      events: [{ eventAction: "last update of RDAP database", eventDate: "2026-05-05Z" }],
    });
    expect(w.updatedDate).toBe("2026-05-05Z");
  });
});

describe("indexBootstrap", () => {
  it("maps every TLD in a service group to that group's https base URL", () => {
    const idx = indexBootstrap(BOOTSTRAP);
    expect(idx.get("com")).toBe("https://rdap.verisign.com/com/v1/");
    expect(idx.get("net")).toBe("https://rdap.verisign.com/com/v1/");
    expect(idx.get("org")).toBe("https://rdap.publicinterestregistry.org/rdap/");
  });

  it("prefers https but accepts a registry that only publishes http", () => {
    const idx = indexBootstrap({ services: [[["test"], ["http://rdap.example/", "https://rdap.example/"]]] });
    expect(idx.get("test")).toBe("https://rdap.example/");
    const httpOnly = indexBootstrap({ services: [[["test"], ["http://rdap.example/"]]] });
    expect(httpOnly.get("test")).toBe("http://rdap.example/");
  });

  it("skips a service entry with no URLs rather than throwing", () => {
    expect(indexBootstrap({ services: [[["dead"], []], [["ok"], ["https://x/"]]] }).size).toBe(1);
    expect(indexBootstrap({}).size).toBe(0);
  });

  it("ignores a group with no TLDs", () => {
    expect(indexBootstrap({ services: [[[], ["https://x/"]]] }).size).toBe(0);
    // …and one where the TLD list is absent entirely.
    expect(indexBootstrap({ services: [[undefined as unknown as string[], ["https://x/"]]] }).size).toBe(0);
  });
});

describe("fetchWhois", () => {
  it("identifies itself: the omission that killed this source", async () => {
    const seen: Record<string, string | null> = {};
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      seen.ua = new Headers(init.headers).get("user-agent");
      return json(VERISIGN_STYLE);
    }));
    await fetchWhois("github.com");
    expect(seen.ua).toMatch(/^HEAVEN-GeoIntel\//);
  });

  it("returns the broker's answer without touching the bootstrap", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string) => {
      calls.push(String(u));
      return json(VERISIGN_STYLE);
    }));
    const w = await fetchWhois("github.com");
    expect(w?.registrar).toBe("MarkMonitor Inc.");
    expect(calls).toHaveLength(1); // one call: no fallback needed
    expect(calls[0]).toContain("rdap.org");
  });

  it("falls back to the authoritative registry when the broker refuses", async () => {
    // Exactly the observed production failure: rdap.org answers 403.
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string) => {
      const url = String(u);
      calls.push(url);
      if (url.includes("rdap.org")) return json({}, 403);
      if (url.includes("data.iana.org")) return json(BOOTSTRAP);
      return json(VERISIGN_STYLE);
    }));
    const w = await fetchWhois("github.com");
    expect(w?.registrar).toBe("MarkMonitor Inc."); // source survives the broker
    expect(calls[1]).toContain("data.iana.org");
    expect(calls[2]).toBe("https://rdap.verisign.com/com/v1/domain/github.com");
  });

  it("caches the bootstrap across lookups", async () => {
    const fetchMock = vi.fn(async (u: string) => {
      const url = String(u);
      if (url.includes("rdap.org")) return json({}, 403);
      if (url.includes("data.iana.org")) return json(BOOTSTRAP);
      return json(VERISIGN_STYLE);
    });
    vi.stubGlobal("fetch", fetchMock);
    await fetchWhois("a.com");
    await fetchWhois("b.com");
    const bootstrapCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("data.iana.org"));
    expect(bootstrapCalls).toHaveLength(1); // ~70 KB, fetched once per process
  });

  it("reports null: honestly: when no registry serves the TLD", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: string) => {
      const url = String(u);
      if (url.includes("rdap.org")) return json({}, 404);
      if (url.includes("data.iana.org")) return json(BOOTSTRAP);
      return json(VERISIGN_STYLE);
    }));
    // .invalidtld is absent from the bootstrap, so there is genuinely nobody to ask.
    expect(await fetchWhois("nothing.invalidtld")).toBeNull();
  });

  it("returns null when the registry itself refuses", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: string) => {
      const url = String(u);
      if (url.includes("rdap.org")) return json({}, 403);
      if (url.includes("data.iana.org")) return json(BOOTSTRAP);
      return json({}, 500);
    }));
    expect(await fetchWhois("github.com")).toBeNull();
  });

  it("returns null when the bootstrap file is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: string) => {
      if (String(u).includes("rdap.org")) return json({}, 403);
      throw new Error("network down");
    }));
    expect(await fetchWhois("github.com")).toBeNull();
  });

  it("handles a domain with no dot without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: string) => {
      const url = String(u);
      if (url.includes("rdap.org")) return json({}, 403);
      if (url.includes("data.iana.org")) return json(BOOTSTRAP);
      return json(VERISIGN_STYLE);
    }));
    expect(await fetchWhois("localhost")).toBeNull();
  });
});
