// ── Persistent investigation-case store ─────────────────────────────────────
// Zero-dependency, file-backed persistence under ./.data/cases.json. Survives
// across sessions and server restarts (unlike the in-memory lookup cache).
// Designed to be swappable for SQLite later — the public surface is just the
// async functions below.
//
// Why a JSON file and not SQLite: keeps the project's "no native deps, no DB
// server" promise intact while still giving real cross-session persistence.
// The store is small (investigation metadata, not bulk results).

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { InvestigationCase, CaseEntity, CaseEdge, CaseSnapshot, EntityKind } from "../types";
import { mergeCaseInto } from "../analysis/caseMerge";
import { appendSnapshot, diffSnapshot, type SnapshotDiff } from "../analysis/caseSnapshot";
import { snapshotHistory } from "./config";
import { dataDir } from "./dataDir";

const casesFile = () => path.join(dataDir(), "cases.json");

// Length caps so a malformed/abusive request can't bloat the on-disk store.
const MAX_NAME = 200;
const MAX_VALUE = 512;
const MAX_ENTITY_NOTE = 2000;
const MAX_NOTES = 20000;
const MAX_REASON = 200;
/** Edges are derived automatically, so a single pin could otherwise add dozens. */
const MAX_EDGES = 500;
/** A snapshot's fact bag is machine-produced; cap it so a bug can't bloat the file. */
const MAX_FACTS = 40;
const cap = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

// Serialise every mutation so each runs read → modify → write ATOMICALLY. This
// does two things a bare `chain = chain.then(op)` cannot:
//   1. No lost updates — a mutation reads the file only after the previous
//      mutation's write has landed, so concurrent requests can't clobber each
//      other (e.g. a notes auto-save racing an addEntity).
//   2. No queue poisoning — the op runs whether the previous op resolved OR
//      rejected, and the retained tail is always resolved, so a single failed
//      write can't silently disable every future write for the process.
let chain: Promise<unknown> = Promise.resolve();
function serialize<T>(op: () => Promise<T>): Promise<T> {
  const run = chain.then(op, op);
  chain = run.then(() => {}, () => {});
  return run;
}

async function readAll(): Promise<InvestigationCase[]> {
  try {
    const raw = await fs.readFile(casesFile(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as InvestigationCase[]) : [];
  } catch {
    return [];
  }
}

// Atomic write: stage to a temp file, then rename over the target. rename() is
// atomic on POSIX, so a concurrent reader never observes a half-written file,
// and a mid-write crash leaves the previous good file intact.
async function persist(cases: InvestigationCase[]): Promise<void> {
  const file = casesFile();
  await fs.mkdir(dataDir(), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  // Owner-only perms: this file holds investigation targets (PII).
  await fs.writeFile(tmp, JSON.stringify(cases, null, 2), { encoding: "utf8", mode: 0o600 });
  try {
    await fs.rename(tmp, file);
  } catch (err) {
    /* v8 ignore next -- best-effort tmp cleanup; the no-op catch is defensive */
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
  /* v8 ignore next -- chmod is best-effort hardening; ignoring failure is intentional */
  await fs.chmod(file, 0o600).catch(() => {});
}

export async function listCases(): Promise<InvestigationCase[]> {
  const all = await readAll();
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getCase(id: string): Promise<InvestigationCase | null> {
  const all = await readAll();
  return all.find((c) => c.id === id) ?? null;
}

export async function createCase(name: string): Promise<InvestigationCase> {
  return serialize(async () => {
    const all = await readAll();
    const now = Date.now();
    const c: InvestigationCase = {
      id: randomUUID(),
      name: cap(name.trim(), MAX_NAME) || `Case ${new Date(now).toISOString().split("T")[0]}`,
      createdAt: now,
      updatedAt: now,
      entities: [],
      notes: "",
    };
    all.push(c);
    await persist(all);
    return c;
  });
}

/** Wipe every case (the "delete all my data" action). Irreversible. */
export async function deleteAllCases(): Promise<void> {
  return serialize(() => persist([]));
}

const VALID_KINDS = new Set<EntityKind>(["phone", "email", "username", "ip", "domain"]);

/**
 * Re-import a case from an exported report (always created as a NEW case with a
 * fresh id, so importing never clobbers an existing one). Entities are validated
 * + de-duped; notes are length-capped.
 */
export async function importCase(input: {
  name?: string;
  notes?: string;
  entities?: Array<{ kind?: string; value?: unknown; note?: string; addedAt?: number }>;
  /** Derived relationships from an exported report — validated like the live path. */
  edges?: unknown;
  /** Lookup fingerprints, so a re-imported case can still be diffed. */
  snapshots?: unknown;
}): Promise<InvestigationCase> {
  return serialize(async () => {
    const all = await readAll();
    const now = Date.now();
    const entities: CaseEntity[] = [];
    const seen = new Set<string>();
    for (const e of input.entities ?? []) {
      const kind = e?.kind as EntityKind;
      if (!VALID_KINDS.has(kind)) continue;
      const v = String(e?.value ?? "").trim();
      if (!v) continue;
      const key = `${kind}::${v.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entities.push({
        kind,
        value: cap(v, MAX_VALUE),
        addedAt: typeof e?.addedAt === "number" && Number.isFinite(e.addedAt) ? e.addedAt : now,
        note: e?.note ? cap(String(e.note), MAX_ENTITY_NOTE) : undefined,
      });
    }
    const edges = sanitizeEdges(input.edges, now);
    const snapshots = sanitizeSnapshots(input.snapshots, now);
    const c: InvestigationCase = {
      id: randomUUID(),
      name: cap((input.name ?? "").trim(), MAX_NAME) || `Imported ${new Date(now).toISOString().split("T")[0]}`,
      createdAt: now,
      updatedAt: now,
      entities,
      notes: cap(input.notes ?? "", MAX_NOTES),
      ...(edges.length > 0 ? { edges } : {}),
      ...(snapshots.length > 0 ? { snapshots } : {}),
    };
    all.push(c);
    await persist(all);
    return c;
  });
}

/** An imported file is untrusted: keep only well-formed, non-self edges. */
function sanitizeEdges(raw: unknown, fallbackAt: number): CaseEdge[] {
  if (!Array.isArray(raw)) return [];
  const out: CaseEdge[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const e = item as { from?: { kind?: unknown; value?: unknown }; to?: { kind?: unknown; value?: unknown }; reason?: unknown; addedAt?: unknown };
    const from = edgeRef(e.from);
    const to = edgeRef(e.to);
    if (!from || !to) continue;
    if (from.kind === to.kind && from.value.toLowerCase() === to.value.toLowerCase()) continue;
    const reason = cap(String(e.reason ?? "").trim(), MAX_REASON) || "derived";
    const key = `${from.kind}:${from.value.toLowerCase()}|${to.kind}:${to.value.toLowerCase()}|${reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      from, to, reason,
      addedAt: typeof e.addedAt === "number" && Number.isFinite(e.addedAt) ? e.addedAt : fallbackAt,
    });
  }
  return out.slice(-MAX_EDGES);
}

/** Same for snapshots — kept in chronological order so diffing still works. */
function sanitizeSnapshots(raw: unknown, fallbackAt: number): CaseSnapshot[] {
  if (!Array.isArray(raw)) return [];
  const out: CaseSnapshot[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const s = item as { kind?: unknown; value?: unknown; takenAt?: unknown; facts?: unknown; fromCache?: unknown };
    const kind = s.kind as EntityKind;
    if (!VALID_KINDS.has(kind)) continue;
    const value = cap(String(s.value ?? "").trim(), MAX_VALUE);
    if (!value) continue;
    out.push({
      kind,
      value,
      takenAt: typeof s.takenAt === "number" && Number.isFinite(s.takenAt) ? s.takenAt : fallbackAt,
      facts: sanitizeFacts(s.facts),
      ...(s.fromCache === true ? { fromCache: true as const } : {}),
    });
  }
  return out.sort((a, b) => a.takenAt - b.takenAt);
}

export async function deleteCase(id: string): Promise<boolean> {
  return serialize(async () => {
    const all = await readAll();
    const next = all.filter((c) => c.id !== id);
    if (next.length === all.length) return false;
    await persist(next);
    return true;
  });
}

export async function renameCase(id: string, name: string): Promise<InvestigationCase | null> {
  return serialize(async () => {
    const all = await readAll();
    const c = all.find((x) => x.id === id);
    if (!c) return null;
    c.name = cap(name.trim(), MAX_NAME) || c.name;
    c.updatedAt = Date.now();
    await persist(all);
    return c;
  });
}

export async function setCaseNotes(id: string, notes: string): Promise<InvestigationCase | null> {
  return serialize(async () => {
    const all = await readAll();
    const c = all.find((x) => x.id === id);
    if (!c) return null;
    c.notes = cap(notes, MAX_NOTES);
    c.updatedAt = Date.now();
    await persist(all);
    return c;
  });
}

export async function addEntity(id: string, kind: EntityKind, value: string, note?: string): Promise<InvestigationCase | null> {
  return serialize(async () => {
    const all = await readAll();
    const c = all.find((x) => x.id === id);
    if (!c) return null;
    const v = cap(value.trim(), MAX_VALUE);
    if (!v) return c;
    // de-dupe by kind+value
    if (!c.entities.some((e) => e.kind === kind && e.value === v)) {
      const entity: CaseEntity = { kind, value: v, addedAt: Date.now(), note: note ? cap(note, MAX_ENTITY_NOTE) : undefined };
      c.entities.push(entity);
      c.updatedAt = Date.now();
      await persist(all);
    }
    return c;
  });
}

/**
 * Merge the `sourceId` case into the `targetId` case: fold the source's
 * identifiers and notes into the target (see mergeCaseInto), then delete the
 * source. Returns the updated target, or null if either case is missing. A
 * self-merge (same id) is a no-op that returns the case unchanged. Serialised
 * like every other mutation so it can't race a concurrent write.
 */
export async function mergeCases(targetId: string, sourceId: string): Promise<InvestigationCase | null> {
  return serialize(async () => {
    const all = await readAll();
    const target = all.find((c) => c.id === targetId);
    const source = all.find((c) => c.id === sourceId);
    if (!target || !source) return null;
    if (targetId === sourceId) return target;
    const { entities, notes, edges, snapshots } = mergeCaseInto(target, source);
    target.entities = entities;
    target.notes = cap(notes, MAX_NOTES);
    if (edges.length > 0) target.edges = edges.slice(-MAX_EDGES);
    if (snapshots.length > 0) target.snapshots = snapshots;
    target.updatedAt = Date.now();
    await persist(all.filter((c) => c.id !== sourceId));
    return target;
  });
}

// ── Derived graph edges ──────────────────────────────────────────────────────

interface EdgeInput {
  from?: { kind?: unknown; value?: unknown };
  to?: { kind?: unknown; value?: unknown };
  reason?: unknown;
}

/** Validate one edge end; null for anything not a known kind + non-empty value. */
function edgeRef(raw: { kind?: unknown; value?: unknown } | undefined): { kind: EntityKind; value: string } | null {
  if (!raw) return null;
  const kind = raw.kind as EntityKind;
  if (!VALID_KINDS.has(kind)) return null;
  const value = cap(String(raw.value ?? "").trim(), MAX_VALUE);
  return value ? { kind, value } : null;
}

/**
 * Attach derived relationships to a case. Edges come from the auto-pivot engine,
 * so they arrive in batches when an analyst pins a result — de-duped on
 * from+to+reason so pinning the same result twice does not double the graph.
 *
 * A self-edge is dropped: an identifier linking to itself carries no
 * information and would render as a loop in the graph.
 */
export async function addEdges(id: string, edges: EdgeInput[]): Promise<InvestigationCase | null> {
  return serialize(async () => {
    const all = await readAll();
    const c = all.find((x) => x.id === id);
    if (!c) return null;

    const existing = c.edges ?? [];
    const seen = new Set(
      existing.map((e) => `${e.from.kind}:${e.from.value.toLowerCase()}|${e.to.kind}:${e.to.value.toLowerCase()}|${e.reason}`),
    );
    const now = Date.now();
    const added: CaseEdge[] = [];

    for (const raw of edges) {
      const from = edgeRef(raw?.from);
      const to = edgeRef(raw?.to);
      if (!from || !to) continue;
      if (from.kind === to.kind && from.value.toLowerCase() === to.value.toLowerCase()) continue;
      const reason = cap(String(raw?.reason ?? "").trim(), MAX_REASON) || "derived";
      const key = `${from.kind}:${from.value.toLowerCase()}|${to.kind}:${to.value.toLowerCase()}|${reason}`;
      if (seen.has(key)) continue;
      seen.add(key);
      added.push({ from, to, reason, addedAt: now });
    }

    if (added.length === 0) return c;
    // Keep the newest MAX_EDGES: an old edge is still true, but an unbounded
    // file is a real failure mode and recency is the better tiebreak.
    c.edges = [...existing, ...added].slice(-MAX_EDGES);
    c.updatedAt = now;
    await persist(all);
    return c;
  });
}

// ── Snapshots ────────────────────────────────────────────────────────────────

/** Coerce an untrusted fact bag to scalars, dropping anything else. */
function sanitizeFacts(raw: unknown): Record<string, number | string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, number | string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_FACTS) break;
    if (typeof v === "number" && Number.isFinite(v)) out[cap(k, 64)] = v;
    else if (typeof v === "string") out[cap(k, 64)] = cap(v, 200);
  }
  return out;
}

/**
 * Record a lookup fingerprint and report what moved since the last one for the
 * same identifier.
 *
 * The DIFF IS COMPUTED HERE, against what is on disk — not by the caller. A
 * client that computed its own diff could only compare against what it happened
 * to still have in memory, which is exactly the state that gets lost between
 * sessions.
 */
export async function recordSnapshot(
  id: string,
  kind: EntityKind,
  value: string,
  facts: unknown,
  fromCache: boolean,
): Promise<{ case: InvestigationCase; diff: SnapshotDiff } | null> {
  return serialize(async () => {
    const all = await readAll();
    const c = all.find((x) => x.id === id);
    if (!c) return null;

    const v = cap(value.trim(), MAX_VALUE);
    if (!v) return null;

    const next: CaseSnapshot = {
      kind,
      value: v,
      takenAt: Date.now(),
      facts: sanitizeFacts(facts),
      ...(fromCache ? { fromCache: true } : {}),
    };

    const history = c.snapshots ?? [];
    // Diff BEFORE appending, so the new snapshot is never compared with itself.
    const diff = diffSnapshot(history, next);
    c.snapshots = appendSnapshot(history, next, snapshotHistory());
    c.updatedAt = next.takenAt;
    await persist(all);
    return { case: c, diff };
  });
}

export async function removeEntity(id: string, kind: EntityKind, value: string): Promise<InvestigationCase | null> {
  return serialize(async () => {
    const all = await readAll();
    const c = all.find((x) => x.id === id);
    if (!c) return null;
    const before = c.entities.length;
    c.entities = c.entities.filter((e) => !(e.kind === kind && e.value === value));
    if (c.entities.length !== before) {
      c.updatedAt = Date.now();
      await persist(all);
    }
    return c;
  });
}
