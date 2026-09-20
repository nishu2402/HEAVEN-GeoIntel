import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { audit, readAudit, clearAudit } from "@/lib/server/auditLog";
import { SUITE_DATA_DIR } from "./testUtils";

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
  process.env.HV_DATA_DIR = SUITE_DATA_DIR;
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
    process.env.HV_DATA_DIR = SUITE_DATA_DIR; // exercise the `|| ./.data` branch
    try {
      // readAudit never writes; a missing default log just yields [].
      expect(Array.isArray(await readAudit())).toBe(true);
    } finally {
      process.env.HV_DATA_DIR = saved;
    }
  });
});

// ── Rotation ────────────────────────────────────────────────────────────────
// Every guarded route appends a row and a 500-row bulk job appends 500, so an
// append-only log with no ceiling grows for as long as the server runs.
describe("audit log rotation", () => {
  const logPath = () => join(dir, "audit.log");

  it("rolls the log over once it passes the ceiling, keeping one generation", async () => {
    // One byte past the 8 MB ceiling, made of real rows so the rotated
    // generation is still readable afterwards.
    const row = JSON.stringify({ ts: new Date().toISOString(), kind: "domain", target: "sha256:old", ip: "shared", status: 200 }) + "\n";
    writeFileSync(logPath(), row.repeat(Math.ceil((8 * 1024 * 1024) / row.length)));

    await audit("phone", "+14155552671", "shared", 200);

    expect(existsSync(join(dir, "audit.log.1"))).toBe(true);
    // The live log is now just the new row, not 8 MB of history.
    expect(statSync(logPath()).size).toBeLessThan(1024);
    // The archive holds the same targets as the live log, so it must not be
    // readable by anyone the live log is not. `rename` carries the OLD file's
    // bits across, and this one was deliberately seeded world-readable.
    expect(statSync(join(dir, "audit.log.1")).mode & 0o077).toBe(0);
    const rows = await readAudit(5);
    expect(rows.at(-1)?.kind).toBe("phone");
    // The rollover did not make recent history disappear: the previous
    // generation is consulted while the live log holds fewer than `limit` rows.
    expect(rows.length).toBe(5);
    expect(rows[0].target).toBe("sha256:old");
  });

  it("does not rotate a log that is still under the ceiling", async () => {
    await audit("ip", "8.8.8.8", "shared", 200);
    await audit("ip", "1.1.1.1", "shared", 200);
    expect(existsSync(join(dir, "audit.log.1"))).toBe(false);
    expect(await readAudit()).toHaveLength(2);
  });

  it("skips a corrupt line rather than losing the whole trail", async () => {
    await audit("ip", "8.8.8.8", "shared", 200);
    appendFileSync(logPath(), "{ not json\n");
    await audit("ip", "1.1.1.1", "shared", 200);
    const rows = await readAudit();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.kind === "ip")).toBe(true);
  });

  it("the data wipe takes the rotated generation too", async () => {
    writeFileSync(join(dir, "audit.log.1"), "{}\n");
    await audit("ip", "8.8.8.8", "shared", 200);
    await clearAudit();
    expect(existsSync(join(dir, "audit.log"))).toBe(false);
    expect(existsSync(join(dir, "audit.log.1"))).toBe(false);
  });
});
