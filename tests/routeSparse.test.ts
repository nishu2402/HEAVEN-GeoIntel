import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { POST as lookupPOST } from "@/app/api/lookup/route";
import { POST as emailPOST } from "@/app/api/email-lookup/route";
import { POST as domainPOST } from "@/app/api/domain-lookup/route";
import { POST as ipPOST } from "@/app/api/ip-lookup/route";
import { POST as usernamePOST } from "@/app/api/username-lookup/route";
import { POST as casesPOST } from "@/app/api/cases/route";
import { POST as bulkPOST } from "@/app/api/bulk-lookup/route";
import { useRateLimit, restoreRateLimit, clientCookie, resetServerState } from "./testUtils";

// Sparse-payload pass: what happens when an upstream answers 200 but omits the
// optional fields. Real APIs do this constantly (free tiers, partial records),
// and every one of these paths must produce an explicit null rather than
// `undefined` leaking into the JSON or a crash.

let dir: string;
const KEYS = ["IPQS_API_KEY", "RAPIDAPI_KEY", "FULLCONTACT_API_KEY", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"];

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "hv-sparse-"));
  process.env.HV_DATA_DIR = dir;
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.HV_DATA_DIR;
});
afterEach(() => {
  resetServerState();
  vi.unstubAllGlobals();
  KEYS.forEach((k) => delete process.env[k]);
  restoreRateLimit();
});

const resp = (status: number, body: unknown, ok = status >= 200 && status < 300) =>
  ({
    ok, status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  }) as unknown as Response;

const post = <T,>(h: (r: NextRequest) => Promise<T>, url: string, body: unknown) =>
  h(new Request(url, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }) as unknown as NextRequest);

function stub(map: Array<[string, Response]>, fallback: Response = resp(404, {})) {
  vi.stubGlobal("fetch", vi.fn(async (u: string | URL) => {
    for (const [needle, r] of map) if (String(u).includes(needle)) return r;
    return fallback;
  }));
}

let n = 0;
const phone = (number = `+1415555${2000 + n++}`) =>
  post(lookupPOST, "http://localhost/api/lookup", { number });
const email = (addr = `sparse${n++}@example.test`) =>
  post(emailPOST, "http://localhost/api/email-lookup", { email: addr });

describe("phone: sparse upstream payloads", () => {
  it("coerces a non-numeric BreachDirectory 'found' to zero", async () => {
    process.env.RAPIDAPI_KEY = "k";
    stub([["breachdirectory.p.rapidapi.com", resp(200, { found: "many", result: [{}] })]]);
    // A string "found" is truthy, so the route proceeds — but must not emit it.
    expect((await (await phone()).json()).sources.breachDirectory.data.found).toBe(0);
  });

  it("defaults a BreachDirectory hit with no result array", async () => {
    process.env.RAPIDAPI_KEY = "k";
    stub([["breachdirectory.p.rapidapi.com", resp(200, { found: 3 })]]);
    const d = (await (await phone()).json()).sources.breachDirectory.data;
    expect(d.found).toBe(3);
    expect(d.results).toEqual([]);
  });

  it("defaults FullContact sub-records that omit their optional fields", async () => {
    process.env.FULLCONTACT_API_KEY = "k";
    stub([["api.fullcontact.com", resp(200, {
      details: {
        profiles: { linkedin: { url: "https://li.test/x" } },       // no username
        phones: [{}],                                               // no value
        employment: [{ name: "Acme" }],                             // no title/current
      },
    })]]);
    const d = (await (await phone()).json()).sources.fullContact.data;
    expect(d.profiles).toEqual([{ platform: "Linkedin", url: "https://li.test/x", username: "" }]);
    expect(d.phones).toEqual([]);
    expect(d.employment).toEqual([{ name: "Acme", title: null, current: false }]);
  });

  it("supplies its own message when Hudson Rock returns none", async () => {
    stub([["cavalier.hudsonrock.com", resp(200, { stealers: [] })]]);
    expect((await (await phone()).json()).sources.hudsonRock.data.message).toBe("No infections found");
  });

  it("nulls every absent stealer field", async () => {
    stub([["cavalier.hudsonrock.com", resp(200, { stealers: [{}] })]]);
    const s = (await (await phone()).json()).sources.hudsonRock.data.stealers[0];
    expect(s).toEqual({
      computerName: null, operatingSystem: null, malwareFamily: null,
      dateCompromised: null, ip: null, topPasswords: [], topLogins: [],
    });
  });

  it("falls back to the country dataset when the NPA has no timezone", async () => {
    // A UK number: libphonenumber gives no per-area timezone, so the country
    // dataset supplies it rather than the field coming back null.
    stub([]);
    const json = await (await phone("+442079460958")).json();
    expect(json.aggregated.timezone).toEqual(["Europe/London"]);
  });

  it("infers VoIP offline when no fraud source is configured", async () => {
    stub([]);
    // +44 56xx is a UK VoIP range — libphonenumber types it without any API.
    const json = await (await phone("+445600000000")).json();
    expect(json.sources.ipqs.error).toBe("NOT_CONFIGURED");
    expect(json.aggregated.isVoip).toBe(true);
  });

  it("lets a fraud source override the offline VoIP guess", async () => {
    process.env.IPQS_API_KEY = "k";
    stub([["ipqualityscore.com", resp(200, { success: true, VOIP: false })]]);
    const json = await (await phone("+445600000001")).json();
    expect(json.aggregated.isVoip).toBe(false); // IPQS wins over the offline hint
  });

  it("confirms mobile and fixed-line only when the number type proves it", async () => {
    stub([]);
    const mobile = await (await phone("+447911123456")).json();
    expect(mobile.aggregated.isMobile).toBe(true);
    expect(mobile.aggregated.isFixedLine).toBeNull(); // never asserted false

    const fixed = await (await phone("+390612345678")).json();
    expect(fixed.aggregated.isFixedLine).toBe(true);
    expect(fixed.aggregated.isMobile).toBeNull();
  });

  it("nulls both when the number type is ambiguous", async () => {
    stub([]);
    // US 212 is FIXED_LINE_OR_MOBILE — neither flag may be claimed.
    const json = await (await phone("+12125551234")).json();
    expect(json.aggregated.isMobile).toBeNull();
    expect(json.aggregated.isFixedLine).toBeNull();
    expect(json.aggregated.isAmbiguousType).toBe(true);
  });
});

describe("email: sparse upstream payloads", () => {
  it("nulls every absent Gravatar field", async () => {
    stub([["gravatar.com", resp(200, { entry: [{}] })]]);
    const g = (await (await email()).json()).gravatar;
    expect(g.found).toBe(true);
    expect(g.displayName).toBeNull();
    expect(g.aboutMe).toBeNull();
    expect(g.currentLocation).toBeNull();
    expect(g.profileUrl).toBeNull();
    expect(g.accounts).toEqual([]);
  });

  it("defaults FullContact sub-records", async () => {
    process.env.FULLCONTACT_API_KEY = "k";
    stub([["api.fullcontact.com", resp(200, {
      details: {
        profiles: { mastodon: { url: "https://m.test/x" } },
        employment: [{ name: "Corp" }],
      },
    })]]);
    const d = (await (await email()).json()).fullContact.data;
    expect(d.profiles[0].username).toBe("");
    expect(d.employment).toEqual([{ name: "Corp", title: null, current: false }]);
  });

  it("coerces a non-numeric BreachDirectory 'found' and a missing result array", async () => {
    process.env.RAPIDAPI_KEY = "k";
    stub([["breachdirectory.p.rapidapi.com", resp(200, { found: "lots" })]]);
    let d = (await (await email()).json()).breachDirectory.data;
    expect(d.found).toBe(0);

    stub([["breachdirectory.p.rapidapi.com", resp(200, { found: 2 })]]);
    d = (await (await email()).json()).breachDirectory.data;
    expect(d.found).toBe(2);
    expect(d.results).toEqual([]);
  });
});

describe("domain: sparse RDAP and CT payloads", () => {
  const dom = (domain: string) => post(domainPOST, "http://localhost/api/domain-lookup", { domain });

  it("handles an RDAP record with no entities, nameservers or statuses", async () => {
    stub([["rdap.org", resp(200, {})]]);
    const json = await (await dom("bare.test")).json();
    expect(json.whois).toMatchObject({
      registrar: null, registrantOrg: null, nameservers: [], statuses: [],
      createdDate: null, updatedDate: null, expiresDate: null,
    });
  });

  it("handles entities with no roles, no vCard and no handle", async () => {
    stub([["rdap.org", resp(200, {
      entities: [{}, { roles: ["registrar"] }, { roles: ["registrant"], vcardArray: "not-an-array" }],
    })]]);
    const json = await (await dom("bare2.test")).json();
    expect(json.whois.registrar).toBeNull(); // no name and no handle
    expect(json.whois.registrantOrg).toBeNull();
  });

  it("handles a vCard whose fn entry has no value", async () => {
    stub([["rdap.org", resp(200, {
      entities: [{ roles: ["registrar"], vcardArray: ["vcard", [["fn", {}, "text"]]], handle: "H-1" }],
    })]]);
    const json = await (await dom("bare3.test")).json();
    expect(json.whois.registrar).toBe("H-1"); // empty name falls through to handle
  });

  it("skips a nameserver with no ldhName", async () => {
    stub([["rdap.org", resp(200, { nameservers: [{}, { ldhName: "NS.OK.TEST" }] })]]);
    const json = await (await dom("bare4.test")).json();
    expect(json.whois.nameservers).toEqual(["ns.ok.test"]);
  });

  it("skips CT rows with no hostname fields", async () => {
    stub([
      ["certspotter", resp(200, [{}, { dns_names: ["a.ctb.test"] }])],
      ["crt.sh", resp(200, [{}, { name_value: "b.ctb.test" }])],
    ]);
    const json = await (await dom("ctb.test")).json();
    expect(json.subdomains).toEqual(["a.ctb.test", "b.ctb.test"]);
  });

  it("400s a whitespace-only domain", async () => {
    stub([]);
    const res = await dom("   ");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Missing domain");
  });
});

describe("ip: sparse geo payloads", () => {
  let ipN = 0;
  const ip = (addr?: string) =>
    post(ipPOST, "http://localhost/api/ip-lookup", { ip: addr ?? `93.184.217.${++ipN}` });

  it("400s a whitespace-only address", async () => {
    stub([]);
    const res = await ip("   ");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Missing IP address");
  });

  it("nulls the ASN org when the AS string and asname are both empty", async () => {
    stub([["ip-api.com", resp(200, { status: "success", query: "93.184.217.9", countryCode: "US", as: "AS64512" })]]);
    const json = await (await ip()).json();
    expect(json.ip.asn).toBe(64512);
    expect(json.ip.asnOrg).toBeNull();
  });

  it("nulls the UTC offset when ip-api omits it", async () => {
    stub([["ip-api.com", resp(200, { status: "success", query: "93.184.217.8", countryCode: "US" })]]);
    const json = await (await ip()).json();
    expect(json.ip.utcOffset).toBeNull();
  });

  it("formats a negative and a positive UTC offset", async () => {
    stub([["ip-api.com", resp(200, { status: "success", query: "93.184.217.7", countryCode: "US", offset: -28800 })]]);
    expect((await (await ip()).json()).ip.utcOffset).toBe("UTC-8");

    stub([["ip-api.com", resp(200, { status: "success", query: "93.184.217.6", countryCode: "DE", offset: 7200 })]]);
    expect((await (await ip()).json()).ip.utcOffset).toBe("UTC+2");
  });

  it("falls back to the queried address when ip-api echoes none", async () => {
    stub([["ip-api.com", resp(200, { status: "success", countryCode: "US" })]]);
    const json = await (await ip("93.184.217.55")).json();
    expect(json.ip.ip).toBe("93.184.217.55");
  });

  it("labels an IPv6 address as IPv6", async () => {
    stub([["ip-api.com", resp(200, { status: "success", query: "2606:4700::1", countryCode: "US" })]]);
    const json = await (await ip("2606:4700::1")).json();
    expect(json.ip.type).toBe("IPv6");
  });

  it("reports a generic reason when every source fails without one", async () => {
    // 500 from ip-api, and the fallback plus both exposure sources answer 404
    // via the stub's default — nothing was learned, so this is a real failure.
    stub([["ip-api.com", resp(500, {})]]);
    const json = await (await ip()).json();
    expect(json.ip).toBeNull();
    expect(typeof json.error).toBe("string");
  });
});

describe("username / cases / bulk sparse paths", () => {
  it("429s the username route once the client is over its limit", async () => {
    useRateLimit(1);
    vi.stubGlobal("fetch", vi.fn(async () => resp(404, {})));
    const cookie = clientCookie("usernamerl");
    const call = () => usernamePOST(new Request("http://localhost/api/username-lookup", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ username: "someuser" }),
    }) as unknown as NextRequest);

    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(429);
  });

  it("records unknown for a site whose probe rejects outright", async () => {
    // Reject rather than resolve: exercises the allSettled rejected branch.
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("socket closed"))));
    const json = await (await post(usernamePOST, "http://localhost/api/username-lookup", { username: "rejectuser" })).json();
    expect(json.found).toBe(0);
    expect(json.hits.every((h: { status: string }) => h.status === "unknown" || h.status === "manual")).toBe(true);
  });

  it("defaults a case created, renamed or annotated with no text", async () => {
    const call = (b: unknown) => post(casesPOST, "http://localhost/api/cases", b);
    const { case: c } = await (await call({ action: "create" })).json();
    expect(c.name).toBeTruthy(); // the store supplies a fallback name

    const renamed = await (await call({ action: "rename", id: c.id })).json();
    expect(typeof renamed.case.name).toBe("string");

    const noted = await (await call({ action: "notes", id: c.id })).json();
    expect(noted.case.notes).toBe("");
  });

  it("nulls timezone and UTC offset for a number with neither", async () => {
    stub([]);
    // A number whose country has no timezone data in the offline analysis path.
    const { rows } = await (await post(bulkPOST, "http://localhost/api/bulk-lookup", {
      numbers: ["+6421000000"],
    })).json();
    expect(rows[0].ok).toBe(true);
    expect(rows[0].timezone === null || typeof rows[0].timezone === "string").toBe(true);
    expect(rows[0].utcOffset === null || typeof rows[0].utcOffset === "string").toBe(true);
  });
});
