// ── Case timeline ────────────────────────────────────────────────────────────
// A unified chronological view of an investigation case: when it was opened,
// when each identifier was pinned, when a relationship between two identifiers
// was derived, and when a lookup was snapshotted for later diffing. Pure
// derivation of the case's existing timestamps (createdAt · entity.addedAt ·
// edge.addedAt · snapshot.takenAt) — no new state, no clock reads.

import type { InvestigationCase, EntityKind } from "../types";

export interface TimelineEvent {
  /** Epoch ms. */
  at: number;
  type: "created" | "entity" | "edge" | "snapshot";
  /** Human label — "Case created", an identifier value, or "from → to". */
  label: string;
  /** Present for `entity` and `snapshot`: the identifier kind (drives the dot colour). */
  entityKind?: EntityKind;
  /** Present for `edge` (the derivation reason) and `snapshot` (a facts summary). */
  detail?: string;
  /** Present for `snapshot`: whether the underlying lookup was served from cache. */
  fromCache?: boolean;
}

/** Compact one-line summary of a snapshot's watched scalars. */
function snapshotSummary(facts: Record<string, number | string>): string {
  const entries = Object.entries(facts);
  if (entries.length === 0) return "no tracked facts";
  return entries.map(([k, v]) => `${k} ${v}`).join(" · ");
}

/**
 * Chronological events for a case, oldest first: the "created" marker, each
 * pinned identifier, each derived relationship, and each lookup snapshot, merged
 * and sorted by time. Sort is stable, so events sharing a timestamp keep their
 * stored order (created, then entities, then edges, then snapshots).
 */
export function caseTimeline(c: InvestigationCase): TimelineEvent[] {
  const events: TimelineEvent[] = [{ at: c.createdAt, type: "created", label: "Case created" }];
  for (const e of c.entities) {
    events.push({ at: e.addedAt, type: "entity", label: e.value, entityKind: e.kind });
  }
  for (const edge of c.edges ?? []) {
    events.push({ at: edge.addedAt, type: "edge", label: `${edge.from.value} → ${edge.to.value}`, detail: edge.reason });
  }
  for (const s of c.snapshots ?? []) {
    events.push({ at: s.takenAt, type: "snapshot", label: s.value, entityKind: s.kind, detail: snapshotSummary(s.facts), fromCache: s.fromCache });
  }
  return events.sort((a, b) => a.at - b.at);
}
