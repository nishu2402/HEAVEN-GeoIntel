import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { POST } from "@/app/api/pwned-password/route";
import { restoreRateLimit, resetServerState, useRateLimit, clientCookie } from "./testUtils";

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "hv-pwned-")); process.env.HV_DATA_DIR = dir; process.env.TRUST_PROXY = "1"; });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.HV_DATA_DIR; delete process.env.TRUST_PROXY; });
afterEach(() => { vi.unstubAllGlobals(); restoreRateLimit(); resetServerState(); });

const textResp = (status: number, text: string) =>
  ({ ok: status >= 200 && status < 300, status, text: async () => text }) as Response;

let ipCounter = 0;
const post = (payload: unknown) => {
  const req = new Request("http://localhost/api/pwned-password", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `203.0.116.${++ipCounter}` },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
  return POST(req as unknown as NextRequest);
};

describe("POST /api/pwned-password", () => {
  it("400 on a body that is not valid JSON", async () => {
    expect((await post("{not json")).status).toBe(400);
  });

  it("400 on a prefix that is not five hex characters", async () => {
    const res = await post({ prefix: "password" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/five hex/);
  });

  it("relays only the prefix and returns the raw range", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL) => {
      calls.push(String(u));
      return textResp(200, "1E4C9B93F3F0682250B6CF8331B7EE68FD8:99\r\n");
    }));
    const res = await post({ prefix: "5baa6" });
    expect(res.status).toBe(200);
    expect((await res.json()).range).toContain(":99");
    // The upstream saw the upper-cased prefix and nothing password-shaped.
    expect(calls[0]).toBe("https://api.pwnedpasswords.com/range/5BAA6");
  });

  it("502 with a rate-limit message when the endpoint is throttling", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => textResp(429, "")));
    const res = await post({ prefix: "5BAA6" });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/rate-limiting/);
  });

  it("502 with a generic message when the endpoint is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    const res = await post({ prefix: "5BAA6" });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/unreachable/);
  });

  it("rate-limits a client once its budget is spent", async () => {
    useRateLimit(1);
    vi.stubGlobal("fetch", vi.fn(async () => textResp(200, "")));
    const req = () => new Request("http://localhost/api/pwned-password", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: clientCookie("pp") },
      body: JSON.stringify({ prefix: "5BAA6" }),
    });
    expect((await POST(req() as unknown as NextRequest)).status).toBe(200);
    expect((await POST(req() as unknown as NextRequest)).status).toBe(429);
  });
});
