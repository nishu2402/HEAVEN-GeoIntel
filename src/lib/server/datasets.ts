// ── Dataset overlay loader ───────────────────────────────────────────────────
//
// Reads `.data/datasets/<name>.json` and installs it into the pure overlay
// registry, so the bundled datasets can be corrected or extended on a running
// instance instead of requiring a code edit and a rebuild.
//
// File format (every field optional except the payload):
//
//   {
//     "version": "2026-07-01",
//     "entries": { "628": { ...NpaInfo } }   // keyed datasets
//     "entries": ["burner.example"]          // list datasets
//     "remove":  ["555"]                     // drop bundled entries
//   }
//
// A malformed or unreadable file is IGNORED with a warning: a bad overlay must
// degrade to the bundled data, never take the tool down. Overlays are operator
// files under the app's own data dir — the same trust level as .env.local.

import { promises as fs } from "node:fs";
import path from "node:path";
import { dataDir } from "./dataDir";
import {
  DATASET_NAMES,
  clearOverlays,
  overlayMeta,
  setListOverlay,
  setRecordOverlay,
  type DatasetName,
  type OverlayMeta,
} from "../data/overlay";

const datasetDir = () => path.join(dataDir(), "datasets");

/** Datasets whose payload is a list rather than a keyed record. */
const LIST_DATASETS = new Set<DatasetName>(["disposableDomains", "usernameSites"]);

interface OverlayFile {
  version?: unknown;
  entries?: unknown;
  remove?: unknown;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

async function loadOne(name: DatasetName): Promise<string | null> {
  const file = path.join(datasetDir(), `${name}.json`);
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    return null; // no overlay for this dataset — the normal case
  }

  let parsed: OverlayFile;
  try {
    parsed = JSON.parse(raw) as OverlayFile;
  } catch {
    return `${name}: not valid JSON`;
  }
  if (!parsed || typeof parsed !== "object") return `${name}: expected a JSON object`;

  const version = typeof parsed.version === "string" ? parsed.version : undefined;
  const remove = asStringArray(parsed.remove);
  const meta = { version, path: file };

  if (LIST_DATASETS.has(name)) {
    if (!Array.isArray(parsed.entries)) return `${name}: "entries" must be an array`;
    // usernameSites entries are objects the sweep will act on, so validate the
    // shape rather than trusting the file — a bad entry would otherwise produce
    // a bogus "found" claim, which is the one thing this tool must never do.
    const entries =
      name === "usernameSites" ? parsed.entries.filter(isValidSite) : asStringArray(parsed.entries);
    setListOverlay(name, entries, meta, remove);
    return null;
  }

  if (!parsed.entries || typeof parsed.entries !== "object" || Array.isArray(parsed.entries)) {
    return `${name}: "entries" must be an object`;
  }
  setRecordOverlay(name, parsed.entries as Record<string, unknown>, meta, remove);
  return null;
}

function isValidSite(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") return false;
  const s = entry as Record<string, unknown>;
  if (typeof s.name !== "string" || !s.name.trim()) return false;
  if (typeof s.url !== "string" || !s.url.includes("{u}")) return false;
  if (typeof s.category !== "string") return false;
  if (s.check !== "status" && s.check !== "body" && s.check !== "manual") return false;
  // A "body" check is only meaningful with an absence marker; without one the
  // site would be claimed FOUND for every handle.
  if (s.check === "body" && typeof s.absence !== "string") return false;
  return true;
}

let loaded: Promise<string[]> | null = null;

/**
 * Load every overlay once per process. Routes call this before touching a
 * dataset; repeat calls reuse the same promise.
 */
export function ensureDatasets(): Promise<string[]> {
  loaded ??= (async () => {
    const warnings: string[] = [];
    for (const name of DATASET_NAMES) {
      const problem = await loadOne(name);
      if (problem) warnings.push(problem);
    }
    /* v8 ignore next 3 -- console noise is environment-only; the warnings array
       is what the tests and /api/datasets assert on. */
    if (warnings.length > 0) {
      console.warn(`[datasets] ignoring bad overlay(s): ${warnings.join("; ")}`);
    }
    return warnings;
  })();
  return loaded;
}

/** Re-read overlays from disk — used after an operator edits a file, and by tests. */
export async function reloadDatasets(): Promise<string[]> {
  clearOverlays();
  loaded = null;
  return ensureDatasets();
}

export interface DatasetStatus {
  name: DatasetName;
  /** Whether an overlay is installed for this dataset. */
  overlay: OverlayMeta | null;
}

/** What is loaded right now, for GET /api/datasets. */
export async function datasetStatus(): Promise<{ dir: string; datasets: DatasetStatus[]; warnings: string[] }> {
  const warnings = await ensureDatasets();
  return {
    dir: datasetDir(),
    datasets: DATASET_NAMES.map((name) => ({ name, overlay: overlayMeta(name) })),
    warnings,
  };
}
