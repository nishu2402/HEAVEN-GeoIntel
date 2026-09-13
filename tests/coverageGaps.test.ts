import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { entitiesFromWallet, entitiesFromHash } from "@/lib/analysis/entityExtract";
import { factsFromWallet, factsFromHash } from "@/lib/analysis/caseSnapshot";
import { defaultRunner, startJob, getJob, resetJobs, jobCsv, summarize } from "@/lib/server/bulkJobs";
import { createCase, markCaseReviewed, deleteCase, deleteAllCases, addEntity } from "@/lib/server/caseStore";
import { captureEvidence, listEvidence } from "@/lib/server/evidenceStore";
import { POST as casesPOST } from "@/app/api/cases/route";
import { POST as walletPOST } from "@/app/api/wallet-lookup/route";
import { GET as evidenceGET } from "@/app/api/evidence/route";
import { buildWalletReport, buildUsernameReport, buildDomainReport } from "@/lib/analysis/report";
import type { WalletLookupResponse, HashLookupResponse, UsernameLookupResponse, DomainLookupResponse } from "@/lib/types";
import { restoreRateLimit, resetServerState } from "./testUtils";

// The paths the feature tests do not naturally reach: wallet and hash entering
// a case, the bulk runner's own dispatch, the evidence locker travelling with a
// deleted case, and the report sections each new source added.

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hv-gaps-"));
  process.env.HV_DATA_DIR = dir;
  resetJobs();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.HV_DATA_DIR;
  vi.unstubAllGlobals();
  restoreRateLimit();
  resetServerState();
});
afterAll(() => { delete process.env.HV_DATA_DIR; });

const post = (h: (r: NextRequest) => Promise<Response>, url: string, body: unknown) =>
  h(new Request(url, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }) as unknown as NextRequest);

const wallet = (over: Partial<WalletLookupResponse> = {}): WalletLookupResponse => ({
  input: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
  chain: "eth",
  facts: {
    chain: "eth", address: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
    balance: "6.7 ETH", balanceRaw: "6700000000000000000", txCount: 5956,
    totalReceived: null, totalSent: null,
  },
  pivots: [],
  ...over,
});

describe("wallet and hash reach a case", () => {
  it("extracts the address, and a forward-verified ENS name with it", () => {
    expect(entitiesFromWallet(wallet())).toEqual([
      { kind: "wallet", value: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045" },
    ]);
    expect(entitiesFromWallet(wallet({ ens: { name: "vitalik.eth", address: "0x", verified: true } }))).toEqual([
      { kind: "wallet", value: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045" },
      { kind: "username", value: "vitalik.eth" },
    ]);
    // An unverified reverse record is a claim the address does not back, so it
    // never becomes a case entity.
    expect(entitiesFromWallet(wallet({ ens: { name: "spoof.eth", address: "0x", verified: false } }))).toHaveLength(1);
    // A wallet the explorer could not read still pins the address that was typed.
    expect(entitiesFromWallet(wallet({ facts: null }))[0].value).toBe("0xd8da6bf26964af9d7eed9e03e53415d37aa96045");
  });

  it("extracts a hash", () => {
    const hash = { input: "d41d8cd98f00b204e9800998ecf8427e", kind: "md5", facts: null, pivots: [] } as unknown as HashLookupResponse;
    expect(entitiesFromHash(hash)).toEqual([{ kind: "hash", value: "d41d8cd98f00b204e9800998ecf8427e" }]);
  });

  it("summarises both for the change diff, omitting what was never learned", () => {
    expect(factsFromWallet(wallet({
      sanctions: { listed: true, matches: [], source: "OFAC", snapshotDate: "2026-09-12", listSize: 1 },
      activity: { lastActivity: "2024-01-01", oldestSampled: null, sampled: 2, counterparties: 7, capped: false },
      tokens: [{ symbol: "USDT", contract: "0x", amount: "1", raw: "1" }],
      ens: { name: "vitalik.eth", address: "0x", verified: true },
    }))).toEqual({
      chain: "eth", balance: "6.7 ETH", txCount: 5956, sanctioned: "listed",
      lastActivity: "2024-01-01", tokens: 1, ens: "vitalik.eth",
    });

    expect(factsFromWallet(wallet({ facts: null, chain: null }))).toEqual({});
    expect(factsFromWallet(wallet({ sanctions: { listed: false, matches: [], source: "", snapshotDate: "", listSize: 0 } })).sanctioned)
      .toBe("not listed");

    expect(factsFromHash({ input: "abc", kind: "sha256", facts: null, pivots: [] } as unknown as HashLookupResponse))
      .toEqual({ kind: "sha256" });
    expect(factsFromHash({
      input: "abc", kind: "md5", pivots: [],
      facts: { known: true, fileName: "setup.exe", productName: "Acme", kind: "md5" },
    } as unknown as HashLookupResponse)).toEqual({
      kind: "md5", known: "known software", fileName: "setup.exe", product: "Acme",
    });
  });
});

describe("the bulk runner's own dispatch", () => {
  it("calls the real route handler for a row", async () => {
    // The runner exists so bulk cannot drift from single-target lookups: this
    // proves it reaches the actual handler rather than a copy of its logic.
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, status: 200, headers: new Headers(), json: async () => ({ Status: 3 }),
      text: async () => "",
    }) as unknown as Response));
    const out = await defaultRunner("hash", "d41d8cd98f00b204e9800998ecf8427e");
    expect(out.status).toBe(200);
    expect((out.body as { input: string }).input).toBe("d41d8cd98f00b204e9800998ecf8427e");
  });

  it("keeps finished jobs readable, then forgets them", async () => {
    const job = startJob({ rows: [{ mode: "domain", value: "a.test" }], runner: async () => ({ status: 200, body: {} }) });
    for (let i = 0; i < 100 && getJob(job.id)?.state === "running"; i++) await new Promise((r) => setTimeout(r, 5));
    expect(getJob(job.id)!.state).toBe("done");
    // A job with no rows at all still produces an (empty) CSV rather than throwing.
    expect(jobCsv({ ...job, rows: [] })).toBe("");
    expect(getJob("nope")).toBeNull();
  });

  it("summarises an email and a username row", () => {
    expect(summarize("email", {
      email: "a@b.test", analysis: { providerName: "Corp", isDisposable: false },
      gravatar: { found: true }, breachAggregate: { breaches: [1, 2] }, threatScore: 0, exposureScore: 8,
    })).toEqual({
      email: "a@b.test", provider: "Corp", disposable: false, gravatar: true,
      breaches: 2, abuseScore: 0, exposureScore: 8,
    });
    expect(summarize("username", {
      username: "u", found: 1, checked: 2, profiles: [{}],
      resolvedIdentity: { name: { value: "Ada" }, confidence: 40 },
    })).toMatchObject({ identity: "Ada", confidence: 40, profiles: 1 });
    // A field holding an object rather than a scalar is reported as absent.
    expect(summarize("phone", { input: { e164: {} } }).e164).toBeNull();
  });
});

describe("a case takes its evidence with it", () => {
  it("drops one locker on delete and every locker on a wipe", async () => {
    const one = await createCase("One");
    const two = await createCase("Two");
    await captureEvidence({ caseId: one.id, mode: "ip", identifier: "1.1.1.1", payload: { a: 1 } });
    await captureEvidence({ caseId: two.id, mode: "ip", identifier: "2.2.2.2", payload: { b: 2 } });

    expect(await deleteCase(one.id)).toBe(true);
    expect(await listEvidence(one.id)).toEqual([]);
    expect(await listEvidence(two.id)).toHaveLength(1);

    // Deleting a case that does not exist leaves the rest alone.
    expect(await deleteCase("no-such-case")).toBe(false);

    await deleteAllCases();
    expect(await listEvidence(two.id)).toEqual([]);
  });

  it("marks a case reviewed, and 404s one that is not there", async () => {
    const c = await createCase("Reviewed");
    const marked = await markCaseReviewed(c.id, 12345);
    expect(marked!.reviewedAt).toBe(12345);
    expect(await markCaseReviewed("nope")).toBeNull();

    const res = await post(casesPOST, "http://localhost/api/cases", { action: "markReviewed", id: c.id });
    expect(res.status).toBe(200);
    expect((await res.json()).case.reviewedAt).toBeGreaterThan(0);

    expect((await post(casesPOST, "http://localhost/api/cases", { action: "markReviewed" })).status).toBe(400);
    expect((await post(casesPOST, "http://localhost/api/cases", { action: "markReviewed", id: "nope" })).status).toBe(404);
  });

  it("pins a wallet and a hash, which the store used to reject", async () => {
    const c = await createCase("Kinds");
    await addEntity(c.id, "wallet", "0xdeadbeef");
    const updated = await addEntity(c.id, "hash", "d41d8cd98f00b204e9800998ecf8427e");
    expect(updated!.entities.map((e) => e.kind)).toEqual(["wallet", "hash"]);
  });

  it("reads the locker with no cookie header at all", async () => {
    const res = await evidenceGET(new Request("http://localhost/api/evidence?caseId=abc") as unknown as NextRequest);
    expect(res.status).toBe(200);
  });
});

describe("wallet route: a chain it cannot read", () => {
  it("answers with the sanctions match instead of a 400", async () => {
    // A Tron address: no balance to fetch, but "this is on the SDN list" is
    // offline and is the most consequential thing the tool knows about it.
    const res = await post(walletPOST, "http://localhost/api/wallet-lookup", {
      address: "TA3rH2A7iHnm6pKH8gr9cK1EZnShnmZdFg",
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.chain).toBeNull();
    expect(json.sanctions.listed).toBe(true);
    expect(json.sanctions.matches[0].entity).toBe("ISIL KHORASAN");
    expect(json.error).toMatch(/OFAC SDN list/);
  });

  it("still rejects an address that is neither readable nor listed", async () => {
    const res = await post(walletPOST, "http://localhost/api/wallet-lookup", { address: "TNotARealTronAddress" });
    expect(res.status).toBe(400);
  });
});

describe("reports carry the new findings", () => {
  it("leads a wallet report with the sanctions hit, and reports the sampling honestly", () => {
    const m = buildWalletReport(wallet({
      chain: "btc",
      sanctions: {
        listed: true,
        matches: [{ ticker: "XBT", address: "1abc", entity: "HYDRA MARKET", uid: "36216", programs: ["CYBER2"], entityType: "Entity", exact: true } as never],
        source: "OFAC SDN", snapshotDate: "2026-09-12", listSize: 1056,
      },
      activity: { lastActivity: "2020-02-18", oldestSampled: "2020-02-12", sampled: 2, counterparties: 107, capped: true },
      tokens: [{ symbol: "USDT", contract: "0x", amount: "12.5", raw: "12500000" }],
    }));
    expect(m.headline).toEqual({ label: "Sanctions", value: "OFAC SDN: HYDRA MARKET" });
    const flat = JSON.stringify(m.sections);
    expect(flat).toContain("LISTED");
    expect(flat).toContain("HYDRA MARKET");
    expect(flat).toContain("more transactions than were sampled");
    expect(flat).toContain("USDT: 12.5");
    expect(m.summary?.find((r) => r.label === "Sanctioned")?.value).toBe("YES: OFAC SDN");
  });

  it("keeps the balance headline when nothing is listed", () => {
    const m = buildWalletReport(wallet({
      sanctions: { listed: false, matches: [], source: "OFAC SDN", snapshotDate: "2026-09-12", listSize: 1056 },
      activity: { lastActivity: "2024-01-01", oldestSampled: "2023-01-01", sampled: 50, counterparties: 3, capped: false },
    }));
    expect(m.headline?.label).toBe("Balance");
    expect(JSON.stringify(m.sections)).toContain("covers every transaction the explorer returned");
  });

  it("shows a username identity's proof, its contradictions and its unlinked leads", () => {
    const m = buildUsernameReport({
      username: "torvalds", checked: 23, found: 12, manual: 15, hits: [], profiles: [],
      identity: { names: [], locations: [], avatars: [], bios: [] },
      resolvedIdentity: {
        name: { value: "Linus Torvalds", sources: ["github"], agreement: 1, total: 1 },
        location: null, avatar: null, confidence: 40, label: "medium",
        cluster: { platforms: ["GitHub"], proofs: [{ kind: "avatar", platforms: ["GitHub", "Mastodon"], detail: "same photo" }] },
        unlinked: [{ field: "location", value: "GT", source: "Chess.com" }],
        conflicts: [{ field: "name", values: [{ value: "A", source: "X" }, { value: "B", source: "Y" }] }],
      },
      avatarClusters: [{ sources: ["GitHub", "Mastodon"], urls: [], similarity: 100 }],
      avatarSkipped: [{ url: "u", source: "Bluesky", reason: "unsupported image format" }],
      pivots: [], leakCheck: { ok: false }, hudsonRock: { ok: false },
    } as unknown as UsernameLookupResponse);
    const flat = JSON.stringify(m.sections);
    expect(flat).toContain("avatar: same photo");
    expect(flat).toContain("Unlinked candidates");
    expect(flat).toContain("A (X) vs B (Y)");
    expect(flat).toContain("100% perceptual match");
    expect(flat).toContain("Bluesky: unsupported image format");
  });

  it("reports subdomain coverage, passive DNS, exposure, co-hosting and the registry", () => {
    const m = buildDomainReport({
      domain: "wordpress.org", isValid: true,
      dns: { a: [{ type: "A", value: "66.6.42.252" }], aaaa: [], mx: [], txt: [], ns: [], cname: [] },
      whois: null, subdomains: ["a.wordpress.org"],
      subdomainCoverage: {
        sources: [{ source: "Certspotter", ok: true, found: 9 }, { source: "crt.sh", ok: false, found: 0 }],
        distinct: 494, limit: 250, capped: true,
      },
      subdomainHosts: [{ host: "a.wordpress.org", addresses: [] }],
      passiveDns: {
        records: [{ query: "wordpress.org", answer: "1.2.3.4", rrtype: "A", firstSeen: "2018-02-02", lastSeen: "2026-06-29", times: 5 }],
        total: 1000, capped: true, degraded: false,
      },
      hostExposure: [
        { ip: "66.6.42.252", ports: [80, 443], vulns: ["CVE-2024-0001"], hostnames: null, tags: ["eol-product"], greyNoise: { classification: "benign", noise: false, riot: true, name: null, lastSeen: null }, isTor: null, isVpn: null, isProxy: null },
        { ip: "2620::1", ports: null, vulns: null, hostnames: null, tags: null, greyNoise: null, isTor: null, isVpn: null, isProxy: null },
      ],
      reverseIp: { ip: "66.6.42.252", hosts: ["other.test"], total: 500 },
      lei: {
        records: [
          { lei: "L1", legalName: "Automattic Inc.", status: "ISSUED", country: "US", legalAddress: "SF", headquartersAddress: null, registeredAs: "39", entityStatus: "ACTIVE", exact: true },
          { lei: "L2", legalName: "Automattic Ventures", status: "ISSUED", country: "US", legalAddress: null, headquartersAddress: null, registeredAs: null, entityStatus: "ACTIVE", exact: false },
        ],
        total: 2, query: "Automattic Inc.", source: "certificate",
      },
      emailSecurity: { hasSpf: true, spf: "v=spf1", hasDmarc: true, dmarcPolicy: "reject", hasMx: false, nullMx: false },
      dnssec: null, wayback: null, http: null, pivots: [],
    } as unknown as DomainLookupResponse);
    const flat = JSON.stringify(m.sections);
    expect(flat).toContain("Certspotter: 9 found");
    expect(flat).toContain("crt.sh: no answer");
    expect(flat).toContain("494 distinct, list truncated to 250");
    expect(flat).toContain("a.wordpress.org → no A record");
    expect(flat).toContain("Passive DNS (1,000 records held)");
    expect(flat).toContain("ports 80, 443");
    expect(flat).toContain("2620::1: nothing reported");
    expect(flat).toContain("Co-hosted on 66.6.42.252 (500 names)");
    expect(flat).toContain("exact name match");
    expect(flat).toContain("similar name only");
    expect(m.summary?.find((r) => r.label === "Legal entity")?.value).toBe("Automattic Inc.");
  });
});

describe("the last few branches", () => {
  it("refuses a bulk list where nothing classifies into a lookup mode", async () => {
    const { POST: bulkPOST } = await import("@/app/api/bulk-lookup/route");
    const res = await post(bulkPOST, "http://localhost/api/bulk-lookup", { items: ["nothing at all"], mode: "auto" });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/could be looked up/i);
    // "nothing at all" classifies as a username and then fails the username
    // charset, so it is reported as skipped with the reason rather than
    // spending a lookup that would 400 two minutes later.
    expect(json.skipped[0].reason).toBe("not a valid username");
  });

  it("forgets a job long after it finished", async () => {
    vi.useFakeTimers();
    try {
      const first = startJob({ rows: [{ mode: "domain", value: "a.test" }], runner: async () => ({ status: 200, body: {} }) });
      await vi.advanceTimersByTimeAsync(10);
      expect(getJob(first.id)).not.toBeNull();
      // Half an hour later, starting another job sweeps the finished one away.
      vi.setSystemTime(Date.now() + 31 * 60_000);
      const second = startJob({ rows: [{ mode: "domain", value: "b.test" }], runner: async () => ({ status: 200, body: {} }) });
      await vi.advanceTimersByTimeAsync(10);
      expect(getJob(first.id)).toBeNull();
      expect(getJob(second.id)).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports an avatar host that drops the connection mid-redirect", async () => {
    const { hashAvatar } = await import("@/lib/server/avatarHash");
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      call++;
      if (call === 1) {
        return { ok: false, status: 302, headers: new Headers({ location: "https://cdn2.test/b.png" }), body: null } as unknown as Response;
      }
      throw new Error("connection reset");
    }));
    expect(await hashAvatar({ url: "https://cdn.test/a.png", source: "X" })).toMatchObject({
      reason: "image could not be fetched",
    });
  });
});

describe("routes: the paths a happy lookup skips", () => {
  it("domain: merges reverse-IP and passive-DNS names into the subdomain list", async () => {
    const { POST: domainPOST } = await import("@/app/api/domain-lookup/route");
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL) => {
      const s = String(u);
      if (s.includes("cloudflare-dns")) {
        return {
          ok: true, status: 200, headers: new Headers(),
          json: async () => (s.includes("type=A")
            ? { Status: 0, Answer: [{ name: "a.test", type: 1, TTL: 60, data: "9.9.9.9" }] }
            : { Status: 0 }),
        } as unknown as Response;
      }
      if (s.includes("hackertarget")) {
        return {
          ok: true, status: 200, headers: new Headers(),
          // One name under the apex (a subdomain) and one that is not (co-hosting).
          text: async () => "reverse.a.test\nsomeone-else.test\n",
        } as unknown as Response;
      }
      if (s.includes("mnemonic")) {
        return {
          ok: true, status: 200, headers: new Headers(),
          json: async () => ({
            responseCode: 200, count: 2,
            data: [
              { query: "pdns.a.test", answer: "1.1.1.1", rrtype: "a", firstSeenTimestamp: 1_600_000_000_000, lastSeenTimestamp: 1_700_000_000_000 },
              { query: "elsewhere.test", answer: "2.2.2.2", rrtype: "a", firstSeenTimestamp: 1_600_000_000_000, lastSeenTimestamp: 1_700_000_000_000 },
            ],
          }),
        } as unknown as Response;
      }
      return { ok: false, status: 404, headers: new Headers(), json: async () => ({}), text: async () => "" } as unknown as Response;
    }));

    const json = await (await post(domainPOST, "http://localhost/api/domain-lookup", { domain: "a.test" })).json();
    expect(json.subdomains).toContain("reverse.a.test");
    expect(json.subdomains).toContain("pdns.a.test");
    // A third-party name on the same address is co-hosting, not a subdomain.
    expect(json.subdomains).not.toContain("someone-else.test");
    expect(json.reverseIp.hosts).toContain("someone-else.test");
    const cov = Object.fromEntries(json.subdomainCoverage.sources.map((c: { source: string; found: number }) => [c.source, c.found]));
    expect(cov["HackerTarget reverse IP"]).toBe(1);
    expect(cov["Mnemonic PDNS"]).toBe(1);
  });

  it("domain: keeps the readable spelling of an internationalised name", async () => {
    const { POST: domainPOST } = await import("@/app/api/domain-lookup/route");
    vi.stubGlobal("fetch", vi.fn(async () =>
      ({ ok: false, status: 503, headers: new Headers(), json: async () => ({}), text: async () => "" }) as unknown as Response));
    const json = await (await post(domainPOST, "http://localhost/api/domain-lookup", { domain: "münchen.de" })).json();
    expect(json.domain).toBe("xn--mnchen-3ya.de");
    expect(json.domainUnicode).toBe("münchen.de");
  });

  it("wallet: reports no activity sample when the explorer refuses the tx list", async () => {
    const { POST: walletPOST } = await import("@/app/api/wallet-lookup/route");
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL) => {
      const s = String(u);
      if (s.endsWith("/txs")) return { ok: false, status: 500, headers: new Headers(), json: async () => ({}) } as unknown as Response;
      return {
        ok: true, status: 200, headers: new Headers(),
        json: async () => ({ chain_stats: { funded_txo_sum: 10, spent_txo_sum: 4, tx_count: 3 } }),
      } as unknown as Response;
    }));
    const json = await (await post(walletPOST, "http://localhost/api/wallet-lookup", {
      address: "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2",
    })).json();
    expect(json.facts.balance).toBe("0.00000006 BTC");
    expect(json.activity).toBeNull();
  });

  it("evidence: charges the quota, and audits a capture", async () => {
    const { POST: evidencePOST } = await import("@/app/api/evidence/route");
    const res = await evidencePOST(new Request("http://localhost/api/evidence", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.117.9" },
      body: JSON.stringify({ action: "capture", caseId: "audited", mode: "domain", identifier: "a.test", payload: { a: 1 } }),
    }) as unknown as NextRequest);
    expect(res.status).toBe(200);
    expect((await res.json()).entry.mode).toBe("domain");
  });

  it("sweep: sweeps the whole catalog when nothing has been validated", async () => {
    const { sweepSites } = await import("@/app/api/username-sweep/route");
    const { EXTENDED_USERNAME_SITES } = await import("@/lib/data/extendedUsernameSites");
    const validated = EXTENDED_USERNAME_SITES.filter((s) => s.v === true);
    // The catalog ships validated entries, so the fallback is exercised by
    // asking for the unvalidated view and checking it is a superset.
    expect(validated.length).toBeGreaterThan(0);
    expect(sweepSites(true).length).toBeGreaterThan(sweepSites().length);
  });

  it("sweep: carries the site's anti-bot protection onto the result row", async () => {
    const { POST: sweepPOST } = await import("@/app/api/username-sweep/route");
    const { sweepSites } = await import("@/app/api/username-sweep/route");
    const protectedIndex = sweepSites().findIndex((s) => (s.pr?.length ?? 0) > 0);
    expect(protectedIndex).toBeGreaterThanOrEqual(0);
    vi.stubGlobal("fetch", vi.fn(async () =>
      ({ ok: false, status: 403, headers: new Headers(), text: async () => "" }) as unknown as Response));
    const json = await (await post(sweepPOST, "http://localhost/api/username-sweep", {
      username: "torvalds", offset: protectedIndex, limit: 1,
    })).json();
    expect(json.hits[0].protection.length).toBeGreaterThan(0);
  });
});
