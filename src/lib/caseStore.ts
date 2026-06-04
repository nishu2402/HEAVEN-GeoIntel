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
import type { InvestigationCase, CaseEntity, EntityKind } from "./types";

const DATA_DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "cases.json");

// Serialise writes so concurrent requests can't corrupt the file.
let writeChain: Promise<void> = Promise.resolve();

async function readAll(): Promise<InvestigationCase[]> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as InvestigationCase[]) : [];
  } catch {
    return [];
  }
}

async function writeAll(cases: InvestigationCase[]): Promise<void> {
  writeChain = writeChain.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    // Owner-only perms: this file holds investigation targets (PII).
    await fs.writeFile(FILE, JSON.stringify(cases, null, 2), { encoding: "utf8", mode: 0o600 });
    await fs.chmod(FILE, 0o600).catch(() => {});
  });
  return writeChain;
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
  const all = await readAll();
  const now = Date.now();
  const c: InvestigationCase = {
    id: randomUUID(),
    name: name.trim() || `Case ${new Date(now).toISOString().split("T")[0]}`,
    createdAt: now,
    updatedAt: now,
    entities: [],
    notes: "",
  };
  all.push(c);
  await writeAll(all);
  return c;
}

/** Wipe every case (the "delete all my data" action). Irreversible. */
export async function deleteAllCases(): Promise<void> {
  await writeAll([]);
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
    entities.push({ kind, value: v, addedAt: typeof e?.addedAt === "number" ? e.addedAt : now, note: e?.note });
  }
  const c: InvestigationCase = {
    id: randomUUID(),
    name: (input.name ?? "").trim() || `Imported ${new Date(now).toISOString().split("T")[0]}`,
    createdAt: now,
    updatedAt: now,
    entities,
    notes: (input.notes ?? "").slice(0, 20000),
  };
  all.push(c);
  await writeAll(all);
  return c;
}

export async function deleteCase(id: string): Promise<boolean> {
  const all = await readAll();
  const next = all.filter((c) => c.id !== id);
  if (next.length === all.length) return false;
  await writeAll(next);
  return true;
}

export async function renameCase(id: string, name: string): Promise<InvestigationCase | null> {
  const all = await readAll();
  const c = all.find((x) => x.id === id);
  if (!c) return null;
  c.name = name.trim() || c.name;
  c.updatedAt = Date.now();
  await writeAll(all);
  return c;
}

export async function setCaseNotes(id: string, notes: string): Promise<InvestigationCase | null> {
  const all = await readAll();
  const c = all.find((x) => x.id === id);
  if (!c) return null;
  c.notes = notes.slice(0, 20000);
  c.updatedAt = Date.now();
  await writeAll(all);
  return c;
}

export async function addEntity(id: string, kind: EntityKind, value: string, note?: string): Promise<InvestigationCase | null> {
  const all = await readAll();
  const c = all.find((x) => x.id === id);
  if (!c) return null;
  const v = value.trim();
  if (!v) return c;
  // de-dupe by kind+value
  if (!c.entities.some((e) => e.kind === kind && e.value === v)) {
    const entity: CaseEntity = { kind, value: v, addedAt: Date.now(), note };
    c.entities.push(entity);
    c.updatedAt = Date.now();
    await writeAll(all);
  }
  return c;
}

export async function removeEntity(id: string, kind: EntityKind, value: string): Promise<InvestigationCase | null> {
  const all = await readAll();
  const c = all.find((x) => x.id === id);
  if (!c) return null;
  const before = c.entities.length;
  c.entities = c.entities.filter((e) => !(e.kind === kind && e.value === value));
  if (c.entities.length !== before) {
    c.updatedAt = Date.now();
    await writeAll(all);
  }
  return c;
}
