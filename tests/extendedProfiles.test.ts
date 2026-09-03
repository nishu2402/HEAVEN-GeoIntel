import { describe, it, expect } from "vitest";
import { extendedProfileLinks, extendedSiteCount } from "@/lib/analysis/extendedProfiles";
import { EXTENDED_USERNAME_SITES } from "@/lib/data/extendedUsernameSites";

describe("extendedSiteCount", () => {
  it("offers hundreds of sites, fewer than the raw catalog (already-covered removed)", () => {
    const n = extendedSiteCount();
    expect(n).toBeGreaterThan(500);
    expect(n).toBeLessThan(EXTENDED_USERNAME_SITES.length + 1);
    // Some sites ARE removed as already-covered, so it is a strict subset.
    expect(n).toBeLessThan(EXTENDED_USERNAME_SITES.length);
  });
});

describe("extendedProfileLinks", () => {
  it("returns nothing for a blank handle", () => {
    expect(extendedProfileLinks("   ")).toEqual([]);
  });

  it("builds grouped launch links, largest category first, and drops covered sites", () => {
    const groups = extendedProfileLinks("torvalds");
    expect(groups.length).toBeGreaterThan(5);
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
