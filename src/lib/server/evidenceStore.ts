// ── Evidence locker ──────────────────────────────────────────────────────────
//
// A case snapshot stores a handful of scalars, by design: enough to diff a
// re-run, small enough to keep forever. What it cannot do is let anyone check,
// six months later, that a finding was real. The raw answer the tool acted on
// was never written down, so a challenged finding could only be re-run — against
// upstreams that have since changed.
//
// This is the missing half. It writes the lookup response exactly as the API
// returned it, hashes it with SHA-256, and records that hash in a per-case
// manifest. `verifyCase` recomputes every hash and reports which files still
// match. That completes the chain the report already starts with its document
// ID and payload hash: report → manifest entry → file on disk → hash.
//
// WHAT IS PRESERVED, stated exactly: the API response for one lookup, including
// each source's own payload where the response carries it (phone and email
// modes carry `sources.*.data` verbatim) and each source's provenance row for
// every mode. It is not a packet capture — nothing here claims to preserve the
// upstream's raw HTTP body for sources whose payload the route summarises.
//
// It is deliberately opt-in and case-scoped: this writes investigation data to
// disk, and that should be a decision, not a side effect of running a lookup.

import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { dataDir } from "./dataDir";

/** One preserved artifact. */
export interface EvidenceEntry {
  /** Content-addressed id: the first 32 hex of the payload hash. */
  id: string;
  /** Lookup mode the artifact came from (phone, domain, …). */
  mode: string;
  /** The identifier looked up. */
  identifier: string;
  /** SHA-256 of the stored bytes, lower-case hex. */
  sha256: string;
  bytes: number;
  /** When it was captured, epoch ms. */
  capturedAt: number;
  /** Per-source provenance carried in the response, flattened for the manifest. */
  sources: { source: string; ok: boolean; ms: number; fetchedAt: number }[];
  /** Analyst's own note about why this was preserved. */
  note?: string;
}

export interface EvidenceManifest {
  caseId: string;
  entries: EvidenceEntry[];
}

/** One file's verification result. */
export interface EvidenceCheck {
  id: string;
  /** "ok" — bytes hash to the recorded value; "modified" — they do not; "missing" — the file is gone. */
  state: "ok" | "modified" | "missing";
  expected: string;
  actual: string | null;
}

const MAX_NOTE = 2000;
const MAX_IDENTIFIER = 512;
/** Cap on one stored artifact. A lookup response is tens of kilobytes. */
export const MAX_EVIDENCE_BYTES = 4_000_000;
/** Cap on artifacts per case, so a scripted loop cannot fill the disk. */
export const MAX_EVIDENCE_ENTRIES = 500;

/**
 * Shape limits on the payload, checked BEFORE it is serialised.
 *
 * `JSON.stringify(v, null, 2)` costs indentation per line, so its output grows
 * with NESTING DEPTH — a body that fits the route's 4 MB ceiling can expand to
 * hundreds of megabytes on the way to the size check that was supposed to
 * refuse it. Measured: 4.26 MB of nested arrays serialised to 436 MB at depth
 * 100, and past depth ~500 it exceeded V8's maximum string length and threw a
 * RangeError, turning a 413 into a 500.
 *
 * So the shape is bounded first, with a cheap walk that allocates nothing. The
 * numbers are set against what real responses measure — the richest (an email
 * lookup carrying a full breach set) is depth 6 with 21,592 nodes and expands
 * 1.77x — so these are roughly 10x and 20x headroom, and no genuine artifact
 * comes near them. Together they bound the serialised size well under V8's
 * limit, which is what keeps the byte check below reachable.
 */
const MAX_PAYLOAD_DEPTH = 64;
const MAX_PAYLOAD_NODES = 500_000;

/**
 * Walk the payload once, counting nodes and depth, stopping at the first breach
 * of either cap. Iterative so a deeply nested body cannot overflow the stack on
 * the way to being refused for being deeply nested.
 */
function shapeRefusal(payload: unknown): string | null {
  const stack: { value: unknown; depth: number }[] = [{ value: payload, depth: 0 }];
  let nodes = 0;
  while (stack.length > 0) {
    const { value, depth } = stack.pop()!;
    if (++nodes > MAX_PAYLOAD_NODES) {
      return `artifact holds more than ${MAX_PAYLOAD_NODES} values`;
    }
    if (value === null || typeof value !== "object") continue;
    if (depth >= MAX_PAYLOAD_DEPTH) {
      return `artifact is nested deeper than ${MAX_PAYLOAD_DEPTH} levels`;
    }
    for (const key of Object.keys(value)) {
      stack.push({ value: (value as Record<string, unknown>)[key], depth: depth + 1 });
    }
  }
  return null;
}

const root = () => path.join(dataDir(), "evidence");

/**
 * One case's directory, resolved and proven to be inside the locker.
 *
 * `safeId` has already refused every character a traversal needs, so the guard
 * below cannot fire from a crafted id. It stays because it makes containment a
 * property of the path this function hands out — checkable on the spot, by a
 * reader or by a scanner — instead of an inference about a regex living in
 * another function. Every fs call in this module goes through here, including
 * the recursive delete, which is the one worth being sure about.
 */
function caseDir(caseId: string): string {
  const base = path.resolve(root());
  const dir = path.resolve(base, safeId(caseId));
  /* v8 ignore next -- unreachable: safeId rejects slashes, backslashes and dots first. */
  if (!dir.startsWith(base + path.sep)) throw new Error("invalid id");
  return dir;
}

const manifestFile = (caseId: string) => path.join(caseDir(caseId), "manifest.json");

/**
 * Case and artifact ids are used as path segments, so anything that is not
 * hex/dash is refused rather than sanitised: a "cleaned" traversal attempt is
 * still an attempt, and the ids this store issues are UUIDs.
 */
function safeId(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error("invalid id");
  return id;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// Mutations are serialised the same way the case store serialises its own, so a
// read-modify-write of the manifest cannot lose an entry to a concurrent
// capture.
let chain: Promise<unknown> = Promise.resolve();
function serialize<T>(op: () => Promise<T>): Promise<T> {
  const run = chain.then(op, op);
  chain = run.then(() => {}, () => {});
  return run;
}

async function readManifest(caseId: string): Promise<EvidenceEntry[]> {
  try {
    const raw = await fs.readFile(manifestFile(caseId), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as EvidenceEntry[]) : [];
  } catch {
    return [];
  }
}

async function writeManifest(caseId: string, entries: EvidenceEntry[]): Promise<void> {
  const dir = caseDir(caseId);
  await fs.mkdir(dir, { recursive: true });
  const file = manifestFile(caseId);
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(entries, null, 2), { encoding: "utf8", mode: 0o600 });
  await fs.rename(tmp, file);
  /* v8 ignore next -- chmod is best-effort hardening, as in the case store */
  await fs.chmod(file, 0o600).catch(() => {});
}

interface Provenance { source?: unknown; ok?: unknown; ms?: unknown; fetchedAt?: unknown }

/** Flatten whatever `sourceHealth` the response carried, defensively. */
function flattenSources(payload: unknown): EvidenceEntry["sources"] {
  const health = (payload as { sourceHealth?: unknown } | null)?.sourceHealth;
  if (!Array.isArray(health)) return [];
  return health
    .filter((h): h is Provenance => typeof h === "object" && h !== null)
    .map((h) => ({
      source: typeof h.source === "string" ? h.source : "unknown",
      ok: h.ok === true,
      ms: typeof h.ms === "number" ? h.ms : 0,
      fetchedAt: typeof h.fetchedAt === "number" ? h.fetchedAt : 0,
    }));
}

export interface CaptureInput {
  caseId: string;
  mode: string;
  identifier: string;
  /** The lookup response, exactly as the API returned it. */
  payload: unknown;
  note?: string;
  now?: number;
}

export type CaptureResult =
  | { ok: true; entry: EvidenceEntry; duplicate: boolean }
  | { ok: false; error: string };

/**
 * Preserve one lookup response. Capturing the same bytes twice returns the
 * existing entry rather than a second copy: the artifact is content-addressed,
 * so a duplicate is the same evidence, not new evidence.
 */
export function captureEvidence(input: CaptureInput): Promise<CaptureResult> {
  return serialize(async () => {
    const refusal = shapeRefusal(input.payload);
    if (refusal) return { ok: false as const, error: refusal };

    const text = JSON.stringify(input.payload, null, 2);
    // Counted in BYTES, not UTF-16 units: the cap is named in bytes, `bytes`
    // below records byteLength, and the two disagreed by up to 3x on non-ASCII
    // content — a 4 M character artifact of multi-byte text is a 12 MB file.
    if (Buffer.byteLength(text, "utf8") > MAX_EVIDENCE_BYTES) {
      return { ok: false as const, error: "artifact is larger than the evidence-store limit" };
    }
    const digest = sha256(text);
    const id = digest.slice(0, 32);

    const entries = await readManifest(input.caseId);
    const existing = entries.find((e) => e.sha256 === digest);
    if (existing) return { ok: true as const, entry: existing, duplicate: true };
    if (entries.length >= MAX_EVIDENCE_ENTRIES) {
      return { ok: false as const, error: `this case already holds ${MAX_EVIDENCE_ENTRIES} artifacts` };
    }

    const dir = caseDir(input.caseId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${id}.json`), text, { encoding: "utf8", mode: 0o600 });

    const entry: EvidenceEntry = {
      id,
      mode: input.mode.slice(0, 32),
      identifier: input.identifier.slice(0, MAX_IDENTIFIER),
      sha256: digest,
      bytes: Buffer.byteLength(text, "utf8"),
      capturedAt: input.now ?? Date.now(),
      sources: flattenSources(input.payload),
      ...(input.note ? { note: input.note.slice(0, MAX_NOTE) } : {}),
    };
    await writeManifest(input.caseId, [...entries, entry]);
    return { ok: true as const, entry, duplicate: false };
  });
}

/** The manifest for one case, newest last. */
export async function listEvidence(caseId: string): Promise<EvidenceEntry[]> {
  return readManifest(caseId);
}

/** One stored artifact's bytes, or null when it is gone. */
export async function readEvidence(caseId: string, id: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(caseDir(caseId), `${safeId(id)}.json`), "utf8");
  } catch {
    return null;
  }
}

/**
 * Recompute every hash in a case's manifest.
 *
 * This is the point of the whole module: an artifact whose bytes no longer hash
 * to the recorded value is reported as `modified`, and one that has been deleted
 * as `missing`. Either is a finding about the evidence itself.
 */
export async function verifyCase(caseId: string): Promise<EvidenceCheck[]> {
  const entries = await readManifest(caseId);
  const out: EvidenceCheck[] = [];
  for (const e of entries) {
    const text = await readEvidence(caseId, e.id);
    if (text === null) {
      out.push({ id: e.id, state: "missing", expected: e.sha256, actual: null });
      continue;
    }
    const actual = sha256(text);
    out.push({ id: e.id, state: actual === e.sha256 ? "ok" : "modified", expected: e.sha256, actual });
  }
  return out;
}

/** Remove a case's whole locker. Used when the case itself is deleted. */
export async function dropCaseEvidence(caseId: string): Promise<void> {
  await fs.rm(caseDir(caseId), { recursive: true, force: true });
}

/** Remove every locker. Used by the "delete my data" wipe. */
export async function dropAllEvidence(): Promise<void> {
  await fs.rm(root(), { recursive: true, force: true });
}
