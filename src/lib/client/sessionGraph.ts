// ── Session link graph persistence (client, localStorage) ────────────────────
// The Session Link Graph is built up as you run lookups — each result seeds it
// with the identifiers it derived. Persisting it here means a page reload (or
// returning later in the same browser) keeps the web of identifiers you've
// gathered instead of resetting to a blank canvas. Purely client-side and
// best-effort: never throws, SSR-safe (guards missing localStorage), capped, and
// validates every stored node so a corrupt/tampered value can't reach the graph.

import type { EntityKind } from "../types";
import type { GraphEntity } from "@/components/graph/LinkGraph";

const KEY = "hv-session-graph-v1";
const MAX = 200; // hard cap so the persisted graph can't grow unbounded
const VALID_KINDS = new Set<EntityKind>(["phone", "email", "username", "ip", "domain"]);

function isEntity(x: unknown): x is GraphEntity {
  if (typeof x !== "object" || x === null) return false;
  const e = x as Record<string, unknown>;
  return VALID_KINDS.has(e.kind as EntityKind) && typeof e.value === "string" && e.value.trim() !== "";
}

/** Read the persisted session graph. Returns [] on any error or missing store. */
export function getSessionGraph(): GraphEntity[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(arr)) return [];
    return arr.filter(isEntity).map((e) => ({ kind: e.kind, value: e.value }));
  } catch {
    return [];
  }
}

/** Persist the session graph (sanitised + capped). Best-effort; never throws. */
export function saveSessionGraph(entities: GraphEntity[]): void {
  try {
    const clean = entities.filter(isEntity).slice(0, MAX).map((e) => ({ kind: e.kind, value: e.value }));
    localStorage.setItem(KEY, JSON.stringify(clean));
  } catch {
    /* private mode / quota — persistence is best-effort */
  }
}

/** Forget the persisted session graph. */
export function clearSessionGraph(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
