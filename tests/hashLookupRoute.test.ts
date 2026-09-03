import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { POST } from "@/app/api/hash-lookup/route";
import { restoreRateLimit, resetServerState, useRateLimit, clientCookie } from "./testUtils";

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "hv-hash-")); process.env.HV_DATA_DIR = dir; process.env.TRUST_PROXY = "1"; });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.HV_DATA_DIR; delete process.env.TRUST_PROXY; });
afterEach(() => { vi.unstubAllGlobals(); restoreRateLimit(); resetServerState(); });

const resp = (status: number, body: unknown, ok = status >= 200 && status < 300) =>
  ({ ok, status, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response;

let ipCounter = 0;
const post = (payload: unknown) => {
  const req = new Request("http://localhost/api/hash-lookup", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `203.0.115.${++ipCounter}` },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
  return POST(req as unknown as NextRequest);
};

const MD5 = "8ed4b4ed952526d89899e723f3488de4";

describe("POST /api/hash-lookup", () => {
  it("400 on a malformed body", async () => {
    expect((await post({})).status).toBe(400);
  });

  it("400 on a value that is not a hash", async () => {
    const res = await post({ hash: "not-a-hash" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Not a recognised MD5, SHA-1 or SHA-256 hash");
  });

  it("reads known-software reputation from CIRCL hashlookup", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      expect(String(url)).toContain("/lookup/md5/");
      return resp(200, { FileName: "kernel32.dll", source: "NSRL", "hashlookup:trust": 50, MD5: MD5.toUpperCase() });
    }));
    const j = await (await post({ hash: MD5.toUpperCase() })).json();
    expect(j.kind).toBe("md5");
    expect(j.input).toBe(MD5); // lower-cased
    expect(j.facts.known).toBe(true);
    expect(j.facts.source).toBe("NSRL");
    expect(j.pivots.some((p: { label: string }) => p.label === "VirusTotal")).toBe(true);
    expect(j.sourceHealth[0]).toMatchObject({ source: "circl-hashlookup", ok: true });
  });

  it("treats a 404 as a valid negative: source answered, hash simply unknown", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resp(404, { message: "Non existing MD5" }, false)));
    const j = await (await post({ hash: MD5 })).json();
    expect(j.facts.known).toBe(false);
    expect(j.error).toBeUndefined();               // not an outage
    expect(j.sourceHealth[0].ok).toBe(true);       // the source did answer
  });

  it("returns an honest error when hashlookup is unreachable, surfacing the fetch error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resp(0, null, false)));
    const j = await (await post({ hash: MD5 })).json();
    expect(j.facts).toBeNull();
    expect(j.error).toBeTruthy();
    expect(j.sourceHealth[0].ok).toBe(false);
    expect(j.sourceHealth[0].error).toBeTruthy();  // the fetch layer's own error string
    expect(j.pivots.length).toBeGreaterThan(0);    // pivots still offered
  });

  it("falls back to a generic error when a 200 body is unparseable (no fetch error)", async () => {
    // A 200 whose body is not an object → facts null but no fetch-layer error, so
    // the route supplies its own message rather than leaving it blank.
    vi.stubGlobal("fetch", vi.fn(async () => resp(200, "not-an-object")));
    const j = await (await post({ hash: MD5 })).json();
    expect(j.facts).toBeNull();
    expect(j.sourceHealth[0].ok).toBe(false);
    expect(j.sourceHealth[0].error).toBe("hashlookup unreachable"); // route fallback
  });

  it("rate-limits a client once its budget is spent", async () => {
    useRateLimit(1);
    vi.stubGlobal("fetch", vi.fn(async () => resp(404, { message: "Non existing MD5" }, false)));
    const req = () => new Request("http://localhost/api/hash-lookup", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: clientCookie("hl") },
      body: JSON.stringify({ hash: MD5 }),
    });
    expect((await POST(req() as unknown as NextRequest)).status).toBe(200);
    expect((await POST(req() as unknown as NextRequest)).status).toBe(429);
  });
});
