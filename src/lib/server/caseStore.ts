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
import type { InvestigationCase, CaseEntity, EntityKind } from "../types";

// Resolved lazily so HV_DATA_DIR can redirect state (used by tests for a
// hermetic temp dir, and by deploys that keep data outside the app directory).
// Defaults to ./.data under the process cwd — unchanged behaviour when unset.
const dataDir = () => process.env.HV_DATA_DIR || path.join(process.cwd(), ".data");
const casesFile = () => path.join(dataDir(), "cases.json");

// Length caps so a malformed/abusive request can't bloat the on-disk store.
const MAX_NAME = 200;
const MAX_VALUE = 512;
const MAX_ENTITY_NOTE = 2000;
const MAX_NOTES = 20000;
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
    const c: InvestigationCase = {
      id: randomUUID(),
      name: cap((input.name ?? "").trim(), MAX_NAME) || `Imported ${new Date(now).toISOString().split("T")[0]}`,
      createdAt: now,
      updatedAt: now,
      entities,
      notes: cap(input.notes ?? "", MAX_NOTES),
    };
    all.push(c);
    await persist(all);
    return c;
  });
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
