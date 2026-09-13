// ── "What changed since I last looked" ───────────────────────────────────────
//
// Monitoring stopped at a manual re-run: the snapshot history knew a breach
// count had grown, and nothing ever told anybody. The roadmap parked alerting
// because delivery needs a key — but delivery is the optional half. An inbox
// inside the tool needs no key at all, and it is what an analyst with twelve
// open cases actually wants: one list, newest first, of every fact that moved
// since they last marked it read.
//
// Pure and deterministic over the cases the store already holds. `reviewedAt`
// is per case: a change is unread when it happened after that mark.

import { diffFacts } from "./caseSnapshot";
import type { CaseSnapshot, EntityKind, InvestigationCase } from "../types";

/** One fact that moved between two consecutive snapshots of one identifier. */
export interface InboxChange {
  caseId: string;
  caseName: string;
  kind: EntityKind;
  value: string;
  /** When the newer snapshot was taken. */
  at: number;
  fact: string;
  from: number | string | null;
  to: number | string | null;
  /** True when either snapshot came from the result cache, so the diff is soft. */
  cacheInvolved: boolean;
  /** False when the change predates the case's `reviewedAt` mark. */
  unread: boolean;
}

export interface Inbox {
  changes: InboxChange[];
  unread: number;
  /** Cases with a single snapshot for an identifier: nothing to compare yet. */
  baselines: number;
}

function snapshotsByIdentifier(snapshots: CaseSnapshot[]): Map<string, CaseSnapshot[]> {
  const out = new Map<string, CaseSnapshot[]>();
  for (const s of snapshots) {
    const key = `${s.kind}:${s.value.toLowerCase()}`;
    const list = out.get(key) ?? [];
    if (list.length === 0) out.set(key, list);
    list.push(s);
  }
  return out;
}

/**
 * Every fact that moved across every case, newest first.
 *
 * A baseline (one snapshot, nothing to compare) is counted but never reported
 * as a change — "first observation" and "no change" are different statements,
 * and the panel says which.
 */
export function buildInbox(cases: InvestigationCase[]): Inbox {
  const changes: InboxChange[] = [];
  let baselines = 0;

  for (const c of cases) {
    const reviewedAt = c.reviewedAt ?? 0;
    for (const series of snapshotsByIdentifier(c.snapshots ?? []).values()) {
      if (series.length < 2) {
        baselines++;
        continue;
      }
      for (let i = 1; i < series.length; i++) {
        const prev = series[i - 1] as CaseSnapshot;
        const next = series[i] as CaseSnapshot;
        for (const change of diffFacts(prev.facts, next.facts)) {
          changes.push({
            caseId: c.id,
            caseName: c.name,
            kind: next.kind,
            value: next.value,
            at: next.takenAt,
            fact: change.fact,
            from: change.from,
            to: change.to,
            cacheInvolved: Boolean(prev.fromCache) || Boolean(next.fromCache),
            unread: next.takenAt > reviewedAt,
          });
        }
      }
    }
  }

  changes.sort((a, b) => b.at - a.at || a.fact.localeCompare(b.fact));
  return { changes, unread: changes.filter((c) => c.unread).length, baselines };
}

/**
 * A one-line summary per change, for a webhook body or a terminal digest.
 *
 * Deliberately plain text: whatever a webhook is pointed at, this is a
 * statement of what moved, not a rendering.
 */
export function describeChange(c: InboxChange): string {
  const from = c.from === null ? "not reported" : String(c.from);
  const to = c.to === null ? "not reported" : String(c.to);
  return `${c.caseName}: ${c.kind} ${c.value}, ${c.fact} ${from} → ${to}`;
}
