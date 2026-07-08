// ── Case merge ───────────────────────────────────────────────────────────────
// Fold one investigation case's identifiers (and notes) into another. Pure
// derivation of the merged entity list + notes — the caller (caseStore) owns
// persistence and deleting the now-redundant source case. Entities are de-duped
// by kind+value (case-insensitive); when both cases hold the same identifier the
// earliest sighting wins (its addedAt and note are kept), so a merge never
// rewrites the original discovery time.

import type { CaseEntity, InvestigationCase } from "../types";

export interface MergedCaseData {
  entities: CaseEntity[];
  notes: string;
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
export function mergeCaseInto(target: InvestigationCase, source: InvestigationCase): MergedCaseData {
  const entities = mergeEntities(target.entities, source.entities);
  const srcNotes = (source.notes ?? "").trim();
  const tgtNotes = target.notes ?? "";
  if (!srcNotes) return { entities, notes: tgtNotes };
  const prefix = tgtNotes.trim() ? `${tgtNotes}\n\n` : "";
  return { entities, notes: `${prefix}— Merged from "${source.name}" —\n${srcNotes}` };
}
