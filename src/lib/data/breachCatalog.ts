// ── Vendored breach catalog (Have I Been Pwned, public /api/v3/breaches) ──────
//
// A local, refreshable snapshot of HIBP's PUBLIC breach catalog — ~1000
// breaches with data classes, record counts, dates and verified/quality flags.
// It is the "self-hosted first, keys optional" half of the breach story:
//
//   • The free per-account indexes (XposedOrNot, LeakCheck) answer "is THIS
//     identifier breached", but LeakCheck returns a breach by NAME with no
//     detail. This catalog describes that breach — its data classes, record
//     count and date — with no key and no request at lookup time.
//   • The catalog's OWN per-account endpoint needs a paid key, so this never
//     asserts an identifier is in a breach. It only DESCRIBES a breach another
//     source already tied to the identifier. That boundary is the whole reason
//     the aggregator keeps `reportedBy` (who attested presence) separate from
//     enrichment (who described the breach).
//
// The snapshot is produced by `npm run breaches:refresh` and committed. Reading
// a bundled file means enrichment works fully offline and a rate-limited HIBP
// degrades to "last known", never "unavailable".
//
// This module is imported by server routes only, never by a client component,
// so the ~200 KB snapshot stays out of the browser bundle.

import snapshot from "./breachCatalog.snapshot.json";
import {
  breachKey, canonicalDataClass,
  type BreachDescription, type BreachCatalogLookup,
} from "../analysis/breachAggregate";

/** A described breach from the catalog. Extends what the aggregator reads. */
export interface CatalogEntry extends BreachDescription {
  name: string;
}

/** One row as it is stored in the vendored snapshot (flags omitted when false). */
export interface RawCatalogEntry {
  name?: string;
  title?: string;
  domain?: string | null;
  date?: string | null;
  pwnCount?: number | null;
  dataClasses?: string[];
  verified?: boolean;
  fabricated?: boolean;
  spamList?: boolean;
  malware?: boolean;
  stealerLog?: boolean;
  retired?: boolean;
}

interface Snapshot {
  source: string;
  version: string | null;
  count: number;
  breaches: RawCatalogEntry[];
}

const data = snapshot as Snapshot;

/** Canonicalize and dedupe a raw data-class list, dropping empties. */
export function catalogClasses(raw: string[] | undefined): string[] {
  const out = new Set<string>();
  for (const c of raw ?? []) {
    const k = canonicalDataClass(c);
    if (k) out.add(k);
  }
  return [...out];
}

/** Shape one raw snapshot row into a catalog entry. */
export function toCatalogEntry(r: RawCatalogEntry): CatalogEntry {
  return {
    name: r.title || r.name || "",
    domain: r.domain ?? null,
    date: r.date ?? null,
    records: typeof r.pwnCount === "number" ? r.pwnCount : null,
    dataClasses: catalogClasses(r.dataClasses),
    verified: r.verified === true,
  };
}

/**
 * Build the lookup index from raw rows. Pure and parameterized so the branch
 * behaviour (unkeyable rows, key collisions) is tested with crafted input
 * rather than depending on whatever the live catalog happens to contain today.
 * On a key collision the richer description wins (more data classes).
 */
export function buildCatalogIndex(rows: RawCatalogEntry[]): Map<string, CatalogEntry> {
  const m = new Map<string, CatalogEntry>();
  for (const raw of rows) {
    const entry = toCatalogEntry(raw);
    const key = breachKey(entry.name, entry.domain);
    if (!key) continue;
    const prev = m.get(key);
    if (!prev || entry.dataClasses.length > prev.dataClasses.length) m.set(key, entry);
  }
  return m;
}

let index: Map<string, CatalogEntry> | null = null;

function ensureIndex(): Map<string, CatalogEntry> {
  return (index ??= buildCatalogIndex(data.breaches));
}

/**
 * The catalog as the aggregator consumes it: a keyed describe-by-key lookup.
 * The route passes this into `aggregateBreaches` to enrich the union.
 */
export function breachCatalog(): BreachCatalogLookup {
  const idx = ensureIndex();
  return { lookup: (key) => idx.get(key) };
}

/** Snapshot provenance, for the UI note and /api/sources. */
export function catalogMeta(): { version: string | null; count: number } {
  return { version: data.version, count: data.count };
}

/** Sort a described-breach list newest first, name as tiebreak. */
const catalogDate = (e: CatalogEntry): string => e.date ?? "";

/**
 * Filter described breaches to those recorded for a domain (or a subdomain of
 * it), newest first. Pure and parameterized so the matching and sort branches
 * are tested with crafted entries rather than whatever the live catalog holds.
 */
export function filterCatalogByDomain(entries: Iterable<CatalogEntry>, domain: string): CatalogEntry[] {
  const d = domain.trim().toLowerCase().replace(/^www\./, "");
  if (!d) return [];
  const out: CatalogEntry[] = [];
  for (const e of entries) {
    const ed = (e.domain ?? "").toLowerCase();
    if (ed === d || ed.endsWith(`.${d}`)) out.push(e);
  }
  return out.sort((a, z) => catalogDate(z).localeCompare(catalogDate(a)) || a.name.localeCompare(z.name));
}

/**
 * Every catalog breach recorded for a domain. This is the honest keyless breach
 * view for domain mode: it reports breaches KNOWN to be associated with the
 * domain, not that the domain's users are compromised — a distinction the panel
 * makes in words.
 */
export function breachesForDomain(domain: string): CatalogEntry[] {
  return filterCatalogByDomain(ensureIndex().values(), domain);
}
