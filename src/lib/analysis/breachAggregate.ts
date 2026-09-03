// ── Unified breach view: one deduplicated list from every source ─────────────
//
// The tool queries several free breach indexes, and each one knows a different
// slice of the world. Measured against a single heavily-exposed address on
// 2026-09-02, XposedOrNot reported 212 breaches and LeakCheck reported 213, yet
// the two lists overlapped on only 12. Their union was 413. An analyst who read
// either panel alone, or the header stat (which counted XposedOrNot and nothing
// else), saw less than half of what the tool already knew.
//
// That is the whole reason this module exists. It takes the results the routes
// already fetched and folds them into ONE canonical, deduplicated list, so the
// headline number is the union across sources rather than one source's share of
// it. It adds no network call and invents no data: a breach appears here only
// because a source named it, and every entry records which sources did.
//
// Accuracy discipline (the project's no-false-positives rule):
//   • A source that failed or was rate-limited contributes nothing. Its absence
//     never reads as "clean" — the caller still shows that source's own error.
//   • Data classes are attributed per breach ONLY when a source reports them per
//     breach. XposedOrNot does; LeakCheck reports one field set aggregated over
//     all its matches, so those fields raise the aggregate-level flags but are
//     never pinned onto an individual LeakCheck breach they may not belong to.
//   • Passwords are marked on a breach only on positive evidence: a password
//     data class, a known password-risk grade, or a BreachDirectory hit.

import type {
  SourceResult, XposedOrNotData, LeakCheckData, BreachDirectoryData,
} from "../types";

/** One breach after merging everything the sources said about it. */
export interface AggregatedBreach {
  /** Best display name available (a source's own label). */
  name: string;
  /** Dedup key: brand without a trailing TLD, lowercased, alphanumerics only. */
  key: string;
  /** Registrable domain when a source gave one, else null. */
  domain: string | null;
  /** Best date available, as the source reported it (year, month or day). */
  date: string | null;
  /** Exposed data classes known for THIS breach, canonicalized and deduped. */
  dataClasses: string[];
  /** Records exposed, when a source counted them. */
  records: number | null;
  /** True only on positive evidence that passwords were in this breach. */
  password: boolean;
  /** True when at least one source marked the breach verified. */
  verified: boolean;
  /** Which providers named this breach, e.g. ["XposedOrNot", "LeakCheck"]. */
  reportedBy: string[];
  /**
   * True when the vendored breach catalog filled in fields (data classes,
   * record count, date) for a breach a source named without detail. Presence is
   * still asserted only by `reportedBy`; the catalog describes, it never attests
   * that this identifier is in the breach.
   */
  enriched: boolean;
}

/**
 * The minimal description the aggregator reads from a breach catalog. Kept here,
 * and abstract, so the aggregator never imports the vendored snapshot: the
 * catalog module implements this and the route passes it in. That keeps the
 * ~200 KB catalog out of the browser bundle and out of this module's tests.
 */
export interface BreachDescription {
  domain: string | null;
  date: string | null;
  records: number | null;
  dataClasses: string[];
  verified: boolean;
}

export interface BreachCatalogLookup {
  /** Describe a breach by its dedup key, or return undefined when unknown. */
  lookup(key: string): BreachDescription | undefined;
}

export interface BreachAggregate {
  /** The deduplicated breaches, newest first. */
  breaches: AggregatedBreach[];
  /** Union size. This is the number the header should show. */
  total: number;
  /** Providers that contributed at least one breach. */
  sourcesReporting: string[];
  /**
   * Providers that answered at all, including with zero hits. Lets the UI tell
   * a genuine "clean" (a source answered, nothing matched) apart from "we could
   * not ask" (every source failed), and never confuse the two.
   */
  sourcesAnswered: string[];
  /** Breaches with positive password evidence. */
  withPassword: number;
  /** Breaches at least one source marked verified. */
  verified: number;
  /** Every data class seen anywhere, canonicalized and deduped. */
  dataClasses: string[];
  /** Earliest / latest dated breach (YYYY... strings), or null. */
  firstBreach: string | null;
  lastBreach: string | null;
  /** Dated breaches bucketed by calendar year, oldest first — for the timeline. */
  timeline: { year: string; count: number }[];
  /** How many breaches the vendored catalog enriched (0 when no catalog given). */
  enrichedCount: number;
  /**
   * True when a source reported a password field somewhere in its set without
   * pinning it to one breach (LeakCheck's aggregated fields). Lets the UI say
   * "password fields appear in this set" without a per-breach false positive.
   */
  passwordFieldsSeen: boolean;
}

const PROVIDER = {
  xon: "XposedOrNot",
  leakCheck: "LeakCheck",
  breachDirectory: "BreachDirectory",
} as const;

/** Trailing labels we strip so "StockX" and "StockX.com" share a key. */
const TLDS = new Set([
  "com", "net", "org", "io", "co", "ru", "info", "biz", "us", "uk", "de",
  "fr", "in", "gov", "edu", "me", "tv", "cc", "xyz", "app", "online", "site",
]);

function stripTld(label: string): string {
  const dot = label.lastIndexOf(".");
  if (dot > 0 && TLDS.has(label.slice(dot + 1).toLowerCase())) return label.slice(0, dot);
  return label;
}

/**
 * A stable identity for a breach across sources. Domain wins when present
 * because it is less ambiguous than a hand-typed name; otherwise the name is
 * reduced to its brand. Returns "" only for an empty input, which the caller
 * skips.
 */
export function breachKey(name: string, domain: string | null | undefined): string {
  const base = (domain && domain.trim()) || name;
  return stripTld(base.trim().toLowerCase()).replace(/[^a-z0-9]/g, "");
}

/** Canonical spelling for a data class, so the union does not list two casings. */
const DATA_CLASS_CANON: Record<string, string> = {
  password: "Passwords", passwords: "Passwords",
  email: "Email addresses", emails: "Email addresses", "email address": "Email addresses",
  "email addresses": "Email addresses",
  // XposedOrNot ships a truncated "ail addresses" for some breaches; it is an
  // unambiguous mangling of "Email addresses", so fold it back rather than
  // showing a junk chip next to the correct one.
  "ail addresses": "Email addresses",
  username: "Usernames", usernames: "Usernames", profile_name: "Usernames",
  name: "Names", names: "Names", first_name: "Names", last_name: "Names", middle_name: "Names",
  phone: "Phone numbers", "phone number": "Phone numbers", "phone numbers": "Phone numbers",
  address: "Physical addresses", "physical address": "Physical addresses",
  "physical addresses": "Physical addresses", zip: "Physical addresses",
  city: "Geographic locations", state: "Geographic locations", country: "Geographic locations",
  "geographic location": "Geographic locations", "geographic locations": "Geographic locations",
  ip: "IP addresses", ip1: "IP addresses", ip2: "IP addresses", "ip address": "IP addresses",
  "ip addresses": "IP addresses",
  dob: "Dates of birth", "date of birth": "Dates of birth", "dates of birth": "Dates of birth",
  ssn: "Social security numbers", "social security number": "Social security numbers",
  gender: "Genders", genders: "Genders",
};

export function canonicalDataClass(raw: string): string {
  const k = raw.trim().toLowerCase();
  if (!k) return "";
  if (DATA_CLASS_CANON[k]) return DATA_CLASS_CANON[k];
  return raw.trim().replace(/\s+/g, " ");
}

function canonList(values: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const v of values) {
    const c = canonicalDataClass(v);
    if (c) out.add(c);
  }
  return [...out];
}

const hasPasswordClass = (classes: string[]): boolean =>
  classes.some((c) => c.toLowerCase().includes("password"));

/** A mutable accumulator keyed by breach identity. */
interface Bucket {
  name: string;
  key: string;
  domain: string | null;
  date: string | null;
  dataClasses: Set<string>;
  records: number | null;
  password: boolean;
  verified: boolean;
  reportedBy: Set<string>;
  enriched: boolean;
}

/** Pick the more useful of two dates, preferring the more precise, then later. */
function betterDate(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  if (b.length > a.length) return b; // "2013-10-04" beats "2013"
  return b > a ? b : a;
}

/**
 * Fold every source's breaches into one deduplicated list. Pure: the same
 * inputs always yield the same output, and no source's failure is ever read as
 * an empty result.
 */
export function aggregateBreaches(
  sources: {
    xon?: SourceResult<XposedOrNotData>;
    leakCheck?: SourceResult<LeakCheckData>;
    breachDirectory?: SourceResult<BreachDirectoryData>;
  },
  catalog?: BreachCatalogLookup,
): BreachAggregate {
  const buckets = new Map<string, Bucket>();
  const contributed = new Set<string>();
  const answered = new Set<string>();
  // LeakCheck's fields are not tied to one breach, so they widen the set-level
  // data-class union without being pinned to any single entry.
  const unionExtra = new Set<string>();
  let passwordFieldsSeen = false;

  const add = (
    provider: string,
    name: string,
    domain: string | null,
    date: string | null,
    classes: string[],
    records: number | null,
    password: boolean,
    verified: boolean,
  ): void => {
    const key = breachKey(name, domain);
    if (!key) return;
    contributed.add(provider);
    const found = buckets.get(key);
    if (!found) {
      buckets.set(key, {
        name, key, domain: domain || null, date,
        dataClasses: new Set(classes), records,
        password, verified, reportedBy: new Set([provider]), enriched: false,
      });
      return;
    }
    // Merge into the existing bucket, keeping the richest of each field.
    found.reportedBy.add(provider);
    found.domain = found.domain ?? (domain || null);
    found.date = betterDate(found.date, date);
    // Only XposedOrNot carries a count and it is folded in first, so a later
    // source can fill a missing count but never overwrite a known one.
    found.records = found.records ?? records;
    found.password = found.password || password;
    found.verified = found.verified || verified;
    for (const c of classes) found.dataClasses.add(c);
  };

  // XposedOrNot — the richest source: per-breach data classes, dates, records.
  const xon = sources.xon;
  if (xon?.ok && xon.data) {
    answered.add(PROVIDER.xon);
    for (const b of xon.data.breaches) {
      const classes = canonList(b.xposedData);
      const pw = hasPasswordClass(classes) ||
        (b.passwordRisk !== "" && b.passwordRisk.toLowerCase() !== "unknown");
      add(PROVIDER.xon, b.breach, b.domain || null, b.xposedDate || null,
        classes, b.xposedRecords || null, pw, b.verified);
    }
  }

  // LeakCheck — names and dates per breach; fields only in aggregate, so they
  // raise the set-level flag but are not attributed to any single breach.
  const lc = sources.leakCheck;
  if (lc?.ok && lc.data) {
    answered.add(PROVIDER.leakCheck);
    const lcFields = canonList(lc.data.fields);
    if (hasPasswordClass(lcFields)) passwordFieldsSeen = true;
    for (const s of lc.data.sources) {
      add(PROVIDER.leakCheck, s.name, null, s.date, [], null, false, false);
    }
    // Fold LeakCheck's aggregate fields into the union without pinning them.
    for (const f of lcFields) unionExtra.add(f);
  }

  // BreachDirectory — named credential sources; a hit is password evidence.
  const bd = sources.breachDirectory;
  if (bd?.ok && bd.data) {
    answered.add(PROVIDER.breachDirectory);
    if (bd.data.found > 0) {
      for (const name of bd.data.sources ?? []) {
        add(PROVIDER.breachDirectory, name, null, null, ["Passwords"], null, true, false);
      }
    }
  }

  // Enrichment — the vendored breach catalog fills in what a source named but
  // did not describe. It runs AFTER dedup, on the merged buckets, so a single
  // catalog hit enriches a breach no matter which sources reported it. It never
  // adds a bucket (a breach the catalog knows but no source returned is not this
  // identifier's breach) and never touches `reportedBy` (the catalog describes,
  // it does not attest presence). A catalog "Passwords" class IS password
  // evidence for a breach a source has already tied to this identifier.
  let enrichedCount = 0;
  if (catalog) {
    for (const b of buckets.values()) {
      const hit = catalog.lookup(b.key);
      if (!hit) continue;
      b.enriched = true;
      enrichedCount++;
      b.domain = b.domain ?? hit.domain;
      b.date = betterDate(b.date, hit.date);
      b.records = b.records ?? hit.records;
      b.verified = b.verified || hit.verified;
      for (const c of hit.dataClasses) b.dataClasses.add(c);
      if (!b.password && hasPasswordClass([...b.dataClasses])) b.password = true;
    }
  }

  const dateKey = (b: AggregatedBreach): string => b.date ?? "";
  const breaches: AggregatedBreach[] = [...buckets.values()]
    .map((b) => ({
      name: b.name, key: b.key, domain: b.domain, date: b.date,
      dataClasses: [...b.dataClasses], records: b.records,
      password: b.password, verified: b.verified,
      reportedBy: [...b.reportedBy].sort(), enriched: b.enriched,
    }))
    .sort((a, z) => dateKey(z).localeCompare(dateKey(a)) || a.name.localeCompare(z.name));

  const dataClasses = canonList([
    ...breaches.flatMap((b) => b.dataClasses),
    ...unionExtra,
  ]);
  const dated = breaches.map((b) => b.date).filter((d): d is string => !!d).sort();

  // Timeline: count dated breaches per calendar year, oldest first. A date is
  // "YYYY", "YYYY-MM" or "YYYY-MM-DD", so the year is always the first four
  // characters. Undated breaches (no source gave a date, and the catalog had
  // none) are simply absent from the timeline rather than bucketed as a guess.
  const byYear = new Map<string, number>();
  for (const d of dated) {
    const year = d.slice(0, 4);
    byYear.set(year, (byYear.get(year) ?? 0) + 1);
  }
  const timeline = [...byYear.entries()]
    .map(([year, count]) => ({ year, count }))
    .sort((a, z) => a.year.localeCompare(z.year));

  return {
    breaches,
    total: breaches.length,
    sourcesReporting: [...contributed].sort(),
    sourcesAnswered: [...answered].sort(),
    withPassword: breaches.filter((b) => b.password).length,
    verified: breaches.filter((b) => b.verified).length,
    dataClasses,
    firstBreach: dated[0] ?? null,
    lastBreach: dated[dated.length - 1] ?? null,
    timeline,
    enrichedCount,
    passwordFieldsSeen,
  };
}
