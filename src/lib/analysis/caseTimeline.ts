// ── Case timeline ────────────────────────────────────────────────────────────
// A chronological view of an investigation case: when it was opened and when
// each identifier was pinned to it. Pure derivation of the case's existing
// timestamps (createdAt + per-entity addedAt) — no new state, no clock reads.

import type { InvestigationCase, EntityKind } from "../types";

export interface TimelineEvent {
  /** Epoch ms. */
  at: number;
  type: "created" | "entity";
  /** Human label — "Case created" or the identifier value. */
  label: string;
  /** Present for `type === "entity"`: the identifier kind. */
  entityKind?: EntityKind;
}

/**
 * Chronological events for a case, oldest first: the "created" marker followed
 * by each pinned identifier in the order it was added. Sort is stable, so
 * entities sharing a timestamp keep their stored order.
 */
export function caseTimeline(c: InvestigationCase): TimelineEvent[] {
  const events: TimelineEvent[] = [{ at: c.createdAt, type: "created", label: "Case created" }];
  for (const e of c.entities) {
    events.push({ at: e.addedAt, type: "entity", label: e.value, entityKind: e.kind });
  }
  return events.sort((a, b) => a.at - b.at);
}
