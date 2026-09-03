import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { GET, POST, DELETE } from "@/app/api/cases/route";
import { createCase, deleteAllCases, addEntity, addEdges, recordSnapshot, getCase, mergeCases, importCase } from "@/lib/server/caseStore";
import { CASE_TOKEN_COOKIE, issueToken } from "@/lib/server/caseLock";
import type { CaseEdge, InvestigationCase } from "@/lib/types";

// Phase 3.4/3.5/4.8: the persisted graph, the snapshot/diff loop, and the
// optional case lock — driven through both the store and the HTTP layer.

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "hv-casegraph-"));
  process.env.HV_DATA_DIR = dir;
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.HV_DATA_DIR;
});
beforeEach(async () => { await deleteAllCases(); });
afterEach(() => {
  delete process.env.CASE_PASSWORD;
  delete process.env.CASE_SNAPSHOT_HISTORY;
});

const post = (body: unknown, cookie?: string) =>
  POST(new NextRequest("http://localhost/api/cases", {
    method: "POST",
    headers: cookie
      ? { "content-type": "application/json", cookie }
      : { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));

const getReq = (cookie?: string) =>
  new NextRequest("http://localhost/api/cases", cookie ? { headers: { cookie } } : undefined);

const edge = (fromV: string, toV: string, reason = "test"): CaseEdge["from"] extends never ? never : {
  from: { kind: "email" | "domain"; value: string }; to: { kind: "email" | "domain"; value: string }; reason: string;
} => ({
  from: { kind: "email", value: fromV },
  to: { kind: "domain", value: toV },
  reason,
});

// ── Derived graph edges ──────────────────────────────────────────────────────

describe("case graph edges", () => {
  it("stores edges and de-dupes on from+to+reason", async () => {
    const c = await createCase("Graph");
    await addEdges(c.id, [edge("a@x.com", "x.com"), edge("a@x.com", "x.com")]);
    await addEdges(c.id, [edge("a@x.com", "x.com")]); // same again, later call
    const after = await getCase(c.id);
    expect(after!.edges).toHaveLength(1);
    expect(after!.edges![0].reason).toBe("test");
  });

  it("keeps the same pair under two DIFFERENT reasons: they are distinct findings", async () => {
    const c = await createCase("Graph");
    await addEdges(c.id, [edge("a@x.com", "x.com", "Email domain"), edge("a@x.com", "x.com", "EmailRep: primary MX host")]);
    expect((await getCase(c.id))!.edges).toHaveLength(2);
  });

  it("drops self-edges and malformed ends", async () => {
    const c = await createCase("Graph");
    await addEdges(c.id, [
      { from: { kind: "email", value: "a@x.com" }, to: { kind: "email", value: "A@X.com" }, reason: "self" },
      { from: { kind: "nope", value: "a" }, to: { kind: "domain", value: "x.com" }, reason: "bad kind" },
      { from: { kind: "email", value: "  " }, to: { kind: "domain", value: "x.com" }, reason: "blank" },
      { from: undefined, to: { kind: "domain", value: "x.com" }, reason: "missing" },
    ]);
    expect((await getCase(c.id))!.edges).toBeUndefined();
  });

  it("defaults a blank reason rather than storing an empty label", async () => {
    const c = await createCase("Graph");
    await addEdges(c.id, [{ from: { kind: "email", value: "a@x.com" }, to: { kind: "domain", value: "x.com" }, reason: "   " }]);
    expect((await getCase(c.id))!.edges![0].reason).toBe("derived");
  });

  it("returns null for an unknown case", async () => {
    expect(await addEdges("nope", [edge("a@x.com", "x.com")])).toBeNull();
  });

  it("leaves updatedAt alone when nothing new was added", async () => {
    const c = await createCase("Graph");
    await addEdges(c.id, [edge("a@x.com", "x.com")]);
    const first = (await getCase(c.id))!.updatedAt;
    await new Promise((r) => setTimeout(r, 2));
    await addEdges(c.id, [edge("a@x.com", "x.com")]);
    expect((await getCase(c.id))!.updatedAt).toBe(first);
  });
});

// ── Snapshots + diffing ──────────────────────────────────────────────────────

describe("case snapshots", () => {
  it("records a baseline, then reports what moved on the next run", async () => {
    const c = await createCase("Watch");
    const first = await recordSnapshot(c.id, "domain", "example.com", { subdomains: 3 }, false);
    expect(first!.diff.baseline).toBe(true);
    expect(first!.diff.changes).toEqual([]);

    const second = await recordSnapshot(c.id, "domain", "example.com", { subdomains: 5 }, false);
    expect(second!.diff.baseline).toBe(false);
    expect(second!.diff.changes).toEqual([{ fact: "subdomains", from: 3, to: 5 }]);
  });

  it("diffs against what is ON DISK, not against anything the caller passed", async () => {
    // The whole point of server-side diffing: a client that lost its memory
    // (new session, reload) still gets a correct comparison.
    const c = await createCase("Watch");
    await recordSnapshot(c.id, "ip", "8.8.8.8", { openPorts: 2 }, false);
    const later = await recordSnapshot(c.id, "ip", "8.8.8.8", { openPorts: 4 }, false);
    expect(later!.diff.previousAt).toBeTypeOf("number");
    expect(later!.diff.changes).toEqual([{ fact: "openPorts", from: 2, to: 4 }]);
  });

  it("never compares a snapshot with itself", async () => {
    const c = await createCase("Watch");
    const only = await recordSnapshot(c.id, "domain", "a.com", { x: 1 }, false);
    expect(only!.diff.changes).toEqual([]);
    expect(only!.case.snapshots).toHaveLength(1);
  });

  it("keeps only CASE_SNAPSHOT_HISTORY entries per identifier", async () => {
    process.env.CASE_SNAPSHOT_HISTORY = "2";
    const c = await createCase("Watch");
    for (const n of [1, 2, 3, 4]) await recordSnapshot(c.id, "domain", "a.com", { n }, false);
    const stored = (await getCase(c.id))!.snapshots!;
    expect(stored).toHaveLength(2);
    expect(stored.map((s) => s.facts.n)).toEqual([3, 4]);
  });

  it("records the cache flag so an empty diff is not mistaken for stability", async () => {
    const c = await createCase("Watch");
    await recordSnapshot(c.id, "domain", "a.com", { x: 1 }, false);
    const second = await recordSnapshot(c.id, "domain", "a.com", { x: 1 }, true);
    expect(second!.diff.changes).toEqual([]);
    expect(second!.diff.cacheInvolved).toBe(true);
  });

  it("coerces an untrusted fact bag to scalars", async () => {
    const c = await createCase("Watch");
    const out = await recordSnapshot(c.id, "domain", "a.com", {
      good: 1, alsoGood: "yes", nested: { a: 1 }, arr: [1], nan: Number.NaN, fn: () => {},
    }, false);
    expect(out!.case.snapshots![0].facts).toEqual({ good: 1, alsoGood: "yes" });
  });

  it("ignores a non-object fact bag", async () => {
    const c = await createCase("Watch");
    for (const bad of ["str", 42, null, [1, 2]]) {
      const out = await recordSnapshot(c.id, "domain", `${String(bad)}.com`, bad, false);
      expect(out!.case.snapshots!.at(-1)!.facts).toEqual({});
    }
  });

  it("returns null for an unknown case or a blank value", async () => {
    const c = await createCase("Watch");
    expect(await recordSnapshot("nope", "domain", "a.com", {}, false)).toBeNull();
    expect(await recordSnapshot(c.id, "domain", "   ", {}, false)).toBeNull();
  });
});

// ── merge + import carry the new sections ────────────────────────────────────

describe("merge and import keep the graph and history", () => {
  it("folds both cases' edges and interleaves their snapshots by time", async () => {
    const target = await createCase("Target");
    const source = await createCase("Source");
    await addEdges(target.id, [edge("a@x.com", "x.com", "one")]);
    await addEdges(source.id, [edge("b@y.com", "y.com", "two")]);
    await recordSnapshot(target.id, "domain", "x.com", { n: 1 }, false);
    await new Promise((r) => setTimeout(r, 2));
    await recordSnapshot(source.id, "domain", "y.com", { n: 2 }, false);

    const merged = await mergeCases(target.id, source.id);
    expect(merged!.edges).toHaveLength(2);
    expect(merged!.snapshots).toHaveLength(2);
    const times = merged!.snapshots!.map((s) => s.takenAt);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("restores edges and snapshots from an imported report, dropping bad rows", async () => {
    const c = await importCase({
      name: "Restored",
      entities: [{ kind: "email", value: "a@x.com" }],
      edges: [
        { from: { kind: "email", value: "a@x.com" }, to: { kind: "domain", value: "x.com" }, reason: "kept", addedAt: 5 },
        { from: { kind: "email", value: "a@x.com" }, to: { kind: "email", value: "a@x.com" }, reason: "self" },
        "junk",
      ],
      snapshots: [
        { kind: "domain", value: "x.com", takenAt: 20, facts: { n: 2 } },
        { kind: "domain", value: "x.com", takenAt: 10, facts: { n: 1 } },
        { kind: "bogus", value: "x", takenAt: 1, facts: {} },
        { kind: "domain", value: "", takenAt: 1, facts: {} },
        null,
      ],
    });
    expect(c.edges).toHaveLength(1);
    expect(c.edges![0].addedAt).toBe(5);
    // Sorted chronologically — the diff engine depends on that order.
    expect(c.snapshots!.map((s) => s.takenAt)).toEqual([10, 20]);
  });

  it("omits the sections entirely when an import carries none", async () => {
    const c = await importCase({ name: "Bare", entities: [] });
    expect(c.edges).toBeUndefined();
    expect(c.snapshots).toBeUndefined();
  });

  it("defaults a missing addedAt/takenAt to import time", async () => {
    const before = Date.now();
    const c = await importCase({
      name: "NoTimes",
      edges: [{ from: { kind: "email", value: "a@x.com" }, to: { kind: "domain", value: "x.com" } }],
      snapshots: [{ kind: "domain", value: "x.com", facts: {} }],
    });
    expect(c.edges![0].addedAt).toBeGreaterThanOrEqual(before);
    expect(c.snapshots![0].takenAt).toBeGreaterThanOrEqual(before);
  });

  it("carries the fromCache flag through an import", async () => {
    const c = await importCase({
      name: "Cached",
      snapshots: [{ kind: "domain", value: "x.com", takenAt: 1, facts: {}, fromCache: true }],
    });
    expect(c.snapshots![0].fromCache).toBe(true);
  });
});

// ── HTTP surface ─────────────────────────────────────────────────────────────

describe("POST /api/cases: addEdges + snapshot", () => {
  it("accepts edges and returns the updated case", async () => {
    const c = (await (await post({ action: "create", name: "Http" })).json()).case as InvestigationCase;
    const res = await post({ action: "addEdges", id: c.id, edges: [edge("a@x.com", "x.com")] });
    expect(res.status).toBe(200);
    expect(((await res.json()).case as InvestigationCase).edges).toHaveLength(1);
  });

  it("rejects addEdges without an id or an edges array", async () => {
    expect((await post({ action: "addEdges", edges: [] })).status).toBe(400);
    expect((await post({ action: "addEdges", id: "x" })).status).toBe(400);
  });

  it("404s addEdges for an unknown case", async () => {
    expect((await post({ action: "addEdges", id: "nope", edges: [] })).status).toBe(404);
  });

  it("returns the diff alongside the case for a snapshot", async () => {
    const c = (await (await post({ action: "create", name: "Http" })).json()).case as InvestigationCase;
    await post({ action: "snapshot", id: c.id, kind: "domain", value: "a.com", facts: { n: 1 } });
    const res = await post({ action: "snapshot", id: c.id, kind: "domain", value: "a.com", facts: { n: 2 }, fromCache: true });
    const body = await res.json();
    expect(body.diff.changes).toEqual([{ fact: "n", from: 1, to: 2 }]);
    expect(body.diff.cacheInvolved).toBe(true);
  });

  it("rejects a snapshot with a missing field or a bad kind", async () => {
    expect((await post({ action: "snapshot", kind: "domain", value: "a.com" })).status).toBe(400);
    expect((await post({ action: "snapshot", id: "x", value: "a.com" })).status).toBe(400);
    expect((await post({ action: "snapshot", id: "x", kind: "bogus", value: "a.com" })).status).toBe(400);
  });

  it("404s a snapshot for an unknown case", async () => {
    expect((await post({ action: "snapshot", id: "nope", kind: "domain", value: "a.com", facts: {} })).status).toBe(404);
  });
});

// ── The optional lock ────────────────────────────────────────────────────────

describe("case lock (CASE_PASSWORD)", () => {
  it("is a complete no-op when unset", async () => {
    expect((await GET(getReq())).status).toBe(200);
    expect((await post({ action: "create", name: "Open" })).status).toBe(200);
  });

  it("reports itself already unlocked when the lock is disabled", async () => {
    const res = await post({ action: "unlock", password: "anything" });
    expect(await res.json()).toEqual({ ok: true, locked: false });
  });

  it("seals GET, POST and DELETE once configured", async () => {
    process.env.CASE_PASSWORD = "hunter2";
    const g = await GET(getReq());
    expect(g.status).toBe(401);
    expect((await g.json()).locked).toBe(true);
    expect((await post({ action: "create", name: "Nope" })).status).toBe(401);
    expect((await DELETE(new NextRequest("http://localhost/api/cases?all=1", { method: "DELETE" }))).status).toBe(401);
  });

  it("issues a cookie for the right password and rejects the wrong one", async () => {
    process.env.CASE_PASSWORD = "hunter2";
    expect((await post({ action: "unlock", password: "wrong" })).status).toBe(401);

    const ok = await post({ action: "unlock", password: "hunter2" });
    expect(ok.status).toBe(200);
    const cookie = ok.cookies.get(CASE_TOKEN_COOKIE);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
  });

  it("admits a request carrying a valid token", async () => {
    process.env.CASE_PASSWORD = "hunter2";
    const { token } = issueToken("hunter2");
    const header = `${CASE_TOKEN_COOKIE}=${token}`;
    expect((await GET(getReq(header))).status).toBe(200);
    expect((await post({ action: "create", name: "Unlocked" }, header)).status).toBe(200);
  });

  it("rejects a token minted under the previous password", async () => {
    const { token } = issueToken("old");
    process.env.CASE_PASSWORD = "new";
    expect((await GET(getReq(`${CASE_TOKEN_COOKIE}=${token}`))).status).toBe(401);
  });

  it("marks the unlock cookie Secure only when FORCE_HTTPS is set", async () => {
    process.env.CASE_PASSWORD = "hunter2";
    expect((await post({ action: "unlock", password: "hunter2" })).cookies.get(CASE_TOKEN_COOKIE)?.secure).toBe(false);
    process.env.FORCE_HTTPS = "1";
    expect((await post({ action: "unlock", password: "hunter2" })).cookies.get(CASE_TOKEN_COOKIE)?.secure).toBe(true);
    delete process.env.FORCE_HTTPS;
  });
});

describe("addEntity still works alongside the new sections", () => {
  it("keeps entities, edges and snapshots on the same case", async () => {
    const c = await createCase("All");
    await addEntity(c.id, "email", "a@x.com");
    await addEdges(c.id, [edge("a@x.com", "x.com")]);
    await recordSnapshot(c.id, "email", "a@x.com", { breaches: 1 }, false);
    const full = await getCase(c.id);
    expect(full!.entities).toHaveLength(1);
    expect(full!.edges).toHaveLength(1);
    expect(full!.snapshots).toHaveLength(1);
  });
});
