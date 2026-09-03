import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { pivotsFromEmail } from "@/lib/analysis/autoPivot";
import { factsFromUsername } from "@/lib/analysis/caseSnapshot";
import { mergeEdges, mergeSnapshots } from "@/lib/analysis/caseMerge";
import { buildCaseJson } from "@/lib/analysis/caseReport";
import { createCase, deleteAllCases, addEdges, recordSnapshot, getCase, importCase } from "@/lib/server/caseStore";
import { POST as lookupPOST } from "@/app/api/lookup/route";
import type { EmailLookupResponse, UsernameLookupResponse, InvestigationCase } from "@/lib/types";

// Remaining branch coverage for the Phase 3/4 work: the paths a happy-path test
// doesn't reach, each one a real behaviour rather than a coverage filler.

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "hv-p3edges-"));
  process.env.HV_DATA_DIR = dir;
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.HV_DATA_DIR;
});
beforeEach(async () => { await deleteAllCases(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const off = { ok: false as const, error: "NOT_CONFIGURED" };

// ── autoPivot: URL handling and the email FullContact path ───────────────────

describe("auto-pivot host parsing", () => {
  const email = (over: Partial<EmailLookupResponse> = {}): EmailLookupResponse => ({
    email: "ada@example.com",
    analysis: { username: "ada", domain: "example.com" },
    gravatar: { found: false, preferredUsername: null, accounts: [] },
    emailrep: off, hunter: off, abstract: off, xon: off,
    breachDirectory: off, fullContact: off, hudsonRock: off, leakCheck: off,
    ...over,
  } as unknown as EmailLookupResponse);

  it("accepts a bare host and a scheme-qualified URL alike, stripping www.", () => {
    const p = pivotsFromEmail(email({
      gravatar: {
        found: true, preferredUsername: null,
        accounts: [
          { shortname: "a", username: "u1", url: "https://www.github.com/u1" },
          { shortname: "b", username: "u2", url: "gitlab.com/u2" },
        ],
      },
    } as unknown as Partial<EmailLookupResponse>));
    const domains = p.filter((x) => x.kind === "domain").map((x) => x.value);
    expect(domains).toContain("github.com");
    expect(domains).toContain("gitlab.com");
  });

  it("ignores a whitespace-only URL and a scheme that carries no host", () => {
    const p = pivotsFromEmail(email({
      gravatar: {
        found: true, preferredUsername: null,
        accounts: [
          { shortname: "a", username: "", url: "   " },
          { shortname: "b", username: "", url: "file:///etc/passwd" },
        ],
      },
    } as unknown as Partial<EmailLookupResponse>));
    expect(p.filter((x) => x.kind === "domain").map((x) => x.value)).toEqual(["example.com"]);
  });

  it("takes the host, not the credentials, from a userinfo URL", () => {
    const p = pivotsFromEmail(email({
      gravatar: { found: true, preferredUsername: null, accounts: [{ shortname: "a", username: "", url: "https://user:pw@real.host/x" }] },
    } as unknown as Partial<EmailLookupResponse>));
    expect(p.filter((x) => x.kind === "domain").map((x) => x.value)).toContain("real.host");
  });

  it("drops a URL that cannot be parsed at all", () => {
    const p = pivotsFromEmail(email({
      gravatar: { found: true, preferredUsername: null, accounts: [{ shortname: "x", username: "", url: "http://[bad" }] },
    } as unknown as Partial<EmailLookupResponse>));
    expect(p.filter((x) => x.kind === "domain").map((x) => x.value)).toEqual(["example.com"]);
  });

  it("pulls FullContact phones and profile handles from an email result", () => {
    const p = pivotsFromEmail(email({
      fullContact: { ok: true, data: {
        otherEmails: [], phones: ["+14155552671"],
        profiles: [{ platform: "LinkedIn", username: "ada-l", url: "" }],
      } },
    } as unknown as Partial<EmailLookupResponse>));
    expect(p.map((x) => `${x.kind}:${x.value}`)).toContain("phone:+14155552671");
    expect(p.map((x) => `${x.kind}:${x.value}`)).toContain("username:ada-l");
  });

  it("tolerates FullContact data whose optional arrays are absent", () => {
    const p = pivotsFromEmail(email({ fullContact: { ok: true, data: {} } } as unknown as Partial<EmailLookupResponse>));
    expect(p.map((x) => x.kind)).toEqual(["username", "domain"]); // only the local part + domain
  });
});

// ── caseSnapshot: the unconfigured-source branch ─────────────────────────────

describe("factsFromUsername", () => {
  it("omits leakCheckRecords when LeakCheck did not answer", () => {
    const facts = factsFromUsername({
      found: 2, checked: 20, profiles: [], leakCheck: off,
    } as unknown as UsernameLookupResponse);
    expect(facts).toEqual({ sitesFound: 2, sitesChecked: 20, verifiedProfiles: 0 });
  });
});

// ── caseMerge: earliest-sighting wins ────────────────────────────────────────

describe("mergeEdges / mergeSnapshots", () => {
  it("keeps the EARLIER addedAt when both cases hold the same edge", () => {
    const mk = (addedAt: number) => ({
      from: { kind: "email" as const, value: "a@x.com" },
      to: { kind: "domain" as const, value: "x.com" },
      reason: "same", addedAt,
    });
    // A merge must never rewrite when a link was first derived.
    expect(mergeEdges([mk(500)], [mk(100)])[0].addedAt).toBe(100);
    expect(mergeEdges([mk(100)], [mk(500)])[0].addedAt).toBe(100);
  });

  it("defaults both sides to empty", () => {
    expect(mergeEdges()).toEqual([]);
    expect(mergeSnapshots()).toEqual([]);
  });
});

// ── caseStore: import/edge validation branches ───────────────────────────────

describe("caseStore validation branches", () => {
  it("de-dupes identical edges inside a single import payload", async () => {
    const e = { from: { kind: "email", value: "a@x.com" }, to: { kind: "domain", value: "x.com" }, reason: "dup", addedAt: 1 };
    const c = await importCase({ name: "Dup", edges: [e, { ...e }] });
    expect(c.edges).toHaveLength(1);
  });

  it("drops an imported edge whose reason is blank, defaulting it instead", async () => {
    const c = await importCase({
      name: "Blank",
      edges: [{ from: { kind: "email", value: "a@x.com" }, to: { kind: "domain", value: "x.com" }, reason: "   ", addedAt: 1 }],
    });
    expect(c.edges![0].reason).toBe("derived");
  });

  it("rejects an IMPORTED edge whose end has a bad kind or blank value", async () => {
    const c = await importCase({
      name: "BadImport",
      edges: [
        { from: { kind: "bogus", value: "x" }, to: { kind: "domain", value: "x.com" }, reason: "bad kind" },
        { from: { kind: "email", value: "   " }, to: { kind: "domain", value: "x.com" }, reason: "blank" },
      ],
    });
    expect(c.edges).toBeUndefined();
  });

  it("treats an imported snapshot with an absent value as unusable", async () => {
    const c = await importCase({ name: "NoValue", snapshots: [{ kind: "domain", facts: {} }] });
    expect(c.snapshots).toBeUndefined();
  });

  it("defaults an edge reason that is absent entirely", async () => {
    const c = await createCase("NoReason");
    await addEdges(c.id, [{ from: { kind: "email", value: "a@x.com" }, to: { kind: "domain", value: "x.com" } }]);
    expect((await getCase(c.id))!.edges![0].reason).toBe("derived");
  });

  it("rejects an edge end with a missing kind or a non-string value", async () => {
    const c = await createCase("Bad");
    await addEdges(c.id, [
      { from: { value: "a@x.com" }, to: { kind: "domain", value: "x.com" }, reason: "no kind" },
      { from: { kind: "email", value: null }, to: { kind: "domain", value: "x.com" }, reason: "null value" },
    ]);
    expect((await getCase(c.id))!.edges).toBeUndefined();
  });

  it("caps a snapshot's fact bag rather than storing an unbounded object", async () => {
    const c = await createCase("Fat");
    const facts: Record<string, number> = {};
    for (let i = 0; i < 60; i++) facts[`f${i}`] = i;
    const out = await recordSnapshot(c.id, "domain", "a.com", facts, false);
    expect(Object.keys(out!.case.snapshots![0].facts)).toHaveLength(40);
  });

  it("truncates over-long fact keys and values", async () => {
    const c = await createCase("Long");
    const out = await recordSnapshot(c.id, "domain", "a.com", {
      ["k".repeat(200)]: "v".repeat(400),
    }, false);
    const [k, v] = Object.entries(out!.case.snapshots![0].facts)[0];
    expect(k).toHaveLength(64);
    expect(String(v)).toHaveLength(200);
  });
});

// ── caseReport: edge sort tiebreakers ────────────────────────────────────────

describe("case report edge ordering", () => {
  it("orders edges by from, then to, then reason: so the hash is stable", async () => {
    const mk = (from: string, to: string, reason: string) => ({
      from: { kind: "email" as const, value: from },
      to: { kind: "domain" as const, value: to },
      reason, addedAt: 1,
    });
    const c = {
      id: "c", name: "N", createdAt: 1, updatedAt: 1, entities: [], notes: "",
      edges: [mk("b@x.com", "a.com", "z"), mk("a@x.com", "b.com", "b"), mk("a@x.com", "b.com", "a"), mk("a@x.com", "a.com", "a")],
    } as InvestigationCase;
    const env = JSON.parse((await buildCaseJson(c)).json);
    expect(env.case.edges.map((e: { from: { value: string }; to: { value: string }; reason: string }) =>
      `${e.from.value}|${e.to.value}|${e.reason}`)).toEqual([
      "a@x.com|a.com|a", "a@x.com|b.com|a", "a@x.com|b.com|b", "b@x.com|a.com|z",
    ]);
  });
});

// ── phone threat score: the LeakCheck contribution ───────────────────────────

describe("phone threat score includes LeakCheck exposure", () => {
  const resp = (status: number, body: unknown) =>
    ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

  it("adds a capped bump for indexed breach records", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL) => {
      const s = String(u);
      if (s.includes("leakcheck")) return resp(200, { success: true, found: 20, fields: [], sources: [] });
      if (s.includes("hudsonrock")) return resp(200, { stealers: [] });
      return resp(404, {});
    }));
    const res = await lookupPOST(new NextRequest("http://localhost/api/lookup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ number: "+14155552671" }),
    }));
    const json = await res.json();
    // 20 records × 3 = 60, capped at 20. Deliberately weighted below
    // BreachDirectory: LeakCheck's free tier proves records EXIST, not what
    // they contain.
    expect(json.threatScore).toBe(20);
    expect(json.sources.leakCheck.data.found).toBe(20);
  });
});
