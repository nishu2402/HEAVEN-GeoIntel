// ── Dataset overlay registry ─────────────────────────────────────────────────
//
// The five bundled datasets (country intel, NPA, MCC/MNC, disposable domains,
// username sites) used to be the only truth, so a stale area code or a new
// throwaway-mail provider meant editing TypeScript and rebuilding.
//
// An overlay is a JSON file under `.data/datasets/` that ADDS TO or OVERRIDES
// the bundled data at runtime. This module is the pure registry the data
// modules read from; `src/lib/server/datasets.ts` is what fills it from disk.
// Keeping the fs access out of here means the data modules stay importable from
// client components and the browser bundle is unaffected.

export type DatasetName =
  | "countryIntel"
  | "usNpa"
  | "mccMnc"
  | "disposableDomains"
  | "usernameSites";

export const DATASET_NAMES: DatasetName[] = [
  "countryIntel",
  "usNpa",
  "mccMnc",
  "disposableDomains",
  "usernameSites",
];

export interface OverlayMeta {
  /** Operator-supplied version string, e.g. "2026-07-01". */
  version?: string;
  /** How many entries the overlay contributed. */
  entries: number;
  /** Where it came from — for /api/datasets. */
  path?: string;
}

interface Slot {
  meta: OverlayMeta;
  /** Keyed overlays (countryIntel, usNpa, mccMnc). */
  records?: Record<string, unknown>;
  /** List overlays (disposableDomains, usernameSites). */
  list?: unknown[];
  /** Keys/values the overlay explicitly removes from the bundled data. */
  remove?: string[];
}

const slots = new Map<DatasetName, Slot>();

/** Install a keyed overlay — entries win over the bundled record of the same key. */
export function setRecordOverlay(
  name: DatasetName,
  records: Record<string, unknown>,
  meta: Omit<OverlayMeta, "entries">,
  remove: string[] = []
): void {
  slots.set(name, { records, remove, meta: { ...meta, entries: Object.keys(records).length } });
}

/** Install a list overlay — entries are appended to the bundled list. */
export function setListOverlay(
  name: DatasetName,
  list: unknown[],
  meta: Omit<OverlayMeta, "entries">,
  remove: string[] = []
): void {
  slots.set(name, { list, remove, meta: { ...meta, entries: list.length } });
}

/**
 * Resolve one key against the overlay.
 * Returns `undefined` when the overlay has nothing to say (fall back to
 * bundled), and `null` when the overlay explicitly removes the key.
 */
export function overlayLookup<T>(name: DatasetName, key: string): T | null | undefined {
  const slot = slots.get(name);
  if (!slot) return undefined;
  if (slot.remove?.includes(key)) return null;
  return slot.records?.[key] as T | undefined;
}

/** Extra list entries contributed by an overlay, for list-shaped datasets. */
export function overlayList<T>(name: DatasetName): T[] {
  return (slots.get(name)?.list as T[] | undefined) ?? [];
}

/** Values a list overlay removes from the bundled list. */
export function overlayRemovals(name: DatasetName): string[] {
  return slots.get(name)?.remove ?? [];
}

/** What is currently loaded, for /api/datasets. */
export function overlayMeta(name: DatasetName): OverlayMeta | null {
  return slots.get(name)?.meta ?? null;
}

/** Drop every overlay — used by tests and by a reload. */
export function clearOverlays(): void {
  slots.clear();
}
