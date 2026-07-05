import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { POST } from "@/app/api/username-lookup/route";

// End-to-end handler test for the username sweep. The core data-quality rule is
// "no false positives": a nonexistent handle must yield 0 found, and the manual
// (bot-walled / SPA) sites must NEVER be auto-claimed as found even when the
// upstream returns HTTP 200. Upstreams are fully mocked.

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "hv-unameroute-"));
  process.env.HV_DATA_DIR = dir;
  process.env.TRUST_PROXY = "1";
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.HV_DATA_DIR;
  delete process.env.TRUST_PROXY;
});
afterEach(() => vi.unstubAllGlobals());

const mk = (status: number, jsonBody: unknown, text: string) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => jsonBody, text: async () => text }) as unknown as Response;

// Every non-GitHub site returns `siteStatus`; GitHub gets its own payload so the
// profile fetch doesn't accidentally look like a site probe.
function stubAllSites(siteStatus: number, githubFound: boolean) {
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
    const u = String(url);
    if (u.includes("api.github.com")) {
      return githubFound
        ? mk(200, { login: "u", id: 1, html_url: "https://github.com/u", name: "U", public_repos: 1, followers: 1, created_at: "2015-01-01T00:00:00Z" }, "")
        : mk(404, { message: "Not Found" }, "");
    }
    return mk(siteStatus, {}, "generic profile page with no absence marker");
  }));
}

let ipCounter = 0;
const post = (payload: unknown) => {
  const req = new Request("http://localhost/api/username-lookup", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `203.0.114.${++ipCounter}` },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
  return POST(req as unknown as NextRequest);
};

describe("POST /api/username-lookup — validation", () => {
  it("400 on malformed body", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid request body");
  });

  it("400 on an implausible username", async () => {
    const res = await post({ username: "a b!" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/username-lookup — no false positives", () => {
  it("a nonexistent handle (every site 404) yields 0 found", async () => {
    stubAllSites(404, false);
    const res = await post({ username: "definitelynotarealhandle999" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.found).toBe(0);
    expect(json.hits.filter((h: { status: string }) => h.status === "found")).toHaveLength(0);
    expect(json.checked).toBeGreaterThan(0);
  });

  it("manual (bot-walled) sites are never auto-claimed, even when upstream returns 200", async () => {
    stubAllSites(200, true);
    const res = await post({ username: "torvalds" });
    const json = await res.json();

    const manualHits = json.hits.filter((h: { status: string }) => h.status === "manual");
    expect(manualHits.length).toBeGreaterThan(0);          // catalog has bot-walled sites
    expect(json.manual).toBe(manualHits.length);
    // none of the manual sites leaked into found; found only counts real probes
    expect(json.found).toBe(json.checked);                 // every checkable site found
    expect(json.checked).toBe(json.hits.length - json.manual); // manual excluded from denominator
    expect(json.hits[0].status).toBe("found");             // sorted: confirmed first
    expect(json.username).toBe("torvalds");
  });

  it("strips a leading @ from the handle", async () => {
    stubAllSites(404, false);
    const json = await (await post({ username: "@torvalds" })).json();
    expect(json.username).toBe("torvalds");
  });
});
