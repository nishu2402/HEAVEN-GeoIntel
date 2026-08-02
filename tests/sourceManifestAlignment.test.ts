import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { POST as lookupPOST } from "@/app/api/lookup/route";
import { POST as emailPOST } from "@/app/api/email-lookup/route";
import { POST as usernamePOST } from "@/app/api/username-lookup/route";
import { POST as ipPOST } from "@/app/api/ip-lookup/route";
import { POST as domainPOST } from "@/app/api/domain-lookup/route";
import { SOURCES_BY_ID, sourcesForMode } from "@/lib/sources/manifest";
import { restoreRateLimit } from "./testUtils";
import type { Mode } from "@/lib/client/modes";

// The manifest is only useful if the ids in it are the SAME ids the routes
// report at runtime. When they drifted, /api/sources showed a source as
// "never called" moments after it had answered — the exact class of silent
// staleness the manifest exists to prevent. This test drives every lookup mode
// and asserts the reported ids resolve against the manifest, both ways.

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "hv-alignment-"));
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

const post = (h: (r: NextRequest) => Promise<Response>, url: string, body: unknown) =>
  h(new Request(url, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }) as unknown as NextRequest);

const MODES: Array<[Mode, (r: NextRequest) => Promise<Response>, string, unknown]> = [
  ["phone", lookupPOST, "/api/lookup", { number: "+14155552671" }],
  ["email", emailPOST, "/api/email-lookup", { email: "align@example.test" }],
  ["username", usernamePOST, "/api/username-lookup", { username: "alignuser" }],
  ["ip", ipPOST, "/api/ip-lookup", { ip: "93.184.219.1" }],
  ["domain", domainPOST, "/api/domain-lookup", { domain: "align.test" }],
];

async function healthFor(handler: (r: NextRequest) => Promise<Response>, path: string, body: unknown) {
  // Answer everything with a benign 200 so each mode reaches its full fanout.
  vi.stubGlobal("fetch", vi.fn(async (u: string | URL) => {
    const s = String(u);
    if (s.includes("ip-api.com")) return resp(200, { status: "success", query: "93.184.219.1", countryCode: "US" });
    return resp(200, {});
  }));
  const json = (await (await post(handler, "http://localhost" + path, body)).json()) as {
    sourceHealth?: Array<{ source: string }>;
  };
  return (json.sourceHealth ?? []).map((h) => h.source);
}

describe("route source ids match the manifest", () => {
  for (const [mode, handler, path, body] of MODES) {
    it(`${mode}: every reported source id exists in the manifest`, async () => {
      const reported = await healthFor(handler, path, body);
      expect(reported.length).toBeGreaterThan(0);
      for (const id of reported) {
        expect(SOURCES_BY_ID.has(id), `route reported unknown source id "${id}"`).toBe(true);
      }
    });

    it(`${mode}: the manifest declares every source the route reports`, async () => {
      const reported = new Set(await healthFor(handler, path, body));
      const declared = new Set(sourcesForMode(mode).map((s) => s.id));
      for (const id of reported) {
        expect(declared.has(id), `"${id}" is reported by ${mode} but not declared for that mode`).toBe(true);
      }
    });

    it(`${mode}: every source the manifest declares is actually reported`, async () => {
      const reported = new Set(await healthFor(handler, path, body));
      for (const s of sourcesForMode(mode)) {
        expect(reported.has(s.id), `manifest declares "${s.id}" for ${mode} but the route never reports it`).toBe(true);
      }
    });
  }

  it("covers every lookup mode declared in the manifest", () => {
    const modesInManifest = new Set(sourcesForMode("phone").concat(
      sourcesForMode("email"), sourcesForMode("username"), sourcesForMode("ip"), sourcesForMode("domain"),
    ).flatMap((s) => s.modes));
    // Workflow modes (bulk/graph/cases) have no upstreams, so they declare none.
    expect([...modesInManifest].sort()).toEqual(["domain", "email", "ip", "phone", "username"]);
  });
});
