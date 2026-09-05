// ── Vendored breach catalogs (HIBP + XposedOrNot + Wikipedia, keyless) ────────
//
// Local, refreshable snapshots of three PUBLIC breach catalogs, in two tiers:
//
//   RICH (credential) tier — HIBP's /api/v3/breaches (~1000 breaches) merged
//   with XposedOrNot's /v1/breaches (~780). Each row carries data classes,
//   record counts, dates and verified/quality flags. On a key collision the two
//   descriptions are UNIONED (see buildCatalogIndex), so a breach both catalogs
//   know ends up with the combined field set rather than one row winning and the
//   other's classes being discarded. These describe the consumer breaches the
//   free per-account indexes actually return for a person.
//
//   NOTABLE tier — Wikipedia's "List of data breaches", numeric record counts
//   only. These are large government / institutional breaches (population
//   registries, health ministries, tax authorities) that never entered a
//   credential corpus, so no keyless per-account source returns them and the
//   rich catalogs do not carry them. The tier has no data classes and no
//   domains, so it is kept SEPARATE and lower-priority: any notable key already
//   described richly is dropped from it, the rich lookup is tried first, and it
//   is counted apart from the rich set so the "describable breaches" figure
//   stays honest. It never overrides a credential row; it only fills a record
//   count and year for a breach some source named.
//
// The whole thing is the "self-hosted first, keys optional" half of the breach
// story:
//
//   • The free per-account indexes (XposedOrNot, LeakCheck) answer "is THIS
//     identifier breached", but LeakCheck returns a breach by NAME with no
//     detail. These catalogs describe that breach — its data classes, record
//     count and date — with no key and no request at lookup time.
//   • A catalog's OWN per-account endpoint needs a paid key (or, for Wikipedia,
//     does not exist), so this never asserts an identifier is in a breach. It
//     only DESCRIBES a breach another source already tied to the identifier.
//     That boundary is the whole reason the aggregator keeps `reportedBy` (who
//     attested presence) separate from enrichment (who described the breach).
//
// The snapshots are produced by `npm run breaches:refresh` and committed.
// Reading bundled files means enrichment works fully offline and a rate-limited
// upstream degrades to "last known", never "unavailable".
//
// This module is imported by server routes only, never by a client component,
// so the ~200 KB of snapshots stays out of the browser bundle.

import snapshot from "./breachCatalog.snapshot.json";
import xonSnapshot from "./xonCatalog.snapshot.json";
import wikipediaSnapshot from "./wikipediaBreaches.snapshot.json";
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
const xonData = xonSnapshot as Snapshot;
const wikipediaData = wikipediaSnapshot as Snapshot;

// The rich (credential) tier: both keyless catalogs, vendored in the same shape
// and merged into ONE index. HIBP is listed first so its (generally richer, more
// authoritative) identity wins a key collision; XposedOrNot then contributes the
// breaches HIBP omits — mostly regional leaks and combo/stealer lists — and on a
// collision the two descriptions are unioned. See buildCatalogIndex.
const richRawBreaches = (): RawCatalogEntry[] => [...data.breaches, ...xonData.breaches];

// The notable tier: Wikipedia's institutional breaches, record counts only.
const notableRawBreaches = (): RawCatalogEntry[] => [...wikipediaData.breaches];

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

/** Pick the more useful of two dates: the more precise, then the later. */
export function catalogMergeDate(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  if (b.length > a.length) return b; // "2013-10-04" beats "2013"
  return b > a ? b : a;
}

/**
 * Union two descriptions of the SAME breach. The earlier row (`a`, from the
 * catalog listed first) keeps its identity, and every field is filled to the
 * richer of the two: data classes are unioned, and a missing domain / date /
 * record count / verified flag is taken from the other row. Both rows describe
 * the same breach, so this only ever ADDS accurate detail, never invents any.
 */
export function mergeCatalogEntries(a: CatalogEntry, b: CatalogEntry): CatalogEntry {
  const classes = new Set(a.dataClasses);
  for (const c of b.dataClasses) classes.add(c);
  return {
    name: a.name || b.name,
    domain: a.domain ?? b.domain,
    date: catalogMergeDate(a.date, b.date),
    records: a.records ?? b.records,
    dataClasses: [...classes],
    verified: a.verified || b.verified,
  };
}

/**
 * Build the lookup index from raw rows. Pure and parameterized so the branch
 * behaviour (unkeyable rows, key collisions) is tested with crafted input
 * rather than depending on whatever the live catalog happens to contain today.
 * On a key collision the two descriptions are UNIONED, so no field one row
 * carried is lost to the other.
 */
export function buildCatalogIndex(rows: RawCatalogEntry[]): Map<string, CatalogEntry> {
  const m = new Map<string, CatalogEntry>();
  for (const raw of rows) {
    const entry = toCatalogEntry(raw);
    const key = breachKey(entry.name, entry.domain);
    if (!key) continue;
    const prev = m.get(key);
    m.set(key, prev ? mergeCatalogEntries(prev, entry) : entry);
  }
  return m;
}

/** Drop from `target` every key already present in `exclude`, and return it. */
export function subtractKeys(
  target: Map<string, CatalogEntry>, exclude: Map<string, CatalogEntry>,
): Map<string, CatalogEntry> {
  for (const key of [...target.keys()]) if (exclude.has(key)) target.delete(key);
  return target;
}

let richIndex: Map<string, CatalogEntry> | null = null;
let notableIndex: Map<string, CatalogEntry> | null = null;

function ensureRich(): Map<string, CatalogEntry> {
  return (richIndex ??= buildCatalogIndex(richRawBreaches()));
}

// The notable set, minus any key the rich tier already describes, so the two
// tiers never double-report a breach and the notable count is only the genuinely
// additional institutional breaches.
function ensureNotable(): Map<string, CatalogEntry> {
  return (notableIndex ??= subtractKeys(buildCatalogIndex(notableRawBreaches()), ensureRich()));
}

/**
 * The describe-by-key lookup used for enrichment: the rich tier answers first,
 * and the notable tier fills in only a breach the rich tier does not carry.
 * Pure and parameterized so both the hit and the fall-through are tested with
 * crafted maps.
 */
export function combinedLookup(
  rich: Map<string, CatalogEntry>, notable: Map<string, CatalogEntry>,
): (key: string) => CatalogEntry | undefined {
  return (key) => rich.get(key) ?? notable.get(key);
}

/**
 * The catalog as the aggregator consumes it: a keyed describe-by-key lookup.
 * The route passes this into `aggregateBreaches` to enrich the union.
 */
export function breachCatalog(): BreachCatalogLookup {
  return { lookup: combinedLookup(ensureRich(), ensureNotable()) };
}

/**
 * Snapshot provenance, for the UI note and /api/sources. `count` is the number
 * of DISTINCT breaches describable in the RICH tier (HIBP + XposedOrNot, with
 * data classes), so it reflects real enrichment coverage and is not inflated by
 * the class-less notable tier, which is reported separately as `notableCount`.
 * `version` tracks the HIBP snapshot, the primary catalog.
 */
export function catalogMeta(): { version: string | null; count: number; notableCount: number } {
  return { version: data.version, count: ensureRich().size, notableCount: ensureNotable().size };
}

/** A notable breach as the reference view shows it: record count and year only. */
export interface NotableBreach {
  name: string;
  records: number | null;
  date: string | null;
}

/**
 * Shape and sort the notable tier for the browsable reference: largest first,
 * name as the tiebreak, a missing count sinking to the bottom. Pure and
 * parameterized so the sort branches are tested with crafted entries rather than
 * whatever the live snapshot happens to hold. It drops the domain and data-class
 * fields deliberately: the notable tier never carries them, so the reference
 * shows only what it can honestly show — a name, a size and a year.
 */
export function toNotableList(entries: Iterable<CatalogEntry>): NotableBreach[] {
  const out: NotableBreach[] = [];
  for (const e of entries) out.push({ name: e.name, records: e.records, date: e.date });
  return out.sort((a, z) => (z.records ?? 0) - (a.records ?? 0) || a.name.localeCompare(z.name));
}

/**
 * The notable-breaches reference: the largest documented government and
 * institutional breaches from the Wikipedia catalog, largest first. Each carries
 * a record count and year only, describes an incident the credential indexes
 * never hold, and asserts nothing about any identifier. This backs the browsable
 * reference view, which is a directory of known breaches by size, not a lookup
 * result — so the "future notable-breaches view" the roadmap scoped this tier for
 * now exists, and the vendored rows are no longer dormant.
 */
export function notableBreaches(): NotableBreach[] {
  return toNotableList(ensureNotable().values());
}

/**
 * Provenance for the notable tier: the Wikipedia snapshot's revision id and the
 * count of genuinely-additional institutional breaches (those the rich tier does
 * not already describe). Symmetric with catalogMeta, for the reference route.
 */
export function notableMeta(): { version: string | null; count: number } {
  return { version: wikipediaData.version, count: ensureNotable().size };
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
  // Rich tier only: the notable tier carries no domains, so it would contribute
  // nothing to a domain match anyway.
  return filterCatalogByDomain(ensureRich().values(), domain);
}
