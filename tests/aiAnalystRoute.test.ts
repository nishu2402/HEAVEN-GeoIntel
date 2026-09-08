import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { POST } from "@/app/api/ai-analyst/route";
import { restoreRateLimit, resetServerState, useRateLimit, clientCookie } from "./testUtils";

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "hv-analyst-")); process.env.HV_DATA_DIR = dir; });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.HV_DATA_DIR; });
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

  it("502 with the relay's error when the provider fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    const res = await post(validBody);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/Could not reach Ollama/);
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
