// ── Append-only audit log ────────────────────────────────────────────────────
// Accountability for an OSINT tool: record THAT a lookup happened, when, of what
// type, and a salted hash of the target — never the raw identifier by default,
// so the log itself isn't a fresh pile of PII. Set AUDIT_PLAINTEXT=1 to store
// the raw value instead (e.g. a regulated environment that requires it).
//
// Best-effort and non-blocking: a logging failure must never break a lookup.

import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { dataDir } from "./dataDir";

// Resolved lazily per call (like caseStore/keyStore) so an operator can relocate
// all file-backed state with HV_DATA_DIR, and so tests can point at a temp dir.
const auditFile = () => path.join(dataDir(), "audit.log");
/**
 * One retained previous generation. Rotation is what keeps this file bounded:
 * every guarded route appends a row, and a 500-row bulk job appends 500 of
 * them, so an append-only log with no ceiling grows for as long as the server
 * runs. Two generations keep roughly 8-16 MB of history — months of ordinary
 * use — and bound what `readAudit` has to read to find the newest rows.
 */
const rotatedFile = () => `${auditFile()}.1`;
const MAX_AUDIT_BYTES = 8 * 1024 * 1024;

/** Roll the log over once it passes the ceiling. Best-effort, like the append. */
async function rotateIfFull(file: string): Promise<void> {
  try {
    const { size } = await fs.stat(file);
    if (size < MAX_AUDIT_BYTES) return;
    const rotated = rotatedFile();
    await fs.rename(file, rotated);
    // `rename` carries the old file's permission bits across, and the append
    // below only sets mode 0600 when it CREATES a file — which is why the
    // append path also chmods. The archive holds exactly the same targets as
    // the live log, so it gets the same treatment: a log that pre-existed with
    // looser bits must not hand those bits to its own archive.
    /* v8 ignore next -- chmod is best-effort hardening, as on the append path */
    await fs.chmod(rotated, 0o600).catch(() => {});
  } catch {
    /* no log yet, or another append won the rename — either way keep logging */
  }
}

// Per-process random salt so hashes aren't trivially reversible via a rainbow
// table of common phone/email values, while equal targets still collide within
// a run (useful for spotting repeats).
const SALT = createHash("sha256").update(String(process.pid) + ":" + Date.now()).digest("hex").slice(0, 16);

function tag(target: string): string {
  if (process.env.AUDIT_PLAINTEXT === "1") return target;
  return "sha256:" + createHash("sha256").update(SALT + target).digest("hex").slice(0, 24);
}

export interface AuditEntry {
  ts: string;        // ISO-8601
  kind: string;      // phone | email | username | ip | domain | bulk | …
  target: string;    // hashed (default) or plaintext
  ip: string;        // requester bucket (best-effort)
  status: number;    // HTTP status returned
}

export async function audit(kind: string, target: string, ip: string, status: number): Promise<void> {
  try {
    const entry: AuditEntry = { ts: new Date().toISOString(), kind, target: tag(target), ip, status };
    const file = auditFile();
    await fs.mkdir(dataDir(), { recursive: true });
    await rotateIfFull(file);
    await fs.appendFile(file, JSON.stringify(entry) + "\n", { encoding: "utf8", mode: 0o600 });
    // Make sure perms are tight even if the file pre-existed with looser bits.
    /* v8 ignore next -- chmod is best-effort hardening; ignoring failure is intentional */
    await fs.chmod(file, 0o600).catch(() => {});
  } catch {
    /* never let auditing break a lookup */
  }
}

async function linesOf(file: string): Promise<string[]> {
  try {
    return (await fs.readFile(file, "utf8")).split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Read the most recent N entries (newest last). Returns [] if no log yet.
 *
 * The previous generation is consulted only when the current one holds fewer
 * than `limit` rows, which is exactly the window just after a rotation — so a
 * rollover does not make recent history briefly disappear.
 */
export async function readAudit(limit = 200): Promise<AuditEntry[]> {
  let lines = await linesOf(auditFile());
  if (lines.length < limit) {
    lines = [...(await linesOf(rotatedFile())), ...lines];
  }
  return lines.slice(-limit).flatMap((l) => {
    try { return [JSON.parse(l) as AuditEntry]; } catch { return []; }
  });
}

/**
 * Remove the audit trail. Takes the rotated generation too: this is called by
 * the "delete all my data" wipe, and a previous generation surviving it would
 * be the exact surprise that wipe exists to prevent.
 */
export async function clearAudit(): Promise<void> {
  try { await fs.rm(auditFile(), { force: true }); } catch { /* ignore */ }
  try { await fs.rm(rotatedFile(), { force: true }); } catch { /* ignore */ }
}
