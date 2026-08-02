import path from "node:path";

// ── Where all file-backed state lives ────────────────────────────────────────
// One definition shared by the audit log, the case store, the key store and the
// dataset overlays — they previously each carried their own copy of this line,
// so a change to the resolution rule had to be made in four places.
//
// Resolved lazily on every call, never captured at module load, so an operator
// (or a test) can redirect all state with HV_DATA_DIR without import-order
// mattering.

/** Root directory for runtime state. `HV_DATA_DIR` overrides `./.data`. */
export function dataDir(): string {
  return process.env.HV_DATA_DIR || path.join(process.cwd(), ".data");
}

/** A file inside the data directory. */
export function dataFile(name: string): string {
  return path.join(dataDir(), name);
}
