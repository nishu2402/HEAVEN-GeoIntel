import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { POST, GET, DELETE, prepareRows } from "@/app/api/bulk-lookup/route";
import { startJob, getJob, cancelJob, jobCsv, resetJobs, MAX_BULK_ROWS, type BulkMode } from "@/lib/server/bulkJobs";
import { useRateLimit, restoreRateLimit, clientCookie } from "./testUtils";

// Bulk is a QUEUED JOB now: the route classifies rows, starts a job and returns
// its id; progress is polled. Every row runs the real lookup handler, so the
// tests here drive the job store with an injected runner rather than making
// network calls.

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
afterEach(() => { resetJobs(); });

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

const get = (query: string) =>
  GET(new Request(`http://localhost/api/bulk-lookup${query}`) as unknown as NextRequest);

describe("POST /api/bulk-lookup: validation", () => {
  it("400 on a body with neither items nor numbers", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/items/);
  });

  it("400 on an empty array", async () => {
    expect((await post({ numbers: [] })).status).toBe(400);
  });

  it("400 on a mode that has no bulk lookup", async () => {
    const res = await post({ items: ["anything"], mode: "graph" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/`mode` must be one of/);
  });
});

describe("prepareRows: classification", () => {
  it("classifies each row on its own in auto mode", () => {
    const { rows } = prepareRows(["wordpress.org", "a@b.com", "+14155552671", "8.8.8.8"], "auto");
    expect(rows.map((r) => r.mode)).toEqual(["domain", "email", "phone", "ip"]);
  });

  it("forces one mode when asked, and deduplicates case-insensitively", () => {
    const { rows } = prepareRows(["Example.com", "example.com", " "], "domain");
    expect(rows).toEqual([{ mode: "domain", value: "Example.com" }]);
  });

  it("reports a row whose mode has no bulk lookup rather than dropping it silently", () => {
    const { rows, skipped } = prepareRows(["anything"], "graph");
    expect(rows).toEqual([]);
    expect(skipped[0].reason).toMatch(/no bulk lookup for mode "graph"/);
  });
});

describe("the job runner", () => {
  /** A runner that answers instantly, so the test never touches the network. */
  const fakeRunner = async (mode: BulkMode, value: string) => ({
    status: mode === "ip" ? 400 : 200,
    body: mode === "ip"
      ? { error: "Not a valid IPv4 / IPv6 address" }
      : { domain: value, whois: { registrar: "R" }, dns: { a: [{ value: "1.1.1.1" }] }, sourceHealth: [{ source: "dns", ok: true }] },
  });

  const settle = async (id: string) => {
    for (let i = 0; i < 200 && getJob(id)?.state === "running"; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    return getJob(id)!;
  };

  it("runs every row and records both answers and failures", async () => {
    const job = startJob({
      rows: [{ mode: "domain", value: "a.test" }, { mode: "ip", value: "not-an-ip" }],
      runner: fakeRunner,
    });
    const done = await settle(job.id);
    expect(done.state).toBe("done");
    expect(done.done).toBe(2);
    const domain = done.rows.find((r) => r.mode === "domain")!;
    expect(domain.ok).toBe(true);
    expect(domain.summary.registrar).toBe("R");
    expect(domain.sources).toEqual([{ source: "dns", ok: true }]);
    // A 400 from the underlying lookup is a failed ROW, not a failed job, and
    // it carries the reason the lookup itself gave.
    const ip = done.rows.find((r) => r.mode === "ip")!;
    expect(ip.ok).toBe(false);
    expect(ip.error).toMatch(/Not a valid/);
  });

  it("records a thrown runner as a failed row instead of losing the job", async () => {
    const job = startJob({
      rows: [{ mode: "domain", value: "boom.test" }],
      runner: async () => { throw new Error("socket closed"); },
    });
    const done = await settle(job.id);
    expect(done.rows[0]).toMatchObject({ ok: false, status: 0, error: "the lookup failed" });
  });

  it("can be cancelled, and reports that rather than pretending to finish", async () => {
    const job = startJob({
      rows: Array.from({ length: 20 }, (_, i) => ({ mode: "domain" as const, value: `d${i}.test` })),
      runner: async (mode, value) => {
        await new Promise((r) => setTimeout(r, 20));
        return { status: 200, body: { domain: value } };
      },
      concurrency: 1,
    });
    expect(cancelJob(job.id)).toBe(true);
    expect(getJob(job.id)!.state).toBe("cancelled");
    // Cancelling twice is not an error the caller needs to handle, but it is
    // also not a second cancellation.
    expect(cancelJob(job.id)).toBe(false);
    expect(cancelJob("no-such-job")).toBe(false);
  });

  it("emits one CSV block per mode, quoting what needs quoting", async () => {
    const job = startJob({
      rows: [{ mode: "domain", value: "a,b.test" }, { mode: "email", value: "x@y.test" }],
      runner: async (mode, value) => ({ status: 200, body: { domain: value, email: value } }),
    });
    const done = await settle(job.id);
    const csv = jobCsv(done);
    expect(csv).toContain('"a,b.test"');
    expect(csv.split("\n\n")).toHaveLength(2); // one block per mode
  });

  it("serves progress and CSV over GET, and 404s an unknown id", async () => {
    const job = startJob({ rows: [{ mode: "domain", value: "a.test" }], runner: fakeRunner });
    await settle(job.id);

    const progress = await get(`?id=${job.id}`);
    expect(progress.status).toBe(200);
    expect((await progress.json()).done).toBe(1);

    const csv = await get(`?id=${job.id}&format=csv`);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(await csv.text()).toContain("a.test");

    expect((await get("?id=nope")).status).toBe(404);
  });

  it("stops a running job over DELETE, and 404s one that is not running", async () => {
    const job = startJob({
      rows: Array.from({ length: 10 }, (_, i) => ({ mode: "domain" as const, value: `x${i}.test` })),
      runner: async (mode, value) => { await new Promise((r) => setTimeout(r, 30)); return { status: 200, body: { domain: value } }; },
      concurrency: 1,
    });
    const stopped = await DELETE(new Request(`http://localhost/api/bulk-lookup?id=${job.id}`, { method: "DELETE" }) as unknown as NextRequest);
    expect(stopped.status).toBe(200);
    const again = await DELETE(new Request(`http://localhost/api/bulk-lookup?id=${job.id}`, { method: "DELETE" }) as unknown as NextRequest);
    expect(again.status).toBe(404);
  });
});

describe("POST /api/bulk-lookup: queueing", () => {
  it("starts a job and reports its size", async () => {
    const res = await post({ items: ["a.test", "b.test"], mode: "domain" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.total).toBe(2);
    expect(json.state).toBe("running");
    cancelJob(json.id);
  });

  it("truncates beyond the row cap and says by how much", async () => {
    const items = Array.from({ length: MAX_BULK_ROWS + 5 }, (_, i) => `d${i}.test`);
    const res = await post({ items, mode: "domain" });
    const json = await res.json();
    expect(json.total).toBe(MAX_BULK_ROWS);
    expect(json.truncated).toBe(5);
    cancelJob(json.id);
  });
});

describe("POST /api/bulk-lookup: rate limiting", () => {
  it("429s once the per-client window is spent", async () => {
    useRateLimit(1);
    try {
      const cookie = clientCookie("bulkjob");
      const call = () => POST(new Request("http://localhost/api/bulk-lookup", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ items: ["a.test"], mode: "domain" }),
      }) as unknown as NextRequest);
      const first = await call();
      expect(first.status).toBe(200);
      cancelJob((await first.json()).id);
      expect((await call()).status).toBe(429);
    } finally {
      restoreRateLimit();
    }
  });
});
