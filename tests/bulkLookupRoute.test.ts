import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { POST } from "@/app/api/bulk-lookup/route";

// Bulk triage is fully offline (analyzePhoneNumber + cache only) — no upstreams
// to stub. TRUST_PROXY + unique client IP isolates the rate-limit bucket.

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "hv-bulkroute-"));
  process.env.HV_DATA_DIR = dir;
  process.env.TRUST_PROXY = "1";
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.HV_DATA_DIR;
  delete process.env.TRUST_PROXY;
});

let ipCounter = 0;
const post = (payload: unknown) => {
  const clientIp = `203.0.116.${++ipCounter}`;
  const req = new Request("http://localhost/api/bulk-lookup", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": clientIp },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
  return POST(req as unknown as NextRequest);
};

describe("POST /api/bulk-lookup — validation", () => {
  it("400 on a body without a numbers array", async () => {
    expect((await post({})).status).toBe(400);
  });

  it("400 on an empty numbers array", async () => {
    expect((await post({ numbers: [] })).status).toBe(400);
  });
});

describe("POST /api/bulk-lookup — offline triage rows", () => {
  it("returns a row per input, flagging valid, empty, and unparseable entries", async () => {
    const res = await post({ numbers: ["+14155552671", "   ", "garbage", "+442079460958"] });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.count).toBe(4);

    const [us, empty, bad, uk] = json.rows;

    // Valid US number → offline analysis, NPA-specific (Pacific) timezone
    expect(us.ok).toBe(true);
    expect(us.e164).toBe("+14155552671");
    expect(us.country).toBe("US");
    expect(us.npaState).toBe("California");
    expect(us.timezone).toBe("America/Los_Angeles");
    expect(us.utcOffset).toContain("UTC-8");
    expect(us.cached).toBe(false);
    expect(us.carrier).toBeNull(); // bulk never fans out to paid carrier APIs

    expect(empty.ok).toBe(false);
    expect(empty.error).toBe("Empty input");

    expect(bad.ok).toBe(false);
    expect(bad.error).toBe("Unparseable");

    expect(uk.ok).toBe(true);
    expect(uk.country).toBe("GB");

    expect(res.headers.get("X-RateLimit-Limit")).toBe("10");
  });
});

describe("POST /api/bulk-lookup — rate limiting", () => {
  it("429s the 11th request from one client IP", async () => {
    const req = () => new Request("http://localhost/api/bulk-lookup", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.99" },
      body: JSON.stringify({ numbers: ["+14155552671"] }),
    });
    let last = await POST(req() as unknown as NextRequest);
    for (let i = 0; i < 9; i++) last = await POST(req() as unknown as NextRequest);
    expect(last.status).toBe(200);
    expect((await POST(req() as unknown as NextRequest)).status).toBe(429);
  });
});
