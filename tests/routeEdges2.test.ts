import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { POST as bulkPOST } from "@/app/api/bulk-lookup/route";
import { GET as casesGET, POST as casesPOST, DELETE as casesDELETE } from "@/app/api/cases/route";
import { POST as domainPOST } from "@/app/api/domain-lookup/route";
import { POST as ipPOST } from "@/app/api/ip-lookup/route";
import { POST as usernamePOST } from "@/app/api/username-lookup/route";
import { setCached } from "@/lib/server/cache";
import { restoreRateLimit } from "./testUtils";
import type { LookupResponse } from "@/lib/types";

// Second pass over the route error/merge paths: the enrichment branches that
// only run when an upstream returns a particular shape.

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "hv-routeedges2-"));
  process.env.HV_DATA_DIR = dir;
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.HV_DATA_DIR;
});
afterEach(() => {
  vi.unstubAllGlobals();
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

// ── IP enrichment merges ─────────────────────────────────────────────────────

const geoOk = {
  status: "success", query: "93.184.216.5", country: "United States", countryCode: "US",
  regionName: "California", city: "SF", lat: 1, lon: 2, timezone: "America/Los_Angeles",
  isp: "ISP", org: "Org", as: "AS64512 Example", reverse: "host.test",
  proxy: false, hosting: false, mobile: false,
};

function ipStub(shodan: unknown, greynoise: unknown, geo: Record<string, unknown> = geoOk) {
  vi.stubGlobal("fetch", vi.fn(async (u: string | URL) => {
    const s = String(u);
    if (s.includes("ip-api.com")) return resp(200, geo);
    if (s.includes("internetdb.shodan.io")) return shodan as Response;
    if (s.includes("greynoise.io")) return greynoise as Response;
    return resp(404, {});
  }));
}

let ipN = 0;
const ipLookup = () => post(ipPOST, "http://localhost/api/ip-lookup", { ip: `93.184.216.${++ipN}` });

describe("IP: Shodan exposure merge", () => {
  it("merges ports, CVEs, hostnames and tags, and derives anonymity flags", async () => {
    ipStub(
      resp(200, { ports: [22, 443], vulns: ["CVE-2024-1"], hostnames: ["h.test"], tags: ["TOR", "vpn", "proxy"] }),
      resp(404, {}),
    );
    const json = await (await ipLookup()).json();
    expect(json.ip.ports).toEqual([22, 443]);
    expect(json.ip.vulns).toEqual(["CVE-2024-1"]);
    expect(json.ip.hostnames).toEqual(["h.test"]);
    expect(json.ip.isTor).toBe(true);
    expect(json.ip.isVpn).toBe(true);
    expect(json.ip.isProxy).toBe(true);
    expect(json.threatLabel).toBe("HIGH RISK"); // Tor floors the score at 80
  });

  it("nulls empty Shodan arrays rather than reporting an empty exposure", async () => {
    ipStub(resp(200, { ports: [], vulns: [], hostnames: [], tags: [] }), resp(404, {}));
    const json = await (await ipLookup()).json();
    expect(json.ip.ports).toBeNull();
    expect(json.ip.vulns).toBeNull();
    expect(json.ip.hostnames).toBeNull();
    expect(json.ip.tags).toBeNull();
  });

  it("scores known CVEs, capped at 95", async () => {
    ipStub(resp(200, { vulns: ["a"] }), resp(404, {}));
    expect((await (await ipLookup()).json()).threatScore).toBe(65); // 60 + 1×5

    ipStub(resp(200, { vulns: Array.from({ length: 20 }, (_, i) => `cve-${i}`) }), resp(404, {}));
    expect((await (await ipLookup()).json()).threatScore).toBe(95);
  });

  it("scores compromised / malware / honeypot tags highest", async () => {
    for (const tag of ["compromised", "malware", "honeypot"]) {
      ipStub(resp(200, { tags: [tag] }), resp(404, {}));
      expect((await (await ipLookup()).json()).threatScore, tag).toBe(85);
    }
  });

  it("ignores Shodan when it fails", async () => {
    ipStub(resp(500, {}), resp(404, {}));
    const json = await (await ipLookup()).json();
    expect(json.ip.ports).toBeNull();
    expect(json.threatLabel).toBe("CLEAN");
  });
});

describe("IP: GreyNoise merge", () => {
  it("records a malicious classification and scores it high", async () => {
    ipStub(resp(404, {}), resp(200, {
      classification: "malicious", noise: true, riot: false, name: "Scanner", last_seen: "2026-01-01",
    }));
    const json = await (await ipLookup()).json();
    expect(json.ip.greyNoise).toEqual({
      classification: "malicious", noise: true, riot: false, name: "Scanner", lastSeen: "2026-01-01",
    });
    expect(json.threatScore).toBe(85);
  });

  it("defaults missing GreyNoise fields", async () => {
    ipStub(resp(404, {}), resp(200, { classification: "benign" }));
    const json = await (await ipLookup()).json();
    expect(json.ip.greyNoise).toEqual({
      classification: "benign", noise: false, riot: false, name: null, lastSeen: null,
    });
    expect(json.threatScore).toBe(0);
  });

  it("ignores a 200 with no classification", async () => {
    ipStub(resp(404, {}), resp(200, {}));
    expect((await (await ipLookup()).json()).ip.greyNoise).toBeNull();
  });
});

describe("IP: ip-api field handling", () => {
  it("scores proxy, VPN and hosting flags from the geo source alone", async () => {
    ipStub(resp(404, {}), resp(404, {}), { ...geoOk, proxy: true });
    let json = await (await ipLookup()).json();
    expect(json.ip.isProxy).toBe(true);
    expect(json.threatScore).toBe(55);

    ipStub(resp(404, {}), resp(404, {}), { ...geoOk, hosting: true });
    json = await (await ipLookup()).json();
    expect(json.ip.isHosting).toBe(true);
    expect(json.threatScore).toBe(35);
  });

  it("nulls blank org and reverse rather than emitting empty strings", async () => {
    ipStub(resp(404, {}), resp(404, {}), { ...geoOk, org: "", reverse: "", isp: undefined });
    const json = await (await ipLookup()).json();
    expect(json.ip.org).toBeNull();
    expect(json.ip.reverse).toBeNull();
    expect(json.ip.isp).toBeNull();
  });

  it("omits the flag when the country code is missing", async () => {
    ipStub(resp(404, {}), resp(404, {}), { status: "success", query: "93.184.216.9" });
    const json = await (await ipLookup()).json();
    expect(json.ip.flagEmoji).toBeNull();
    expect(json.ip.asn).toBeNull();
  });
});

// ── Username sweep verdicts ──────────────────────────────────────────────────

describe("username sweep verdicts", () => {
  const sweep = (u: string) => post(usernamePOST, "http://localhost/api/username-lookup", { username: u });

  it("claims notfound on 404 and 410, never on an ambiguous status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resp(404, {})));
    let json = await (await sweep("nf404")).json();
    expect(json.found).toBe(0);
    expect(json.hits.some((h: { status: string }) => h.status === "notfound")).toBe(true);

    vi.stubGlobal("fetch", vi.fn(async () => resp(403, {})));
    json = await (await sweep("amb403")).json();
    expect(json.found).toBe(0);
    // 403 is a bot-wall, not proof of absence — must stay unknown.
    expect(json.hits.filter((h: { status: string }) => h.status === "notfound").length).toBe(0);
  });

  it("uses the absence marker on a body-checked site", async () => {
    // The one body-checked site declares an absence string; returning it must
    // yield notfound, and omitting it must yield found.
    const { USERNAME_SITES } = await import("@/lib/data/usernameSites");
    const bodySite = USERNAME_SITES.find((s) => s.check === "body")!;
    expect(bodySite.absence).toBeTruthy();

    vi.stubGlobal("fetch", vi.fn(async () => resp(200, bodySite.absence!)));
    const json = await (await sweep("bodyabsent")).json();
    const hit = json.hits.find((h: { site: string }) => h.site === bodySite.name);
    expect(hit.status).toBe("notfound");
  });

  it("never claims a manual site, whatever the network does", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resp(200, {})));
    const json = await (await sweep("manualcheck")).json();
    const manual = json.hits.filter((h: { status: string }) => h.status === "manual");
    expect(manual.length).toBeGreaterThan(0);
    expect(json.checked).toBe(json.hits.length - json.manual);
  });

  it("rejects an implausible handle before touching the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await sweep("a");
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a blank handle and a bad body", async () => {
    expect((await sweep("  ")).status).toBe(400);
    const bad = await post(usernamePOST, "http://localhost/api/username-lookup", { nope: 1 });
    expect(bad.status).toBe(400);
  });

  it("strips a leading @", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resp(404, {})));
    const json = await (await sweep("@handle")).json();
    expect(json.username).toBe("handle");
  });
});

// ── Cases: every action ──────────────────────────────────────────────────────

describe("cases: full action surface", () => {
  const call = (body: unknown) => post(casesPOST, "http://localhost/api/cases", body);

  it("walks create → rename → notes → addEntity → removeEntity → delete", async () => {
    const created = await (await call({ action: "create", name: "Op Zero" })).json();
    const id = created.case.id;
    expect(created.case.name).toBe("Op Zero");

    expect((await (await call({ action: "rename", id, name: "Op One" })).json()).case.name).toBe("Op One");
    expect((await (await call({ action: "notes", id, notes: "n" })).json()).case.notes).toBe("n");

    const added = await (await call({ action: "addEntity", id, kind: "phone", value: "+14155552671", note: "seed" })).json();
    expect(added.case.entities).toHaveLength(1);

    const removed = await (await call({ action: "removeEntity", id, kind: "phone", value: "+14155552671" })).json();
    expect(removed.case.entities).toHaveLength(0);

    const del = await casesDELETE(new NextRequest(new Request(`http://localhost/api/cases?id=${id}`, { method: "DELETE" })));
    expect(del.status).toBe(200);
    const list = await (await casesGET(new NextRequest("http://localhost/api/cases"))).json();
    expect(list.cases.find((c: { id: string }) => c.id === id)).toBeUndefined();
  });

  it("400s each action that is missing its required field", async () => {
    for (const body of [
      { action: "rename", name: "x" },
      { action: "notes", notes: "x" },
      { action: "addEntity", kind: "phone", value: "v" },
      { action: "removeEntity", kind: "phone", value: "v" },
      { action: "import" },
      { action: "merge", id: "x" },
    ]) {
      const res = await call(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("rejects an unknown entity kind and an unknown action", async () => {
    const { case: c } = await (await call({ action: "create", name: "Kinds" })).json();
    const bad = await call({ action: "addEntity", id: c.id, kind: "passport", value: "x" });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("Bad kind");

    const unknown = await call({ action: "nope" });
    expect(unknown.status).toBe(400);
  });

  it("404s when the target case does not exist", async () => {
    for (const body of [
      { action: "rename", id: "missing", name: "x" },
      { action: "notes", id: "missing", notes: "x" },
      { action: "addEntity", id: "missing", kind: "phone", value: "v" },
      { action: "removeEntity", id: "missing", kind: "phone", value: "v" },
    ]) {
      expect((await call(body)).status, JSON.stringify(body)).toBe(404);
    }
  });

  it("400s on malformed JSON", async () => {
    const res = await casesPOST(new Request("http://localhost/api/cases", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{oops",
    }) as unknown as NextRequest);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid JSON body");
  });

  it("400s a DELETE with no id", async () => {
    const res = await casesDELETE(new NextRequest(new Request("http://localhost/api/cases", { method: "DELETE" })));
    expect(res.status).toBe(400);
  });
});

// ── Domain DNS parsing ───────────────────────────────────────────────────────

describe("domain: DNS record parsing", () => {
  function dnsStub(answers: Record<string, Array<{ data: string; TTL?: number }>>) {
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL) => {
      const s = String(u);
      if (s.includes("cloudflare-dns")) {
        const type = new URL(s).searchParams.get("type")!;
        const rows = answers[type];
        return resp(200, rows ? { Answer: rows.map((r) => ({ name: "x", type: 1, TTL: r.TTL ?? 300, data: r.data })) } : {});
      }
      return resp(404, {});
    }));
  }

  it("splits MX priority from the host and trims the trailing dot", async () => {
    dnsStub({ MX: [{ data: "10 mail.example.test." }] });
    const json = await (await post(domainPOST, "http://localhost/api/domain-lookup", { domain: "mx.test" })).json();
    expect(json.dns.mx[0]).toEqual({ type: "MX", value: "mail.example.test", ttl: 300, priority: 10 });
    expect(json.emailSecurity.hasMx).toBe(true);
  });

  it("keeps an MX record whose priority is unparseable", async () => {
    dnsStub({ MX: [{ data: "x mail.example.test." }] });
    const json = await (await post(domainPOST, "http://localhost/api/domain-lookup", { domain: "mx2.test" })).json();
    expect(json.dns.mx[0].priority).toBeUndefined();
  });

  it("strips surrounding quotes from TXT and detects SPF and DMARC", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL) => {
      const s = String(u);
      if (s.includes("cloudflare-dns")) {
        const url = new URL(s);
        const name = url.searchParams.get("name")!;
        const type = url.searchParams.get("type")!;
        if (type === "TXT" && name.startsWith("_dmarc.")) {
          return resp(200, { Answer: [{ name, type: 16, TTL: 60, data: '"v=DMARC1; p=reject"' }] });
        }
        if (type === "TXT") {
          return resp(200, { Answer: [{ name, type: 16, TTL: 60, data: '"v=spf1 -all"' }] });
        }
        if (type === "DNSKEY") {
          return resp(200, { Answer: [{ name, type: 48, TTL: 60, data: "256 3 13 abc" }] });
        }
      }
      return resp(404, {});
    }));
    const json = await (await post(domainPOST, "http://localhost/api/domain-lookup", { domain: "spf.test" })).json();
    expect(json.emailSecurity.spf).toBe("v=spf1 -all");
    expect(json.emailSecurity.hasDmarc).toBe(true);
    expect(json.emailSecurity.dmarcPolicy).toBe("reject");
    expect(json.dnssec).toBe(true);
  });

  it("normalises a URL with scheme, port, path and www", async () => {
    dnsStub({});
    const json = await (await post(domainPOST, "http://localhost/api/domain-lookup", {
      domain: "https://www.Example.TEST:8443/some/path?q=1",
    })).json();
    expect(json.domain).toBe("example.test");
  });

  it("400s an invalid domain and a bad body", async () => {
    expect((await post(domainPOST, "http://localhost/api/domain-lookup", { domain: "not a domain" })).status).toBe(400);
    expect((await post(domainPOST, "http://localhost/api/domain-lookup", { nope: 1 })).status).toBe(400);
  });
});

describe("domain: certificate-transparency subdomains", () => {
  it("falls back to crt.sh when Certspotter comes back sparse, and merges both", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL) => {
      const s = String(u);
      if (s.includes("certspotter")) return resp(200, [{ dns_names: ["a.ct.test", "*.wild.ct.test", "ct.test"] }]);
      if (s.includes("crt.sh")) return resp(200, [{ name_value: "b.ct.test\nc.ct.test" }]);
      return resp(404, {});
    }));
    const json = await (await post(domainPOST, "http://localhost/api/domain-lookup", { domain: "ct.test" })).json();
    // Wildcard stripped, apex excluded, both sources merged and sorted.
    expect(json.subdomains).toEqual(["a.ct.test", "b.ct.test", "c.ct.test", "wild.ct.test"]);
  });

  it("skips the crt.sh fallback when Certspotter is already rich", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL) => {
      const s = String(u);
      seen.push(s);
      if (s.includes("certspotter")) {
        return resp(200, [{ dns_names: ["a.rich.test", "b.rich.test", "c.rich.test", "d.rich.test", "e.rich.test", "f.rich.test"] }]);
      }
      return resp(404, {});
    }));
    await post(domainPOST, "http://localhost/api/domain-lookup", { domain: "rich.test" });
    expect(seen.some((s) => s.includes("crt.sh"))).toBe(false);
  });

  it("tolerates both CT sources failing", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL) =>
      String(u).includes("certspotter") || String(u).includes("crt.sh") ? resp(500, {}) : resp(404, {})));
    const json = await (await post(domainPOST, "http://localhost/api/domain-lookup", { domain: "ctfail.test" })).json();
    expect(json.subdomains).toEqual([]);
  });
});

describe("domain: Wayback probe", () => {
  it("reports the oldest snapshot", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL) =>
      String(u).includes("archive.org")
        ? resp(200, { archived_snapshots: { closest: { timestamp: "19981212000000", url: "http://web.archive.org/web/1998/x" } } })
        : resp(404, {})));
    const json = await (await post(domainPOST, "http://localhost/api/domain-lookup", { domain: "wb.test" })).json();
    expect(json.wayback.available).toBe(true);
    expect(json.wayback.firstSnapshot).toBe("1998-12-12");
    expect(json.wayback.snapshotUrl.startsWith("https://")).toBe(true); // upgraded from http
  });

  it("reports 'no snapshot' distinctly from 'archive unreachable'", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL) =>
      String(u).includes("archive.org") ? resp(200, { archived_snapshots: {} }) : resp(404, {})));
    let json = await (await post(domainPOST, "http://localhost/api/domain-lookup", { domain: "wb2.test" })).json();
    expect(json.wayback).toEqual({ available: false, firstSnapshot: null, snapshotUrl: null });

    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("down"); }));
    json = await (await post(domainPOST, "http://localhost/api/domain-lookup", { domain: "wb3.test" })).json();
    expect(json.wayback).toBeNull();
  });

  it("keeps an unparseable timestamp verbatim", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL) =>
      String(u).includes("archive.org")
        ? resp(200, { archived_snapshots: { closest: { timestamp: "odd" } } })
        : resp(404, {})));
    const json = await (await post(domainPOST, "http://localhost/api/domain-lookup", { domain: "wb4.test" })).json();
    expect(json.wayback.firstSnapshot).toBe("odd");
    expect(json.wayback.snapshotUrl).toContain("web.archive.org");
  });
});

// ── Bulk cached-row fallbacks ────────────────────────────────────────────────

describe("bulk: cached row field fallbacks", () => {
  it("falls back to the analysis line type and nulls absent timezone/NPA data", async () => {
    const e164 = "+14155558811";
    setCached(e164, {
      aggregated: { country: null, countryName: "United States", lineType: null, carrier: null, timezone: null, utcOffsets: null },
      analysis: { type: "FIXED_LINE", npaInfo: null },
    } as unknown as LookupResponse);

    const { rows } = await (await post(bulkPOST, "http://localhost/api/bulk-lookup", { numbers: [e164] })).json();
    expect(rows[0]).toMatchObject({
      cached: true, country: null, type: "FIXED_LINE",
      timezone: null, utcOffset: null, npaState: null, npaRegion: null,
    });
  });

  it("uses the cached timezone and NPA data when present", async () => {
    const e164 = "+14155558812";
    setCached(e164, {
      aggregated: {
        country: "US", countryName: "United States", lineType: "mobile", carrier: "C",
        timezone: ["America/Los_Angeles"], utcOffsets: ["-08:00"],
      },
      analysis: { type: "MOBILE", npaInfo: { state: "California", region: "SF Bay Area" } },
    } as unknown as LookupResponse);

    const { rows } = await (await post(bulkPOST, "http://localhost/api/bulk-lookup", { numbers: [e164] })).json();
    expect(rows[0]).toMatchObject({
      timezone: "America/Los_Angeles", utcOffset: "-08:00",
      npaState: "California", npaRegion: "SF Bay Area",
    });
  });

  it("nulls both when the cached entry has neither a line type nor an analysis type", async () => {
    const e164 = "+14155558813";
    setCached(e164, {
      aggregated: { country: "US", countryName: "US", lineType: null, carrier: null },
      analysis: { type: null, npaInfo: null },
    } as unknown as LookupResponse);
    const { rows } = await (await post(bulkPOST, "http://localhost/api/bulk-lookup", { numbers: [e164] })).json();
    expect(rows[0].type).toBeNull();
  });
});
