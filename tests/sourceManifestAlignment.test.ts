import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { isHost } from "./urlMatch";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { POST as lookupPOST } from "@/app/api/lookup/route";
import { POST as emailPOST } from "@/app/api/email-lookup/route";
import { POST as usernamePOST } from "@/app/api/username-lookup/route";
import { POST as ipPOST } from "@/app/api/ip-lookup/route";
import { POST as domainPOST } from "@/app/api/domain-lookup/route";
import { SOURCES, SOURCES_BY_ID, sourcesForMode } from "@/lib/sources/manifest";
import { KEY_NAMES } from "@/lib/server/keyStore";
import { providerForKey, sourceForKey } from "@/lib/client/keyNames";
import { restoreRateLimit, resetServerState, SUITE_DATA_DIR } from "./testUtils";
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
  process.env.HV_DATA_DIR = SUITE_DATA_DIR;
});
afterEach(() => {
  vi.unstubAllGlobals();
  restoreRateLimit();
  resetServerState();
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
    if (isHost(s, "ip-api.com")) return resp(200, { status: "success", query: "93.184.219.1", countryCode: "US" });
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
      // A `standby` source is only called when its primary is unavailable, and
      // an `onDemand` one only when the analyst starts it, so a healthy run
      // genuinely does not report either. Everything else must appear.
      for (const s of sourcesForMode(mode).filter((s) => !s.standby && !s.onDemand)) {
        expect(reported.has(s.id), `manifest declares "${s.id}" for ${mode} but the route never reports it`).toBe(true);
      }
    });
  }

  it("a standby source really is reached when its primary fails", async () => {
    // `standby` exempts a source from the "must be reported" check above, so
    // without this it would be a one-word way to declare a source that is never
    // called at all. Every standby has to prove it wakes up.
    const standbys = SOURCES.filter((s) => s.standby);
    expect(standbys.length).toBeGreaterThan(0);

    // Fail the preferred geo provider; everything else answers normally.
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL) => {
      const s = String(u);
      if (isHost(s, "ip-api.com")) return resp(500, {});
      if (isHost(s, "ipwho.is")) return resp(200, { success: true, country: "Norway", country_code: "NO" });
      return resp(200, {});
    }));
    const json = (await (await post(ipPOST, "http://localhost/api/ip-lookup", { ip: "93.184.219.2" })).json()) as {
      sourceHealth: Array<{ source: string; ok: boolean }>;
    };
    const reported = new Set(json.sourceHealth.map((h) => h.source));
    for (const s of standbys) {
      expect(reported.has(s.id), `"${s.id}" is declared standby but is never reached`).toBe(true);
    }
  });

  it("an on-demand source really is reached by the endpoint that owns it", async () => {
    // Same discipline as the standby guard: `onDemand` exempts a source from
    // the "must be reported" check, so it must prove that something reaches it.
    const onDemand = SOURCES.filter((s) => s.onDemand);
    expect(onDemand.length).toBeGreaterThan(0);

    vi.stubGlobal("fetch", vi.fn(async () => resp(404, {})));
    const { POST: sweepPOST } = await import("@/app/api/username-sweep/route");
    const json = (await (await post(sweepPOST, "http://localhost/api/username-sweep", {
      username: "torvalds", limit: 1,
    })).json()) as { sourceHealth: Array<{ source: string }> };
    const reported = new Set(json.sourceHealth.map((h) => h.source));
    for (const s of onDemand) {
      expect(reported.has(s.id), `"${s.id}" is declared on-demand but nothing reaches it`).toBe(true);
    }
  });

  it("covers every lookup mode declared in the manifest", () => {
    const modesInManifest = new Set(sourcesForMode("phone").concat(
      sourcesForMode("email"), sourcesForMode("username"), sourcesForMode("ip"), sourcesForMode("domain"),
    ).flatMap((s) => s.modes));
    // Workflow modes (bulk/graph/cases) have no upstreams, so they declare none.
    expect([...modesInManifest].sort()).toEqual(["domain", "email", "ip", "phone", "username"]);
  });
});

// Settings lists every name the key store accepts and labels each one from the
// manifest. A key the store allows but the manifest never describes falls back
// to the env-var spelling, so it would appear in the pane as "Hibp" rather than
// "Have I Been Pwned". Nothing else catches that: the pane still renders.
describe("every key the store accepts has a name to show", () => {
  it("describes each OSINT key in the manifest", () => {
    const orphans = KEY_NAMES
      .filter((n) => providerForKey(n) === null)
      .filter((n) => sourceForKey(n) === null);
    expect(orphans).toEqual([]);
  });

  it("accounts for every allow-listed key as either a provider's or a source's", () => {
    for (const name of KEY_NAMES) {
      expect(providerForKey(name) !== null || sourceForKey(name) !== null).toBe(true);
    }
  });
});
