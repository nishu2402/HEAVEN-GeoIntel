import { describe, it, expect } from "vitest";
import { parseName, permuteEmails, inferPattern, applyPattern } from "@/lib/analysis/emailPermutations";

describe("parseName", () => {
  it("splits a plain two-part name", () => {
    expect(parseName("John Smith")).toEqual({ first: "john", middle: null, last: "smith" });
  });

  it("keeps the first and LAST token when a middle name is present", () => {
    expect(parseName("John Michael Smith")).toEqual({ first: "john", middle: "michael", last: "smith" });
  });

  it("takes the last token as the surname for four-part names", () => {
    expect(parseName("Ana Maria Garcia Lopez")).toMatchObject({ first: "ana", last: "lopez" });
  });

  it("folds diacritics the way mail systems provision them", () => {
    expect(parseName("José Müller")).toEqual({ first: "jose", middle: null, last: "muller" });
  });

  it("drops apostrophes and hyphens rather than emitting an invalid local part", () => {
    expect(parseName("Mary O'Brien")).toMatchObject({ last: "obrien" });
    expect(parseName("Jean-Luc Picard")).toMatchObject({ first: "jeanluc", last: "picard" });
  });

  it("handles a comma-separated 'Last, First' form as tokens", () => {
    expect(parseName("Smith, John")).toEqual({ first: "smith", middle: null, last: "john" });
  });

  it("returns an empty surname for a single-token name", () => {
    expect(parseName("Cher")).toEqual({ first: "cher", middle: null, last: "" });
  });

  it("returns null when nothing survives normalisation", () => {
    expect(parseName("   ")).toBeNull();
    expect(parseName("123 !!!")).toBeNull();
  });
});

describe("permuteEmails", () => {
  it("puts first.last at the top", () => {
    const out = permuteEmails("John Smith", "acme.com");
    expect(out[0]).toEqual({ address: "john.smith@acme.com", pattern: "first.last", weight: 95 });
  });

  it("returns results sorted by descending weight", () => {
    const w = permuteEmails("John Smith", "acme.com").map((c) => c.weight);
    expect(w).toEqual([...w].sort((a, b) => b - a));
  });

  it("covers the standard corporate patterns", () => {
    const out = permuteEmails("John Smith", "acme.com").map((c) => c.address);
    for (const a of [
      "john.smith@acme.com", "jsmith@acme.com", "johnsmith@acme.com", "john@acme.com",
      "john_smith@acme.com", "j.smith@acme.com", "johns@acme.com", "john.s@acme.com",
      "smith.john@acme.com", "smithjohn@acme.com", "john-smith@acme.com", "sjohn@acme.com",
      "smith@acme.com", "s.john@acme.com", "js@acme.com",
    ]) expect(out).toContain(a);
  });

  it("adds the middle-name patterns only when a middle name exists", () => {
    const withMiddle = permuteEmails("John Michael Smith", "acme.com").map((c) => c.pattern);
    expect(withMiddle).toContain("first.m.last");
    expect(withMiddle).toContain("fmlast");
    expect(permuteEmails("John Smith", "acme.com").map((c) => c.pattern)).not.toContain("first.m.last");
  });

  it("emits only surname-free patterns for a single-token name", () => {
    expect(permuteEmails("Cher", "acme.com")).toEqual([
      { address: "cher@acme.com", pattern: "first", weight: 60 },
    ]);
  });

  it("de-duplicates addresses that several patterns produce identically", () => {
    const out = permuteEmails("Sam Sam", "x.com").map((c) => c.address);
    expect(new Set(out).size).toBe(out.length);
  });

  it("normalises the domain", () => {
    for (const d of ["ACME.com", "https://acme.com", "www.acme.com", "acme.com/careers"]) {
      expect(permuteEmails("John Smith", d)[0].address).toBe("john.smith@acme.com");
    }
  });

  it("returns nothing without a usable name or domain", () => {
    expect(permuteEmails("", "acme.com")).toEqual([]);
    expect(permuteEmails("John Smith", "   ")).toEqual([]);
  });
});

describe("inferPattern", () => {
  it.each([
    ["john.smith@acme.com", "first.last"],
    ["jsmith@acme.com", "flast"],
    ["j.smith@acme.com", "f.last"],
    ["johnsmith@acme.com", "firstlast"],
    ["john_smith@acme.com", "first_last"],
    ["smith.john@acme.com", "last.first"],
  ])("recovers %s as %s", (email, pattern) => {
    expect(inferPattern(email, "John Smith")).toEqual([pattern]);
  });

  it("reports every rule that fits rather than picking one", () => {
    expect(inferPattern("sam.sam@x.com", "Sam Sam")).toEqual(["first.last", "last.first"]);
  });

  it("returns nothing when the address matches no rule", () => {
    expect(inferPattern("jonny@acme.com", "John Smith")).toEqual([]);
  });

  it("is case-insensitive about the address", () => {
    expect(inferPattern("John.Smith@ACME.com", "John Smith")).toEqual(["first.last"]);
  });

  it("returns nothing for unusable input", () => {
    expect(inferPattern("", "John Smith")).toEqual([]);
    expect(inferPattern("j.smith@acme.com", "")).toEqual([]);
  });
});

describe("applyPattern", () => {
  it("applies a discovered rule to another person", () => {
    expect(applyPattern("flast", "Jane Doe", "acme.com")).toBe("jdoe@acme.com");
  });

  it("strips a www. prefix from the domain", () => {
    expect(applyPattern("first.last", "Jane Doe", "www.acme.com")).toBe("jane.doe@acme.com");
  });

  it("returns null when the rule cannot be built from the name", () => {
    expect(applyPattern("first.last", "Cher", "acme.com")).toBeNull();
  });

  it("returns null for an unknown rule, an unusable name, or no domain", () => {
    expect(applyPattern("nope", "Jane Doe", "acme.com")).toBeNull();
    expect(applyPattern("flast", "!!!", "acme.com")).toBeNull();
    expect(applyPattern("flast", "Jane Doe", "  ")).toBeNull();
  });
});
