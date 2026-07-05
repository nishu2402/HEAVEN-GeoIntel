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

// Resolved lazily per call (like caseStore/keyStore) so an operator can relocate
// all file-backed state with HV_DATA_DIR, and so tests can point at a temp dir.
const dataDir = () => process.env.HV_DATA_DIR || path.join(process.cwd(), ".data");
const auditFile = () => path.join(dataDir(), "audit.log");

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
    await fs.appendFile(file, JSON.stringify(entry) + "\n", { encoding: "utf8", mode: 0o600 });
    // Make sure perms are tight even if the file pre-existed with looser bits.
    /* v8 ignore next -- chmod is best-effort hardening; ignoring failure is intentional */
    await fs.chmod(file, 0o600).catch(() => {});
  } catch {
    /* never let auditing break a lookup */
  }
}

/** Read the most recent N entries (newest last). Returns [] if no log yet. */
export async function readAudit(limit = 200): Promise<AuditEntry[]> {
  try {
    const raw = await fs.readFile(auditFile(), "utf8");
    const lines = raw.split("\n").filter(Boolean);
    return lines.slice(-limit).map((l) => JSON.parse(l) as AuditEntry);
  } catch {
    return [];
  }
}

export async function clearAudit(): Promise<void> {
  try { await fs.rm(auditFile(), { force: true }); } catch { /* ignore */ }
}
