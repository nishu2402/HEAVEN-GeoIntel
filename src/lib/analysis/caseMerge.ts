// ── Case merge ───────────────────────────────────────────────────────────────
// Fold one investigation case's identifiers (and notes) into another. Pure
// derivation of the merged entity list + notes — the caller (caseStore) owns
// persistence and deleting the now-redundant source case. Entities are de-duped
// by kind+value (case-insensitive); when both cases hold the same identifier the
// earliest sighting wins (its addedAt and note are kept), so a merge never
// rewrites the original discovery time.

import type { CaseEdge, CaseEntity, CaseSnapshot, InvestigationCase } from "../types";

export interface MergedCaseData {
  entities: CaseEntity[];
  notes: string;
  /** Derived relationships from both cases, de-duped on from+to+reason. */
  edges: CaseEdge[];
  /** Both histories interleaved by time, so a merged case still diffs correctly. */
  snapshots: CaseSnapshot[];
}

/**
 * Combine two entity lists, de-duping by kind+value (case-insensitive). When the
 * same identifier appears in both, the one with the earlier `addedAt` is kept.
 * Result is ordered oldest-first so the merged case reads as one timeline.
 */
export function mergeEntities(target: CaseEntity[], source: CaseEntity[]): CaseEntity[] {
  const byKey = new Map<string, CaseEntity>();
  for (const e of [...target, ...source]) {
    const key = `${e.kind}::${e.value.toLowerCase()}`;
    const existing = byKey.get(key);
    if (!existing || e.addedAt < existing.addedAt) byKey.set(key, e);
  }
  return [...byKey.values()].sort((a, b) => a.addedAt - b.addedAt);
}

/**
 * Merge the `source` case into `target`: combined entities plus the target's
 * notes with the source's notes appended under a labelled divider. The divider
 * is only added when the source actually has notes, so a merge never injects an
 * empty separator or a stray heading.
 */
export function mergeEdges(target: CaseEdge[] = [], source: CaseEdge[] = []): CaseEdge[] {
  const byKey = new Map<string, CaseEdge>();
  for (const e of [...target, ...source]) {
    const key = `${e.from.kind}:${e.from.value.toLowerCase()}|${e.to.kind}:${e.to.value.toLowerCase()}|${e.reason}`;
    const existing = byKey.get(key);
    if (!existing || e.addedAt < existing.addedAt) byKey.set(key, e);
  }
  return [...byKey.values()].sort((a, b) => a.addedAt - b.addedAt);
}

/**
 * Interleave both snapshot histories chronologically. Order matters: the diff
 * engine takes the LAST snapshot for an identifier as the previous state, so a
 * merged case whose histories were simply concatenated would compare against
 * whichever case happened to be the target.
 */
export function mergeSnapshots(target: CaseSnapshot[] = [], source: CaseSnapshot[] = []): CaseSnapshot[] {
  return [...target, ...source].sort((a, b) => a.takenAt - b.takenAt);
}

export function mergeCaseInto(target: InvestigationCase, source: InvestigationCase): MergedCaseData {
  const entities = mergeEntities(target.entities, source.entities);
  const edges = mergeEdges(target.edges, source.edges);
  const snapshots = mergeSnapshots(target.snapshots, source.snapshots);
  const srcNotes = (source.notes ?? "").trim();
  const tgtNotes = target.notes ?? "";
  if (!srcNotes) return { entities, edges, snapshots, notes: tgtNotes };
  const prefix = tgtNotes.trim() ? `${tgtNotes}\n\n` : "";
  return { entities, edges, snapshots, notes: `${prefix}[ Merged from "${source.name}" ]\n${srcNotes}` };
}
