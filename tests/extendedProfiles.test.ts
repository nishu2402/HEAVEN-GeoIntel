import { describe, it, expect } from "vitest";
import { extendedProfileLinks, extendedSiteCount } from "@/lib/analysis/extendedProfiles";
import { EXTENDED_USERNAME_SITES } from "@/lib/data/extendedUsernameSites";

describe("extendedSiteCount", () => {
  it("offers only the sites nothing can check automatically", () => {
    // The catalog used to arrive here whole. Now the deep sweep classifies every
    // entry carrying a detection contract, so what is left for the analyst to
    // open by hand is the residue: entries the upstream marks invalid, and those
    // whose probe needs a POST body or custom headers this tool does not send.
    const n = extendedSiteCount();
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(EXTENDED_USERNAME_SITES.length / 10);
    const contracted = EXTENDED_USERNAME_SITES.filter(
      (s) => !s.skip && typeof s.ec === "number" && typeof s.mc === "number" && (s.es ?? "") + (s.ms ?? "") !== "",
    );
    // The overwhelming majority are auto-classifiable, which is the point.
    expect(contracted.length).toBeGreaterThan(600);
  });
});

describe("extendedProfileLinks", () => {
  it("returns nothing for a blank handle", () => {
    expect(extendedProfileLinks("   ")).toEqual([]);
  });

  it("builds grouped launch links, largest category first, and drops covered sites", () => {
    const groups = extendedProfileLinks("torvalds");
    expect(groups.length).toBeGreaterThan(3);
    // largest-first ordering
    for (let i = 1; i < groups.length; i++) {
      expect(groups[i - 1].sites.length).toBeGreaterThanOrEqual(groups[i].sites.length);
    }
    const total = groups.reduce((n, g) => n + g.sites.length, 0);
    expect(total).toBe(extendedSiteCount());

    const allNames = groups.flatMap((g) => g.sites.map((s) => s.name.toLowerCase()));
    // Instagram is in the auto-verified catalog, so the overlay must not repeat it.
    expect(allNames).not.toContain("instagram");
    // every URL is a real https link with the placeholder substituted away
    for (const g of groups) for (const s of g.sites) {
      expect(s.url.startsWith("https://")).toBe(true);
      expect(s.url).not.toContain("{account}");
    }
    // within a group, alphabetical
    const first = groups[0].sites.map((s) => s.name);
    expect(first).toEqual([...first].sort((a, b) => a.localeCompare(b)));
  });

  it("URL-encodes the handle into the template", () => {
    const groups = extendedProfileLinks("a b");
    const urls = groups.flatMap((g) => g.sites.map((s) => s.url));
    expect(urls.some((u) => u.includes("a%20b"))).toBe(true);
  });
});
