import { describe, it, expect } from "vitest";
import { aggregateBreaches, breachKey, canonicalDataClass } from "@/lib/analysis/breachAggregate";
import type { BreachCatalogLookup, BreachDescription } from "@/lib/analysis/breachAggregate";
import type {
  SourceResult, XposedOrNotData, LeakCheckData, BreachDirectoryData, XposedOrNotBreach,
} from "@/lib/types";

const ok = <T,>(data: T): SourceResult<T> => ({ ok: true, data });
const fail = (error = "boom"): SourceResult<never> => ({ ok: false, error });

const xonBreach = (o: Partial<XposedOrNotBreach> = {}): XposedOrNotBreach => ({
  breach: "LinkedIn", xposedData: ["Passwords", "Email addresses"], xposedDate: "2013-10-04",
  xposedRecords: 164_000_000, domain: "linkedin.com", passwordRisk: "ClearText", verified: true, ...o,
});

const xon = (breaches: XposedOrNotBreach[]): SourceResult<XposedOrNotData> =>
  ok({ breachCount: breaches.length, breaches, xposedDataTypes: [], yearwiseDetails: {} });

const leak = (
  sources: { name: string; date: string | null }[], fields: string[] = [],
): SourceResult<LeakCheckData> =>
  ok({ found: sources.length, fields, sources });

const bd = (sources: string[], found = sources.length): SourceResult<BreachDirectoryData> =>
  ok({ found, fields: ["password"], sources, results: [] });

describe("breachKey", () => {
  it("strips a trailing TLD so a brand and its domain share a key", () => {
    expect(breachKey("StockX", null)).toBe("stockx");
    expect(breachKey("StockX.com", null)).toBe("stockx");
    expect(breachKey("Whatever", "stockx.com")).toBe("stockx");
  });
  it("keeps a name that has no dot", () => {
    expect(breachKey("Cit0day", null)).toBe("cit0day");
  });
  it("keeps a dotted name whose last label is not a known TLD", () => {
    expect(breachKey("Some.Thing", null)).toBe("something");
  });
  it("is empty for an empty identifier", () => {
    expect(breachKey("", null)).toBe("");
    expect(breachKey("   ", undefined)).toBe("");
  });
});

describe("canonicalDataClass", () => {
  it("maps known field spellings to one canonical label", () => {
    expect(canonicalDataClass("password")).toBe("Passwords");
    expect(canonicalDataClass("Passwords")).toBe("Passwords");
    expect(canonicalDataClass("ip1")).toBe("IP addresses");
    expect(canonicalDataClass("dob")).toBe("Dates of birth");
    expect(canonicalDataClass("ail addresses")).toBe("Email addresses"); // XON truncation
  });
  it("passes an unknown class through, trimmed", () => {
    expect(canonicalDataClass("  Titles ")).toBe("Titles");
  });
  it("is empty for whitespace", () => {
    expect(canonicalDataClass("   ")).toBe("");
  });
});

describe("aggregateBreaches: union across sources", () => {
  it("returns an empty aggregate when every source failed or is absent", () => {
    const a = aggregateBreaches({ xon: fail(), leakCheck: fail("RATE_LIMITED"), breachDirectory: undefined });
    expect(a.total).toBe(0);
    expect(a.breaches).toEqual([]);
    expect(a.sourcesReporting).toEqual([]);
    expect(a.sourcesAnswered).toEqual([]);
    expect(a.dataClasses).toEqual([]);
    expect(a.firstBreach).toBeNull();
    expect(a.lastBreach).toBeNull();
    expect(a.passwordFieldsSeen).toBe(false);
  });

  it("unions two almost-disjoint sources instead of showing one", () => {
    const a = aggregateBreaches({
      xon: xon([xonBreach({ breach: "XonOnly", domain: "xononly.com", xposedDate: "2019-01" })]),
      leakCheck: leak([{ name: "LeakOnly.com", date: "2020-05" }], ["password", "phone"]),
    });
    expect(a.total).toBe(2);
    expect(a.sourcesReporting).toEqual(["LeakCheck", "XposedOrNot"]);
    expect(a.sourcesAnswered).toEqual(["LeakCheck", "XposedOrNot"]);
    expect(a.breaches.map((b) => b.name)).toEqual(["LeakOnly.com", "XonOnly"]); // newest first
    expect(a.passwordFieldsSeen).toBe(true); // LeakCheck's aggregate fields carried a password
    expect(a.dataClasses).toContain("Phone numbers");
  });

  it("merges the same breach reported by several providers into one row", () => {
    const a = aggregateBreaches({
      xon: xon([xonBreach({ breach: "LinkedIn", domain: "linkedin.com", xposedDate: "2013-10-04" })]),
      leakCheck: leak([{ name: "LinkedIn.com", date: "2012" }]),
      breachDirectory: bd(["LinkedIn"]),
    });
    expect(a.total).toBe(1);
    const b = a.breaches[0];
    expect(b.reportedBy).toEqual(["BreachDirectory", "LeakCheck", "XposedOrNot"]);
    expect(b.date).toBe("2013-10-04"); // the precise date beats the year-only one
    expect(b.password).toBe(true);
    expect(b.verified).toBe(true);
  });

  it("marks a password on grade evidence even without a password data class", () => {
    const a = aggregateBreaches({
      xon: xon([xonBreach({
        breach: "Graded", domain: "graded.com", xposedData: ["Email addresses"],
        passwordRisk: "EasyToCrack", verified: false,
      })]),
    });
    expect(a.breaches[0].password).toBe(true);
    expect(a.withPassword).toBe(1);
    expect(a.verified).toBe(0);
  });

  it("does not mark a password when the grade is unknown and no class says so", () => {
    const a = aggregateBreaches({
      xon: xon([xonBreach({
        breach: "Clean", domain: "clean.com", xposedData: ["Email addresses"],
        passwordRisk: "Unknown",
      })]),
    });
    expect(a.breaches[0].password).toBe(false);
    expect(a.passwordFieldsSeen).toBe(false);
  });

  it("skips BreachDirectory when it found nothing but records that it answered", () => {
    const a = aggregateBreaches({ breachDirectory: bd([], 0) });
    expect(a.total).toBe(0);
    expect(a.sourcesReporting).toEqual([]);
    expect(a.sourcesAnswered).toEqual(["BreachDirectory"]);
  });

  it("keeps the larger record count and fills a domain on merge", () => {
    const a = aggregateBreaches({
      xon: xon([xonBreach({ breach: "Recs", domain: "recs.com", xposedRecords: 100, xposedDate: "2018-06" })]),
      leakCheck: leak([{ name: "Recs.com", date: "2018-06" }]),
    });
    // leakCheck adds no records; xon's 100 stands.
    expect(a.breaches[0].records).toBe(100);
    expect(a.breaches[0].domain).toBe("recs.com");
  });

  it("takes the more precise date when a later source is more specific", () => {
    const a = aggregateBreaches({
      xon: xon([xonBreach({ breach: "Adobe", domain: "adobe.com", xposedDate: "2013" })]),
      leakCheck: leak([{ name: "Adobe.com", date: "2013-10-04" }]),
    });
    expect(a.breaches[0].date).toBe("2013-10-04");
  });

  it("takes the later date when two are equally precise", () => {
    const later = aggregateBreaches({
      xon: xon([xonBreach({ breach: "Foo", domain: "foo.com", xposedDate: "2019-01" })]),
      leakCheck: leak([{ name: "Foo.com", date: "2019-05" }]),
    });
    expect(later.breaches[0].date).toBe("2019-05");
    const earlier = aggregateBreaches({
      xon: xon([xonBreach({ breach: "Bar", domain: "bar.com", xposedDate: "2020-06" })]),
      leakCheck: leak([{ name: "Bar.com", date: "2020-01" }]),
    });
    expect(earlier.breaches[0].date).toBe("2020-06");
  });

  it("handles a null date on the first source and a null-date merge", () => {
    const a = aggregateBreaches({
      leakCheck: leak([{ name: "NoDate", date: null }]),
      breachDirectory: bd(["NoDate"]),
    });
    expect(a.total).toBe(1);
    expect(a.breaches[0].date).toBeNull();
    expect(a.breaches[0].reportedBy).toEqual(["BreachDirectory", "LeakCheck"]);
  });

  it("computes the first and last dated breach and the data-class union", () => {
    const a = aggregateBreaches({
      xon: xon([
        xonBreach({ breach: "Early", domain: "early.com", xposedDate: "2011-01", xposedData: ["Names"] }),
        xonBreach({ breach: "Late", domain: "late.com", xposedDate: "2024-12", xposedData: ["Passwords"] }),
      ]),
    });
    expect(a.firstBreach).toBe("2011-01");
    expect(a.lastBreach).toBe("2024-12");
    expect(a.dataClasses.sort()).toEqual(["Names", "Passwords"]);
  });


  it("treats an empty password grade as no evidence", () => {
    const a = aggregateBreaches({
      xon: xon([xonBreach({
        breach: "Blank", domain: "blank.com", xposedData: ["Email addresses"], passwordRisk: "",
      })]),
    });
    expect(a.breaches[0].password).toBe(false);
  });

  it("breaks a date tie by name and sorts undated breaches last", () => {
    const a = aggregateBreaches({
      xon: xon([
        xonBreach({ breach: "Bravo", domain: "bravo.com", xposedDate: "2020-01" }),
        xonBreach({ breach: "Alpha", domain: "alpha.com", xposedDate: "2020-01" }),
      ]),
      leakCheck: leak([{ name: "Undated", date: null }]),
    });
    expect(a.breaches.map((b) => b.name)).toEqual(["Alpha", "Bravo", "Undated"]);
  });


  it("tolerates empty domain, date, record and data-class fields", () => {
    const a = aggregateBreaches({
      xon: xon([xonBreach({
        breach: "Sparse", domain: "", xposedDate: "", xposedRecords: 0,
        xposedData: ["", "Passwords"], passwordRisk: "Unknown",
      })]),
    });
    expect(a.total).toBe(1);
    const b = a.breaches[0];
    expect(b.domain).toBeNull();
    expect(b.date).toBeNull();
    expect(b.records).toBeNull();
    expect(b.dataClasses).toEqual(["Passwords"]); // the empty class was dropped
    expect(b.password).toBe(true); // Passwords class still wins
  });


  it("tolerates a BreachDirectory hit that omitted its sources array", () => {
    const a = aggregateBreaches({
      breachDirectory: { ok: true, data: { found: 3 } as never },
    });
    // It answered, but named no sources, so there is nothing to fold in.
    expect(a.total).toBe(0);
    expect(a.sourcesAnswered).toEqual(["BreachDirectory"]);
  });

  it("skips breaches with an unkeyable name", () => {
    const a = aggregateBreaches({ leakCheck: leak([{ name: "   ", date: "2020" }]) });
    expect(a.total).toBe(0);
  });
});

describe("aggregateBreaches: catalog enrichment + timeline", () => {
  const cat = (entries: Record<string, BreachDescription>): BreachCatalogLookup => ({
    lookup: (key) => entries[key],
  });

  it("fills a name-only breach with the catalog's description and password evidence", () => {
    const a = aggregateBreaches(
      { leakCheck: leak([{ name: "Adobe", date: null }]) },
      cat({
        [breachKey("Adobe", null)]: {
          domain: "adobe.com", date: "2013-10-04", records: 152_000_000,
          dataClasses: ["Passwords", "Email addresses"], verified: true,
        },
      }),
    );
    const b = a.breaches[0];
    expect(b.enriched).toBe(true);
    expect(a.enrichedCount).toBe(1);
    expect(b.domain).toBe("adobe.com");
    expect(b.date).toBe("2013-10-04");
    expect(b.records).toBe(152_000_000);
    expect(b.verified).toBe(true);
    expect(b.dataClasses).toContain("Passwords");
    expect(b.password).toBe(true);        // a catalog "Passwords" class is evidence
    expect(a.withPassword).toBe(1);
    expect(a.dataClasses).toContain("Passwords");
  });

  it("leaves a breach untouched when the catalog does not know it", () => {
    const a = aggregateBreaches(
      { leakCheck: leak([{ name: "Obscure", date: "2020-01-01" }]) },
      cat({}),
    );
    expect(a.breaches[0].enriched).toBe(false);
    expect(a.enrichedCount).toBe(0);
  });

  it("never overwrites a value a source already gave", () => {
    const a = aggregateBreaches(
      { xon: xon([xonBreach({ breach: "LinkedIn", domain: "linkedin.com", xposedRecords: 164_000_000, xposedDate: "2012-05-05" })]) },
      cat({
        [breachKey("LinkedIn", "linkedin.com")]: {
          domain: "other.com", date: "1999-01-01", records: 5,
          dataClasses: ["Usernames"], verified: false,
        },
      }),
    );
    const b = a.breaches[0];
    expect(b.domain).toBe("linkedin.com");   // source domain kept
    expect(b.records).toBe(164_000_000);      // source count kept
    expect(b.date).toBe("2012-05-05");        // betterDate keeps the source's
    expect(b.verified).toBe(true);            // already verified, stays
    expect(b.dataClasses).toContain("Usernames"); // catalog classes still merge in
    expect(b.enriched).toBe(true);
  });

  it("buckets dated breaches by year, oldest first, ignoring undated ones", () => {
    const a = aggregateBreaches({
      xon: xon([
        xonBreach({ breach: "A", domain: "a.com", xposedDate: "2013-01-01" }),
        xonBreach({ breach: "B", domain: "b.com", xposedDate: "2013-06-01" }),
        xonBreach({ breach: "C", domain: "c.com", xposedDate: "2019-01-01" }),
        xonBreach({ breach: "D", domain: "d.com", xposedDate: "" }),
      ]),
    });
    expect(a.timeline).toEqual([{ year: "2013", count: 2 }, { year: "2019", count: 1 }]);
  });
});
