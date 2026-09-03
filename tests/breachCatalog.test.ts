import { describe, it, expect } from "vitest";
import {
  catalogClasses, toCatalogEntry, buildCatalogIndex, filterCatalogByDomain,
  breachCatalog, catalogMeta, breachesForDomain,
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

  it("keeps the richer description on a key collision", () => {
    const rows: RawCatalogEntry[] = [
      { name: "StockX", domain: "stockx.com", dataClasses: ["Email addresses"] },
      { name: "StockX", domain: "stockx.com", dataClasses: ["Email addresses", "Passwords"] },
    ];
    const m = buildCatalogIndex(rows);
    expect(m.size).toBe(1);
    expect(m.get(breachKey("StockX", "stockx.com"))?.dataClasses).toEqual(["Email addresses", "Passwords"]);
  });

  it("does not let a poorer later row overwrite a richer earlier one", () => {
    const rows: RawCatalogEntry[] = [
      { name: "Dup", domain: "dup.com", dataClasses: ["Email addresses", "Passwords"] },
      { name: "Dup", domain: "dup.com", dataClasses: ["Email addresses"] },
    ];
    const m = buildCatalogIndex(rows);
    expect(m.get(breachKey("Dup", "dup.com"))?.dataClasses).toEqual(["Email addresses", "Passwords"]);
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

  it("reports snapshot provenance", () => {
    const meta = catalogMeta();
    expect(meta.count).toBeGreaterThan(500);
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
    expect(hits.every((h) => (h.domain ?? "").endsWith("linkedin.com"))).toBe(true);
  });

  it("strips a www. prefix before matching", () => {
    expect(breachesForDomain("www.linkedin.com").length).toBe(breachesForDomain("linkedin.com").length);
  });
});
