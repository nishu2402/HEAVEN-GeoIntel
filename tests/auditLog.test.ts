import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { audit, readAudit, clearAudit } from "@/lib/server/auditLog";

// Append-only accountability log. By default it must NOT store the raw target
// (only a salted hash), must never throw, and now honours HV_DATA_DIR so the
// test can point it at a hermetic temp dir.
let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "hv-audit-"));
  process.env.HV_DATA_DIR = dir;
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.HV_DATA_DIR;
});
beforeEach(async () => { await clearAudit(); });

describe("audit / readAudit", () => {
  it("records the event but hashes the target by default (no raw PII)", async () => {
    await audit("phone", "+14155552671", "127.0.0.1", 200);
    const rows = await readAudit();
    expect(rows).toHaveLength(1);
    const [e] = rows;
    expect(e.kind).toBe("phone");
    expect(e.ip).toBe("127.0.0.1");
    expect(e.status).toBe(200);
    expect(e.target).not.toBe("+14155552671"); // never raw
    expect(e.target.startsWith("sha256:")).toBe(true);
    expect(() => new Date(e.ts).toISOString()).not.toThrow();
  });

  it("hashes the same target to the same value within a run (repeat detection)", async () => {
    await audit("email", "a@b.com", "127.0.0.1", 200);
    await audit("email", "a@b.com", "127.0.0.1", 200);
    const rows = await readAudit();
    expect(rows[0].target).toBe(rows[1].target);
  });

  it("keeps append order (newest last) and honours the limit", async () => {
    for (const k of ["a", "b", "c", "d", "e"]) await audit("ip", k, "127.0.0.1", 200);
    const all = await readAudit();
    expect(all).toHaveLength(5);
    const last2 = await readAudit(2);
    expect(last2).toHaveLength(2);
    // same tail as the full log
    expect(last2.map((r) => r.target)).toEqual(all.slice(-2).map((r) => r.target));
  });

  it("clearAudit empties the log; readAudit on a missing log returns []", async () => {
    await audit("domain", "example.com", "127.0.0.1", 200);
    await clearAudit();
    expect(await readAudit()).toEqual([]);
  });
});

describe("AUDIT_PLAINTEXT override", () => {
  afterEach(() => { delete process.env.AUDIT_PLAINTEXT; });

  it("stores the raw target only when explicitly enabled", async () => {
    process.env.AUDIT_PLAINTEXT = "1";
    await audit("phone", "+14155552671", "127.0.0.1", 200);
    const [e] = await readAudit();
    expect(e.target).toBe("+14155552671");
  });
});

describe("data-dir fallback", () => {
  it("falls back to ./.data when HV_DATA_DIR is unset (read-only, no writes)", async () => {
    const saved = process.env.HV_DATA_DIR;
    delete process.env.HV_DATA_DIR; // exercise the `|| ./.data` branch
    try {
      // readAudit never writes; a missing default log just yields [].
      expect(Array.isArray(await readAudit())).toBe(true);
    } finally {
      process.env.HV_DATA_DIR = saved;
    }
  });
});
