import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { GET, POST, DELETE } from "@/app/api/keys/route";
import { clearAllKeys, KEY_NAMES } from "@/lib/server/keyStore";

// The key endpoint manages optional provider secrets. The critical invariant:
// it NEVER returns a stored value — only a configured/source map. Runs against a
// hermetic HV_DATA_DIR so nothing touches the real .data/keys.json.

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "hv-keysroute-"));
  process.env.HV_DATA_DIR = dir;
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.HV_DATA_DIR;
});
beforeEach(async () => { await clearAllKeys(); });

const postReq = (body: unknown) =>
  POST(new Request("http://localhost/api/keys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as unknown as NextRequest);

const delReq = (qs: string) =>
  DELETE(new NextRequest(`http://localhost/api/keys${qs}`, { method: "DELETE" }));

describe("GET /api/keys", () => {
  it("lists the allow-listed names with all sources null when nothing is set", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.names).toEqual([...KEY_NAMES]);
    expect(Object.values(json.keys).every((v) => v === null)).toBe(true);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("POST /api/keys: set", () => {
  it("stores a valid key and reports it as configured via UI: never echoing the value", async () => {
    const res = await postReq({ name: "IPQS_API_KEY", value: "super-secret-123" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.keys.IPQS_API_KEY).toBe("ui");
    // The secret value must not appear anywhere in the response.
    expect(JSON.stringify(json)).not.toContain("super-secret-123");
  });

  it("400 on invalid JSON", async () => {
    const res = await postReq("{ nope");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid JSON body");
  });

  it("400 when name/value are not both strings", async () => {
    const res = await postReq({ name: "IPQS_API_KEY" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Expected { name, value }");
  });

  it("400 on a name outside the allow-list", async () => {
    const res = await postReq({ name: "EVIL_KEY", value: "x" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Unknown key name or empty value");
  });
});

describe("DELETE /api/keys", () => {
  it("clears a single key by name", async () => {
    await postReq({ name: "HUNTER_API_KEY", value: "abc" });
    const res = await delReq("?name=HUNTER_API_KEY");
    expect(res.status).toBe(200);
    expect((await res.json()).keys.HUNTER_API_KEY).toBeNull();
  });

  it("400 when no name or all param is provided", async () => {
    const res = await delReq("");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Missing ?name= or ?all=1");
  });

  it("400 on an unknown key name", async () => {
    const res = await delReq("?name=EVIL_KEY");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Unknown key name");
  });

  it("clears every key on ?all=1", async () => {
    await postReq({ name: "IPQS_API_KEY", value: "a" });
    await postReq({ name: "HUNTER_API_KEY", value: "b" });
    const res = await delReq("?all=1");
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(Object.values(json.keys).every((v) => v === null)).toBe(true);
  });
});
