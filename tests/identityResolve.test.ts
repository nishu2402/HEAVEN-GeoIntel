import { describe, it, expect } from "vitest";
import { resolveIdentity } from "@/lib/analysis/identityResolve";
import type { IdentitySignals } from "@/lib/types";

const sig = (over: Partial<IdentitySignals> = {}): IdentitySignals => ({ names: [], locations: [], avatars: [], bios: [], ...over });

describe("resolveIdentity", () => {
  it("picks the name the most platforms agree on and scores high", () => {
    const r = resolveIdentity(sig({
      names: [
        { value: "Linus Torvalds", source: "GitHub" },
        { value: "linus torvalds", source: "GitLab" }, // same name, different case → agrees
        { value: "L. Torvalds", source: "Reddit" },
      ],
      locations: [{ value: "Portland", source: "GitHub" }],
      avatars: [{ url: "https://a/x.png", source: "GitHub" }],
    }));
    expect(r.name?.value).toBe("Linus Torvalds");
    expect(r.name?.agreement).toBe(2);       // GitHub + GitLab
    expect(r.name?.total).toBe(3);           // three distinct platforms overall
    expect(r.location?.value).toBe("Portland");
    expect(r.avatar?.value).toBe("https://a/x.png");
    expect(r.confidence).toBe(35 + 20 + 12 + 8); // 75
    expect(r.label).toBe("high");
  });

  it("is unanimous when every platform agrees, and breaks ties by first appearance", () => {
    const r = resolveIdentity(sig({
      names: [
        { value: "Ada", source: "A" },
        { value: "Ada", source: "B" },
        { value: "Bob", source: "C" }, // a competing single-source claim
      ],
    }));
    // Ada: 2 sources, unanimous? total=3, agreement=2 → NOT unanimous
    expect(r.name?.value).toBe("Ada");
    expect(r.confidence).toBe(35 + 20); // 55, medium (no unanimity bonus, no loc/avatar)
    expect(r.label).toBe("medium");
  });

  it("adds the unanimity bonus when all platforms match", () => {
    const r = resolveIdentity(sig({ names: [{ value: "Ada", source: "A" }, { value: "ADA", source: "B" }] }));
    expect(r.name?.agreement).toBe(2);
    expect(r.name?.total).toBe(2);
    expect(r.confidence).toBe(35 + 20 + 10); // unanimous bonus → 65
  });

  it("scores a single-source name as low confidence", () => {
    const r = resolveIdentity(sig({ names: [{ value: "Solo", source: "X" }] }));
    expect(r.confidence).toBe(35);
    expect(r.label).toBe("low");
  });

  it("gives a small confidence when only a location or avatar is known", () => {
    expect(resolveIdentity(sig({ locations: [{ value: "Berlin", source: "X" }] })).confidence).toBe(15);
    expect(resolveIdentity(sig({ avatars: [{ url: "u", source: "X" }] })).confidence).toBe(15);
    expect(resolveIdentity(sig()).confidence).toBe(0); // nothing at all
  });

  it("ignores blank values and returns null fields when empty", () => {
    const r = resolveIdentity(sig({ names: [{ value: "   ", source: "X" }] }));
    expect(r.name).toBeNull();
    expect(r.confidence).toBe(0);
    expect(r.label).toBe("low");
  });
});
