import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import {
  captureEvidence, listEvidence, readEvidence, verifyCase, dropCaseEvidence, dropAllEvidence,
  sha256, MAX_EVIDENCE_ENTRIES,
} from "@/lib/server/evidenceStore";
import { GET, POST } from "@/app/api/evidence/route";
import { changeWebhookUrl, notifyChange } from "@/lib/server/changeNotify";
import { SUITE_DATA_DIR } from "./testUtils";

// A finding nobody can re-check is a finding that does not survive being
// challenged: upstreams change, and a re-run six months later answers a
// different question. The locker writes the response that was actually acted
// on, hashes it, and can prove later that the bytes have not moved.

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hv-evidence-"));
  process.env.HV_DATA_DIR = dir;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  process.env.HV_DATA_DIR = SUITE_DATA_DIR;
  delete process.env.CASE_PASSWORD;
  delete process.env.CHANGE_WEBHOOK_URL;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
afterAll(() => { process.env.HV_DATA_DIR = SUITE_DATA_DIR; });

const payload = (over: Record<string, unknown> = {}) => ({
  domain: "wordpress.org",
  subdomains: ["a.wordpress.org"],
  sourceHealth: [
    { source: "dns", ok: true, ms: 12, fetchedAt: 1 },
    { source: "whois", ok: false, ms: 3, fetchedAt: 2 },
  ],
  ...over,
});

describe("captureEvidence", () => {
  it("stores the bytes, hashes them, and records what answered", async () => {
    const out = await captureEvidence({
      caseId: "case-1", mode: "domain", identifier: "wordpress.org", payload: payload(), note: "why it matters",
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.duplicate).toBe(false);
    expect(out.entry.sha256).toBe(sha256(JSON.stringify(payload(), null, 2)));
    expect(out.entry.id).toBe(out.entry.sha256.slice(0, 32));
    expect(out.entry.sources).toEqual([
      { source: "dns", ok: true, ms: 12, fetchedAt: 1 },
      { source: "whois", ok: false, ms: 3, fetchedAt: 2 },
    ]);
    expect(out.entry.note).toBe("why it matters");

    // The stored file is byte-identical to what was hashed, so a caller can
    // recompute the digest themselves.
    const stored = await readEvidence("case-1", out.entry.id);
    expect(sha256(stored as string)).toBe(out.entry.sha256);
  });

  it("treats the same bytes as the same evidence rather than storing them twice", async () => {
    const first = await captureEvidence({ caseId: "c", mode: "ip", identifier: "1.1.1.1", payload: payload() });
    const second = await captureEvidence({ caseId: "c", mode: "ip", identifier: "1.1.1.1", payload: payload() });
    expect(second.ok && second.duplicate).toBe(true);
    expect(await listEvidence("c")).toHaveLength(1);
    expect(first.ok && second.ok && first.entry.id).toBe(second.ok ? second.entry.id : "");
  });

  it("refuses an artifact larger than the store's limit", async () => {
    const out = await captureEvidence({
      caseId: "c", mode: "domain", identifier: "big", payload: { blob: "x".repeat(4_100_000) },
    });
    expect(out).toEqual({ ok: false, error: "artifact is larger than the evidence-store limit" });
  });

  it("stops at the per-case ceiling", async () => {
    for (let i = 0; i < MAX_EVIDENCE_ENTRIES; i++) {
      await captureEvidence({ caseId: "c", mode: "ip", identifier: `1.1.1.${i}`, payload: { n: i } });
    }
    const out = await captureEvidence({ caseId: "c", mode: "ip", identifier: "one too many", payload: { n: -1 } });
    expect(out.ok).toBe(false);
  });

  it("defends the case id against traversal instead of sanitising it", async () => {
    await expect(captureEvidence({ caseId: "../escape", mode: "ip", identifier: "x", payload: {} }))
      .rejects.toThrow("invalid id");
  });

  it("copes with a payload that carries no source health", async () => {
    const out = await captureEvidence({ caseId: "c", mode: "hash", identifier: "abc", payload: { sourceHealth: "nope" } });
    expect(out.ok && out.entry.sources).toEqual([]);
  });
});

describe("verifyCase", () => {
  it("confirms untouched artifacts, and names the ones that moved", async () => {
    const a = await captureEvidence({ caseId: "c", mode: "domain", identifier: "a", payload: payload() });
    const b = await captureEvidence({ caseId: "c", mode: "domain", identifier: "b", payload: payload({ domain: "b.test" }) });
    expect((await verifyCase("c")).every((v) => v.state === "ok")).toBe(true);

    // Someone edits a stored artifact…
    if (!a.ok) return;
    writeFileSync(join(dir, "evidence", "c", `${a.entry.id}.json`), "{\"tampered\":true}");
    // …and another is deleted outright.
    if (!b.ok) return;
    rmSync(join(dir, "evidence", "c", `${b.entry.id}.json`));

    const checks = await verifyCase("c");
    expect(checks.find((v) => v.id === a.entry.id)!.state).toBe("modified");
    expect(checks.find((v) => v.id === b.entry.id)!.state).toBe("missing");
    expect(checks.find((v) => v.id === b.entry.id)!.actual).toBeNull();
  });

  it("reports an empty locker as empty", async () => {
    expect(await verifyCase("never-used")).toEqual([]);
    expect(await listEvidence("never-used")).toEqual([]);
    expect(await readEvidence("never-used", "abc")).toBeNull();
  });
});

describe("dropping a locker", () => {
  it("removes one case's artifacts, and all of them on a wipe", async () => {
    await captureEvidence({ caseId: "c1", mode: "ip", identifier: "a", payload: { a: 1 } });
    await captureEvidence({ caseId: "c2", mode: "ip", identifier: "b", payload: { b: 2 } });
    await dropCaseEvidence("c1");
    expect(await listEvidence("c1")).toEqual([]);
    expect(await listEvidence("c2")).toHaveLength(1);
    await dropAllEvidence();
    expect(readdirSync(dir)).not.toContain("evidence");
  });
});

// ── the HTTP surface ─────────────────────────────────────────────────────────

const get = (query: string, cookie?: string) =>
  GET(new Request(`http://localhost/api/evidence${query}`, {
    headers: cookie ? { cookie } : {},
  }) as unknown as NextRequest);

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/evidence", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest);

describe("/api/evidence", () => {
  it("captures, lists, serves and verifies", async () => {
    const captured = await post({ action: "capture", caseId: "web", mode: "domain", identifier: "wordpress.org", payload: payload() });
    expect(captured.status).toBe(200);
    const { entry } = await captured.json();

    const manifest = await get("?caseId=web");
    expect((await manifest.json()).entries).toHaveLength(1);

    const artifact = await get(`?caseId=web&id=${entry.id}`);
    expect(artifact.headers.get("content-type")).toContain("application/json");
    expect(sha256(await artifact.text())).toBe(entry.sha256);

    const verified = await post({ action: "verify", caseId: "web" });
    const body = await verified.json();
    expect(body.ok).toBe(true);
    expect(body.checks[0].state).toBe("ok");
  });

  it("rejects a bad case id, a bad artifact id and a missing artifact", async () => {
    expect((await get("?caseId=../etc")).status).toBe(400);
    expect((await get("?caseId=web&id=../etc")).status).toBe(400);
    expect((await get("?caseId=web&id=deadbeef")).status).toBe(404);
  });

  it("refuses an oversized artifact with 413", async () => {
    const res = await post({ action: "capture", caseId: "web", payload: { blob: "x".repeat(4_100_000) } });
    expect(res.status).toBe(413);
  });

  it("is behind the same lock as the case store", async () => {
    process.env.CASE_PASSWORD = "secret";
    expect((await get("?caseId=web")).status).toBe(401);
    expect((await post({ action: "verify", caseId: "web" })).status).toBe(401);
  });
});

// ── the optional webhook ─────────────────────────────────────────────────────

describe("changeNotify", () => {
  const change = {
    caseId: "c", caseName: "Case", kind: "domain" as const, value: "a.test",
    takenAt: 1, changes: [{ fact: "subdomains", from: 3, to: 9 }], cacheInvolved: false,
  };

  it("is off unless configured, and refuses a URL that points inward", () => {
    expect(changeWebhookUrl()).toBeNull();
    process.env.CHANGE_WEBHOOK_URL = "   ";
    expect(changeWebhookUrl()).toBeNull();
    process.env.CHANGE_WEBHOOK_URL = "http://hooks.test/x";     // not https
    expect(changeWebhookUrl()).toBeNull();
    process.env.CHANGE_WEBHOOK_URL = "https://127.0.0.1/x";     // inward
    expect(changeWebhookUrl()).toBeNull();
    process.env.CHANGE_WEBHOOK_URL = "not a url";
    expect(changeWebhookUrl()).toBeNull();
    process.env.CHANGE_WEBHOOK_URL = "https://hooks.test/x";
    expect(changeWebhookUrl()).toBe("https://hooks.test/x");
  });

  it("posts the diff when configured, and never throws when the hook is down", async () => {
    process.env.CHANGE_WEBHOOK_URL = "https://hooks.test/x";
    const fetchSpy = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async () => ({ ok: true, status: 200 }) as Response,
    );
    vi.stubGlobal("fetch", fetchSpy);
    expect(await notifyChange(change)).toBe(true);
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.event).toBe("case.change");
    expect(body.changes[0].fact).toBe("subdomains");

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    expect(await notifyChange(change)).toBe(false);
  });

  it("sends nothing when there is nothing to say, or nowhere to say it", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await notifyChange(change)).toBe(false);                       // not configured
    process.env.CHANGE_WEBHOOK_URL = "https://hooks.test/x";
    expect(await notifyChange({ ...change, changes: [] })).toBe(false);   // nothing changed
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── Payload shape limits ────────────────────────────────────────────────────
// `JSON.stringify(v, null, 2)` pays indentation per line, so its output grows
// with nesting depth: a body that fits the route's 4 MB ceiling serialised to
// 436 MB at depth 100, and past depth ~500 it exceeded V8's maximum string
// length and threw a RangeError — a 500 where a 413 was intended. The shape is
// bounded before anything is serialised.
describe("captureEvidence: payload shape", () => {
  /** n nested arrays around one value. */
  const nest = (n: number): unknown => {
    let v: unknown = 1;
    for (let i = 0; i < n; i++) v = [v];
    return v;
  };

  it("refuses a payload nested past the depth cap, without serialising it", async () => {
    const res = await captureEvidence({
      caseId: "deep", mode: "domain", identifier: "x", payload: nest(5000),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("nested deeper than");
  });

  it("refuses a payload with more values than the node cap", async () => {
    // Flat and shallow: it is the COUNT that has to be refused here, not depth.
    const res = await captureEvidence({
      caseId: "wide", mode: "domain", identifier: "x",
      payload: new Array(600_000).fill(0),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("more than");
  });

  it("still accepts a payload far richer than a real lookup response", async () => {
    // A measured email lookup is depth 6 with ~21,600 nodes; this is deeper and
    // denser than that and must not be refused.
    const rows = Array.from({ length: 2000 }, (_, i) => ({
      source: `s${i}`, nested: { a: { b: { c: [i, i + 1] } } },
    }));
    const res = await captureEvidence({
      caseId: "rich", mode: "domain", identifier: "x", payload: { rows },
    });
    expect(res.ok).toBe(true);
  });

  it("measures the size cap in bytes, not UTF-16 units", async () => {
    // Each astral character is 2 UTF-16 units but 4 bytes, so a payload can sit
    // under a character-counted cap and still be several times the byte cap.
    const big = "𝄞".repeat(1_100_000); // 2.2M units, 4.4MB
    const res = await captureEvidence({
      caseId: "bytes", mode: "domain", identifier: "x", payload: { big },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("larger than");
  });
});
