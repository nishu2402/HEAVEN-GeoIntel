// ── Cross-case entity correlation ────────────────────────────────────────────
// The investigation-platform view of the case store: which identifiers show up
// in more than one case. This is the "have I seen this before?" signal an
// analyst wants — a phone/email/IP that links three separate investigations is
// worth surfacing. Pure, offline, deterministic over the existing case data.

import type { InvestigationCase, EntityKind } from "../types";

export interface CaseRef {
  id: string;
  name: string;
}

export interface CorrelatedEntity {
  kind: EntityKind;
  value: string;
  /** The cases this entity appears in (>= 2), sorted by case name. */
  cases: CaseRef[];
  /** Number of distinct cases — always >= 2. */
  count: number;
}

/**
 * Find entities shared across two or more cases. Dedupe key is
 * `kind + lowercased value` (matching how the store dedupes within a case), and
 * the same entity appearing twice inside one case still counts that case once.
 * Results are sorted most-shared-first, then by value for a stable order.
 */
export function correlateCases(cases: InvestigationCase[]): CorrelatedEntity[] {
  const map = new Map<string, { kind: EntityKind; value: string; cases: Map<string, string> }>();

  for (const c of cases) {
    for (const e of c.entities) {
      const key = `${e.kind}:${e.value.toLowerCase()}`;
      let entry = map.get(key);
      if (!entry) {
        entry = { kind: e.kind, value: e.value, cases: new Map() };
        map.set(key, entry);
      }
      // Map keyed by case id → name, so one entity added twice in the same case
      // (or two entities that normalise to the same key) counts the case once.
      if (!entry.cases.has(c.id)) entry.cases.set(c.id, c.name);
    }
  }

  const out: CorrelatedEntity[] = [];
  for (const entry of map.values()) {
    if (entry.cases.size < 2) continue;
    const caseRefs = [...entry.cases.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    out.push({ kind: entry.kind, value: entry.value, cases: caseRefs, count: caseRefs.length });
  }

  out.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  return out;
}
