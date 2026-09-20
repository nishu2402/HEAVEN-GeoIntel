import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/ai-analyst/route";
import { readAudit, clearAudit } from "@/lib/server/auditLog";
import { restoreRateLimit, resetServerState, useRateLimit, clientCookie, SUITE_DATA_DIR } from "./testUtils";

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "hv-analyst-")); process.env.HV_DATA_DIR = dir; });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); process.env.HV_DATA_DIR = SUITE_DATA_DIR; });
afterEach(() => { vi.unstubAllGlobals(); restoreRateLimit(); resetServerState(); delete process.env.OPENAI_API_KEY; });

const jsonResp = (status: number, data: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => data }) as Response;

let n = 0;
const post = (payload: unknown, cookie = `client${++n}`) => {
  const req = new Request("http://localhost/api/ai-analyst", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: clientCookie(cookie) },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
  return POST(req as unknown as NextRequest);
};

const validBody = { provider: "ollama", model: "llama3.2", system: "S", user: "U" };

// The readiness report and the model list share one GET, so the query string is
// what picks between them.
const get = (query = "") => GET(new NextRequest(`http://localhost/api/ai-analyst${query}`));

describe("POST /api/ai-analyst", () => {
  it("400 on a malformed body", async () => {
    expect((await post({ provider: "bad", model: "x", system: "s", user: "u" })).status).toBe(400);
  });

  it("200 with the model text on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp(200, { message: { content: "grounded read" } })));
    const res = await post(validBody);
    expect(res.status).toBe(200);
    expect((await res.json()).text).toBe("grounded read");
  });

  it("502 with the relay's error when the provider is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    const res = await post(validBody);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/Could not reach Ollama/);
  });

  // A 502 says "this gateway is broken". A key the operator typed wrong is not
  // that, and reporting it as one puts a red server error in their console for
  // a mistake they can fix in the panel.
  it("400, not 502, when the provider rejects the key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp(401, { error: "invalid key" })));
    const res = await post({ provider: "openai", model: "gpt-4o-mini", system: "S", user: "U", apiKey: "sk-wrong" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/rejected that API key/);
  });

  it("400, not 502, when Ollama does not have the model", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp(404, { error: "model not found" })));
    const res = await post(validBody);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/does not have the model/);
  });

  it("400, not 502, when no key is configured at all", async () => {
    // Nothing is contacted in this path, so there is no gateway to blame.
    const res = await post({ provider: "openai", model: "gpt-4o-mini", system: "S", user: "U" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/No API key for OpenAI/);
  });

  it("passes the provider's own 429 through so a caller can back off", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp(429, { error: "slow down" })));
    const res = await post({ provider: "groq", model: "m", system: "S", user: "U", apiKey: "k" });
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/rate-limiting/);
  });

  it("502 when the provider answers with an empty completion", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp(200, { message: { content: "   " } })));
    const res = await post(validBody);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/empty response/);
  });

  it("forwards a browser-supplied cloud key so no server env var is needed", async () => {
    const seen: (string | null)[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string | URL, init: RequestInit) => {
      seen.push(new Headers(init.headers).get("authorization"));
      return jsonResp(200, { choices: [{ message: { content: "cloud read" } }] });
    }));
    const res = await post({ provider: "openai", model: "gpt-4o-mini", system: "S", user: "U", apiKey: "sk-body" });
    expect(res.status).toBe(200);
    expect((await res.json()).text).toBe("cloud read");
    expect(seen[0]).toBe("Bearer sk-body");
  });

  it("400 when apiKey is the wrong type", async () => {
    expect((await post({ ...validBody, apiKey: 123 })).status).toBe(400);
  });

  it("429 once a client exhausts its rate-limit budget", async () => {
    useRateLimit(1);
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp(200, { message: { content: "ok" } })));
    expect((await post(validBody, "same")).status).toBe(200);
    expect((await post(validBody, "same")).status).toBe(429);
  });
});

describe("audit trail", () => {
  // The log is written fire-and-forget, so wait for the entry rather than
  // racing it.
  //
  // `since` is what keeps these tests independent of the block above, which
  // posts a dozen times and never waits for any of those writes to land. One
  // of them finishing after this block's `clearAudit` would otherwise be read
  // here as this test's own entry, carrying that test's status instead. The
  // timestamp is stamped when the entry is BUILT, so a write delayed past the
  // clear still carries its original, older `ts` and is filtered out.
  const lastEntry = async (since: number) => {
    for (let i = 0; i < 50; i++) {
      const entries = await readAudit();
      const hit = entries
        .filter((e) => e.kind === "ai-analyst" && Date.parse(e.ts) >= since)
        .pop();
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("no ai-analyst audit entry was written");
  };

  beforeEach(async () => { await clearAudit(); });

  it("records the provider and a 200 for a run that succeeded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp(200, { message: { content: "ok" } })));
    const since = Date.now();
    await post(validBody);
    expect(await lastEntry(since)).toMatchObject({ kind: "ai-analyst", status: 200 });
  });

  // It used to log 200 before the run even started, so every failure was
  // recorded as a success. An audit log that lies is worse than none.
  it("records the status the run actually returned, not an optimistic 200", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    const since = Date.now();
    await post(validBody);
    expect(await lastEntry(since)).toMatchObject({ status: 502 });
  });

  it("records a 400 for a key the provider rejected", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp(401, {})));
    const since = Date.now();
    await post({ provider: "openai", model: "m", system: "S", user: "U", apiKey: "bad" });
    expect(await lastEntry(since)).toMatchObject({ status: 400 });
  });

  it("never writes the prompt or the key into the log", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp(200, { choices: [{ message: { content: "ok" } }] })));
    const since = Date.now();
    await post({ provider: "openai", model: "m", system: "SECRET-SYSTEM", user: "SECRET-USER", apiKey: "sk-secret" });
    const entry = await lastEntry(since);
    const raw = JSON.stringify(entry);
    expect(raw).not.toMatch(/SECRET-SYSTEM|SECRET-USER|sk-secret/);
    // The prompt names the subject and the key is the operator's credential, so
    // neither is passed to the log at all. What is passed is the provider name,
    // and the log salts and hashes every target it is given, so even that is
    // not readable back out.
    expect(entry.target).toMatch(/^sha256:[0-9a-f]{24}$/);
  });
});

describe("GET /api/ai-analyst", () => {
  it("reports every provider, local first, with what it would need", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp(200, { models: [{ name: "llama3:latest" }] })));
    const res = await get();
    expect(res.status).toBe(200);
    // A readiness report is about the machine right now; a cached copy would
    // say a provider is missing after it has been set up.
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
    const json = await res.json();
    expect(json.providers[0]).toMatchObject({ id: "ollama", ready: true, models: ["llama3:latest"] });
    expect(json.recommended).toBe("ollama");
    expect(json.ollamaRunning).toBe(true);
  });

  it("lists the models a provider's key may call", async () => {
    process.env.GEMINI_API_KEY = "g-test";
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp(200, {
      models: [{ name: "models/gemini-3.6-flash", supportedGenerationMethods: ["generateContent"] }],
    })));
    const res = await get("?models=gemini");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
    expect((await res.json()).models).toEqual(["gemini-3.6-flash"]);
    delete process.env.GEMINI_API_KEY;
  });

  it("rejects a provider it does not relay to, Ollama included", async () => {
    // Ollama's models come from the readiness probe, off the machine rather
    // than off a key, so there is nothing to list here.
    for (const q of ["?models=ollama", "?models=notaprovider", "?models="]) {
      const res = await get(q);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/Unknown provider/);
    }
  });

  it("recommends nothing when the machine has nothing set up", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const json = await (await get()).json();
    expect(json.recommended).toBeNull();
    expect(json.providers.every((p: { ready: boolean }) => !p.ready)).toBe(true);
  });
});
