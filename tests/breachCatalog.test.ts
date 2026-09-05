import { describe, it, expect } from "vitest";
import {
  catalogClasses, toCatalogEntry, buildCatalogIndex, filterCatalogByDomain,
  breachCatalog, catalogMeta, breachesForDomain,
  mergeCatalogEntries, catalogMergeDate, subtractKeys, combinedLookup,
  toNotableList, notableBreaches, notableMeta,
  type RawCatalogEntry, type CatalogEntry,
} from "@/lib/data/breachCatalog";
import { breachKey } from "@/lib/analysis/breachAggregate";

const entry = (o: Partial<CatalogEntry> = {}): CatalogEntry => ({
  name: "X", domain: "x.com", date: "2020-01-01", records: null,
  dataClasses: [], verified: false, ...o,
});

describe("catalogClasses", () => {
  it("canonicalizes, dedupes and drops empties", () => {
    expect(catalogClasses(["password", "Passwords", "", "  ", "Email addresses"]))
      .toEqual(["Passwords", "Email addresses"]);
  });
  it("treats a missing list as empty", () => {
    expect(catalogClasses(undefined)).toEqual([]);
  });
});

describe("toCatalogEntry", () => {
  it("prefers the title, falls back to name, then to empty", () => {
    expect(toCatalogEntry({ title: "T", name: "N" }).name).toBe("T");
    expect(toCatalogEntry({ title: "", name: "N" }).name).toBe("N");
    expect(toCatalogEntry({}).name).toBe("");
  });
  it("carries domain, date, records, verified and canonical classes", () => {
    const e = toCatalogEntry({
      name: "Adobe", domain: "adobe.com", date: "2013-10-04",
      pwnCount: 152_000_000, dataClasses: ["password"], verified: true,
    });
    expect(e).toEqual({
      name: "Adobe", domain: "adobe.com", date: "2013-10-04",
      records: 152_000_000, dataClasses: ["Passwords"], verified: true,
    });
  });
  it("defaults missing scalars to null / false", () => {
    const e = toCatalogEntry({ name: "X" });
    expect(e.domain).toBeNull();
    expect(e.date).toBeNull();
    expect(e.records).toBeNull();
    expect(e.verified).toBe(false);
  });
});

describe("buildCatalogIndex", () => {
  it("skips a row that cannot be keyed", () => {
    const m = buildCatalogIndex([{ name: "", domain: "" }]);
    expect(m.size).toBe(0);
  });

  it("unions data classes on a key collision", () => {
    const rows: RawCatalogEntry[] = [
      { name: "StockX", domain: "stockx.com", dataClasses: ["Email addresses"] },
      { name: "StockX", domain: "stockx.com", dataClasses: ["Email addresses", "Passwords"] },
    ];
    const m = buildCatalogIndex(rows);
    expect(m.size).toBe(1);
    expect(m.get(breachKey("StockX", "stockx.com"))?.dataClasses).toEqual(["Email addresses", "Passwords"]);
  });

  it("keeps every class when a later row is a subset of the earlier one", () => {
    const rows: RawCatalogEntry[] = [
      { name: "Dup", domain: "dup.com", dataClasses: ["Email addresses", "Passwords"] },
      { name: "Dup", domain: "dup.com", dataClasses: ["Email addresses"] },
    ];
    const m = buildCatalogIndex(rows);
    expect(m.get(breachKey("Dup", "dup.com"))?.dataClasses).toEqual(["Email addresses", "Passwords"]);
  });

  it("unions DISJOINT classes from two catalogs describing the same breach", () => {
    // The old richer-wins rule would have discarded one row's exclusive class;
    // the union keeps both, so a breach both catalogs know is described fully.
    const rows: RawCatalogEntry[] = [
      { name: "Merge", domain: "merge.com", dataClasses: ["Email addresses"] },
      { name: "Merge", domain: "merge.com", dataClasses: ["Passwords"] },
    ];
    const m = buildCatalogIndex(rows);
    expect(m.get(breachKey("Merge", "merge.com"))?.dataClasses).toEqual(["Email addresses", "Passwords"]);
  });
});

describe("catalogMergeDate", () => {
  it("takes the other date when one side is null", () => {
    expect(catalogMergeDate(null, "2020")).toBe("2020");
    expect(catalogMergeDate("2020", null)).toBe("2020");
    expect(catalogMergeDate(null, null)).toBeNull();
  });
  it("prefers the more precise date over a bare year", () => {
    expect(catalogMergeDate("2013", "2013-10-04")).toBe("2013-10-04");
  });
  it("prefers the later date when both are equally precise", () => {
    expect(catalogMergeDate("2019-01-01", "2021-05-05")).toBe("2021-05-05");
    expect(catalogMergeDate("2021-05-05", "2019-01-01")).toBe("2021-05-05");
  });
});

describe("mergeCatalogEntries", () => {
  const base = (o: Partial<CatalogEntry>): CatalogEntry => ({
    name: "", domain: null, date: null, records: null,
    dataClasses: [], verified: false, ...o,
  });

  it("keeps the first row's identity and fills every missing field from the second", () => {
    const a = base({ name: "A", domain: null, date: null, records: null, verified: false, dataClasses: ["Email addresses"] });
    const b = base({ name: "B", domain: "b.com", date: "2020-02-02", records: 42, verified: true, dataClasses: ["Passwords"] });
    expect(mergeCatalogEntries(a, b)).toEqual({
      name: "A", domain: "b.com", date: "2020-02-02", records: 42, verified: true,
      dataClasses: ["Email addresses", "Passwords"],
    });
  });

  it("keeps the first row's own fields when it already has them, and its name fallback", () => {
    const a = base({ name: "", domain: "a.com", date: "2018-01-01", records: 7, verified: true, dataClasses: [] });
    const b = base({ name: "B", domain: "b.com", date: "2019-01-01", records: 9, verified: false, dataClasses: ["Names"] });
    expect(mergeCatalogEntries(a, b)).toEqual({
      name: "B", domain: "a.com", date: "2019-01-01", records: 7, verified: true,
      dataClasses: ["Names"],
    });
  });
});

describe("subtractKeys", () => {
  const e = (name: string): CatalogEntry => ({
    name, domain: null, date: null, records: null, dataClasses: [], verified: false,
  });
  it("removes keys present in the exclude map and keeps the rest", () => {
    const target = new Map([["a", e("A")], ["b", e("B")], ["c", e("C")]]);
    const exclude = new Map([["b", e("B")], ["z", e("Z")]]);
    const out = subtractKeys(target, exclude);
    expect([...out.keys()].sort()).toEqual(["a", "c"]);
    expect(out).toBe(target); // mutates and returns the same map
  });
});

describe("combinedLookup", () => {
  const e = (name: string): CatalogEntry => ({
    name, domain: null, date: null, records: null, dataClasses: [], verified: false,
  });
  const rich = new Map([["r", e("Rich")]]);
  const notable = new Map([["n", e("Notable")]]);
  const lookup = combinedLookup(rich, notable);

  it("answers from the rich tier first", () => {
    expect(lookup("r")?.name).toBe("Rich");
  });
  it("falls through to the notable tier when the rich tier misses", () => {
    expect(lookup("n")?.name).toBe("Notable");
  });
  it("returns undefined when neither tier has the key", () => {
    expect(lookup("missing")).toBeUndefined();
  });
});

describe("breachCatalog + snapshot", () => {
  it("describes a well-known breach from the vendored snapshot", () => {
    const hit = breachCatalog().lookup(breachKey("Adobe", "adobe.com"));
    expect(hit).toBeTruthy();
    expect(hit?.domain).toBe("adobe.com");
    expect(hit?.records).toBeGreaterThan(1_000_000);
    expect(hit?.dataClasses).toContain("Passwords");
    expect(hit?.verified).toBe(true);
  });

  it("returns undefined for a key the catalog does not carry", () => {
    expect(breachCatalog().lookup("definitelynotarealbreachkey")).toBeUndefined();
  });

  it("describes a breach XposedOrNot carries that the HIBP snapshot omits", () => {
    // Flipkart is in XposedOrNot's catalog but not HIBP's. Merging both catalogs
    // must surface it, so a bare LeakCheck row named "Flipkart" gets enriched
    // with its data classes instead of showing as a detail-less name.
    const hit = breachCatalog().lookup(breachKey("Flipkart", "flipkart.com"));
    expect(hit).toBeTruthy();
    expect(hit?.domain).toBe("flipkart.com");
    expect(hit?.dataClasses).toContain("Email addresses");
  });

  it("reports snapshot provenance, counting the notable tier apart from the rich set", () => {
    const meta = catalogMeta();
    expect(meta.count).toBeGreaterThan(500);
    // The class-less notable (Wikipedia) tier is counted separately so it never
    // inflates the rich describable count.
    expect(meta.notableCount).toBeGreaterThan(0);
    expect(typeof meta.version === "string" || meta.version === null).toBe(true);
  });

  it("describes a notable institutional breach the credential catalogs omit", () => {
    // Capital One's 2019 breach is a large institutional incident carried by the
    // Wikipedia notable tier. Enrichment resolves it (record count) whether it is
    // served from the notable tier or, later, the rich tier — never fabricated.
    const hit = breachCatalog().lookup(breachKey("Capital One", null));
    expect(hit).toBeTruthy();
    expect(hit?.records).toBeGreaterThan(1_000_000);
  });
});

describe("toNotableList", () => {
  it("shapes entries to name/records/date, sorts largest first, ties by name, sinks null counts", () => {
    // Two null-count rows on purpose: comparing them to each other exercises the
    // nullish fallback on BOTH sides of the comparator in one call, and their
    // alphabetical order proves the name tiebreak still runs when counts are equal.
    const rows: CatalogEntry[] = [
      entry({ name: "Small", domain: null, records: 10, date: "2020", dataClasses: ["ignored"] }),
      entry({ name: "Big", domain: null, records: 1000, date: "2019" }),
      entry({ name: "Alpha", domain: null, records: 10, date: "2018" }),
      entry({ name: "NoCountZ", domain: null, records: null, date: null }),
      entry({ name: "NoCountA", domain: null, records: null, date: "2015" }),
    ];
    const out = toNotableList(rows);
    // largest first; the 10-record tie breaks alphabetically; null counts sink,
    // and the two of them order by name between themselves
    expect(out.map((b) => b.name)).toEqual(["Big", "Alpha", "Small", "NoCountA", "NoCountZ"]);
    // shape carries only name/records/date — no domain, no data classes leak in
    expect(out[0]).toEqual({ name: "Big", records: 1000, date: "2019" });
    expect(out[4]).toEqual({ name: "NoCountZ", records: null, date: null });
  });
});

describe("notableBreaches + notableMeta (over the snapshot)", () => {
  it("returns the institutional tier largest first", () => {
    const list = notableBreaches();
    expect(list.length).toBeGreaterThan(0);
    for (let i = 1; i < list.length; i++) {
      expect(list[i - 1].records ?? 0).toBeGreaterThanOrEqual(list[i].records ?? 0);
    }
  });

  it("carries a name, a record count and a year, but never data classes or a domain", () => {
    const sample = notableBreaches()[0];
    expect(typeof sample.name).toBe("string");
    expect(sample.records === null || typeof sample.records === "number").toBe(true);
    // The reference is deliberately class-less and domain-less.
    expect(Object.keys(sample).sort()).toEqual(["date", "name", "records"]);
  });

  it("reports provenance that agrees with the list length", () => {
    const meta = notableMeta();
    expect(meta.count).toBe(notableBreaches().length);
    expect(typeof meta.version === "string" || meta.version === null).toBe(true);
  });
});

describe("filterCatalogByDomain", () => {
  it("returns nothing for a blank domain", () => {
    expect(filterCatalogByDomain([entry()], "   ")).toEqual([]);
  });

  it("matches an exact domain and a subdomain, and ignores others", () => {
    const rows = [
      entry({ name: "Exact", domain: "acme.com" }),
      entry({ name: "Sub", domain: "mail.acme.com" }),
      entry({ name: "Other", domain: "notacme.com" }),
      entry({ name: "Nulld", domain: null }),
    ];
    expect(filterCatalogByDomain(rows, "acme.com").map((e) => e.name)).toEqual(["Exact", "Sub"]);
  });

  it("sorts newest first, breaks a date tie by name, and sinks undated ones", () => {
    const rows = [
      entry({ name: "Beta", domain: "acme.com", date: "2019-01-01" }),
      entry({ name: "Zulu", domain: "acme.com", date: "2021-01-01" }),
      entry({ name: "Alpha", domain: "acme.com", date: "2019-01-01" }),
      entry({ name: "Undated", domain: "acme.com", date: null }),
    ];
    expect(filterCatalogByDomain(rows, "acme.com").map((e) => e.name))
      .toEqual(["Zulu", "Alpha", "Beta", "Undated"]);
  });
});

describe("breachesForDomain (over the snapshot)", () => {
  it("finds the breaches recorded for a real domain", () => {
    const hits = breachesForDomain("linkedin.com");
    expect(hits.length).toBeGreaterThan(0);
    // Match on a host boundary, not a loose suffix: "evil-linkedin.com" ends with
    // "linkedin.com" but is a different registrable domain.
    expect(hits.every((h) => {
      const d = (h.domain ?? "").toLowerCase();
      return d === "linkedin.com" || d.endsWith(".linkedin.com");
    })).toBe(true);
  });

  it("strips a www. prefix before matching", () => {
    expect(breachesForDomain("www.linkedin.com").length).toBe(breachesForDomain("linkedin.com").length);
  });
});
