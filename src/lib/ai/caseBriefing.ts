// ── Case-level AI briefing (Phase 4) ─────────────────────────────────────────
//
// A whole-case read-out: how the case is composed, and what the on-device text
// model finds in the analyst's own notes. It reuses the Phase 2 model to extract
// any identifiers the notes mention and to label their topic, so a case that has
// grown large gets a one-glance summary. Pure and grounded: it counts what is
// already pinned and reads only the notes already written — it asserts nothing
// new about any subject.

import type { EntityKind, InvestigationCase } from "../types";
import { analyzeText, type TextInsights } from "./inference";

export interface EntityCount {
  kind: EntityKind;
  count: number;
}

export interface CaseBriefing {
  /** Pinned identifiers grouped by kind, most common first. */
  entityCounts: EntityCount[];
  total: number;
  /** The model's read of the case notes, or null when there are no notes. */
  notesInsights: TextInsights | null;
  /** Grounded summary lines for the panel. */
  lines: string[];
}

const plural = (n: number, one: string, many = `${one}s`): string => (n === 1 ? one : many);

/**
 * Summarise a case: its identifier composition plus what the model reads from
 * its notes. Takes only the fields it needs, so a caller can pass a whole case
 * or a lightweight stand-in.
 */
export function buildCaseBriefing(c: Pick<InvestigationCase, "entities" | "notes">): CaseBriefing {
  const counts = new Map<EntityKind, number>();
  for (const e of c.entities) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  const entityCounts: EntityCount[] = [...counts.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
  const total = c.entities.length;

  const notes = c.notes?.trim();
  const notesInsights = notes ? analyzeText(notes) : null;

  const lines: string[] = [];
  if (total === 0) {
    lines.push("This case has no identifiers pinned yet.");
  } else {
    const parts = entityCounts.map(({ kind, count }) => `${count} ${plural(count, kind)}`);
    lines.push(`This case holds ${total} ${plural(total, "identifier")}: ${parts.join(", ")}.`);
  }

  if (notesInsights) {
    const extracted = notesInsights.entities.length;
    if (extracted > 0) {
      lines.push(`The notes mention ${extracted} ${plural(extracted, "identifier")} the model can extract.`);
    }
    if (notesInsights.classification.category !== "neutral") {
      lines.push(`The notes read as ${notesInsights.classification.category}.`);
    }
  }

  lines.push("This briefing summarises what the case already contains; it asserts nothing new.");
  return { entityCounts, total, notesInsights, lines };
}
