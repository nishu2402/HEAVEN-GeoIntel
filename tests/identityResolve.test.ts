import { describe, it, expect } from "vitest";
import { resolveIdentity, UNPROVEN_CEILING } from "@/lib/analysis/identityResolve";
import type { IdentitySignals, LinkProof } from "@/lib/types";

const sig = (over: Partial<IdentitySignals> = {}): IdentitySignals => ({ names: [], locations: [], avatars: [], bios: [], ...over });

/** A proof of the kind the avatar hasher produces. */
const avatarProof = (a: string, b: string): LinkProof => ({
  kind: "avatar",
  platforms: [a, b],
  detail: `same profile photo on ${a} and ${b} (100% perceptual match)`,
});

describe("resolveIdentity: accounts are fused only when something links them", () => {
  it("refuses to merge accounts that merely share a handle", () => {
    // The `torvalds` case: GitHub is the real Linus, the chess accounts are
    // other people who took the same handle. Fusing them produced one identity
    // holding Portland, GT and Bern.
    const r = resolveIdentity(sig({
      names: [{ value: "Linus Torvalds", source: "GitHub" }],
      locations: [
        { value: "Portland, OR", source: "GitHub" },
        { value: "GT", source: "Chess.com" },
        { value: "Bern", source: "Lichess" },
      ],
    }));
    expect(r.cluster.platforms).toEqual(["GitHub"]);
    expect(r.location?.value).toBe("Portland, OR");
    expect(r.unlinked.map((u) => u.value)).toEqual(["GT", "Bern"]);
    expect(r.confidence).toBeLessThanOrEqual(UNPROVEN_CEILING);
    expect(r.label).not.toBe("high");
  });

  it("fuses accounts a proof links, and scores that highly", () => {
    const r = resolveIdentity(
      sig({
        names: [
          { value: "Daniel Stenberg", source: "GitHub" },
          { value: "daniel:// stenberg://", source: "Mastodon" },
          { value: "someone else", source: "Chess.com" },
        ],
        locations: [{ value: "Sweden", source: "GitHub" }],
        avatars: [{ url: "https://a/x.png", source: "GitHub" }],
      }),
      [avatarProof("GitHub", "Mastodon")],
    );
    expect(r.cluster.platforms).toEqual(["GitHub", "Mastodon"]);
    expect(r.cluster.proofs).toHaveLength(1);
    // Punctuation is not disagreement: the two spellings are one name.
    expect(r.name?.agreement).toBe(2);
    expect(r.conflicts).toEqual([]);
    // 25 base + 20 corroboration + 10 unanimous + 15 proof + 8 location + 8 avatar
    expect(r.confidence).toBe(86);
    expect(r.label).toBe("high");
    expect(r.unlinked.map((u) => u.source)).toEqual(["Chess.com"]);
  });

  it("subtracts confidence when linked accounts contradict each other", () => {
    const linked = resolveIdentity(
      sig({
        names: [{ value: "Ada", source: "A" }, { value: "Bob", source: "B" }],
        locations: [{ value: "Berlin", source: "A" }, { value: "Lisbon", source: "B" }],
      }),
      [avatarProof("A", "B")],
    );
    // 25 base + 15 proof + 8 location, minus 15 per contradiction (name, location)
    expect(linked.conflicts.map((c) => c.field)).toEqual(["name", "location"]);
    expect(linked.confidence).toBe(18);
  });

  it("caps confidence while nothing is proven, however many platforms agree", () => {
    const r = resolveIdentity(sig({
      names: [
        { value: "Ada", source: "A" },
        { value: "Ada", source: "B" },
        { value: "Ada", source: "C" },
      ],
    }));
    // Unproven: one platform is the subject and the other two are candidates,
    // so "three platforms agree" is not corroboration at all — it is one claim
    // plus two unverified ones, and the score says 25 rather than 75.
    expect(r.cluster.platforms).toHaveLength(1);
    expect(r.name?.agreement).toBe(1);
    expect(r.unlinked).toHaveLength(2);
    expect(r.confidence).toBe(25);
    expect(r.confidence).toBeLessThanOrEqual(UNPROVEN_CEILING);
  });

  it("picks the value the most linked platforms agree on", () => {
    const r = resolveIdentity(
      sig({
        names: [
          { value: "Ada", source: "A" },
          { value: "Ada", source: "B" },
          { value: "Bob", source: "C" },
        ],
      }),
      [avatarProof("A", "B")],
    );
    expect(r.name?.value).toBe("Ada");
    expect(r.name?.agreement).toBe(2);
    expect(r.name?.total).toBe(2);        // only the linked accounts count
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
    expect(r.cluster.platforms).toEqual(["X"]);
  });

  it("ignores a proof that reaches outside the subject cluster", () => {
    // A proof joining two platforms that have no signals still forms a cluster,
    // but it must not attach itself to the subject's own evidence.
    const r = resolveIdentity(
      sig({ names: [{ value: "Ada", source: "A" }] }),
      [avatarProof("Y", "Z")],
    );
    expect(r.cluster.platforms).toEqual(["Y", "Z"]);
    expect(r.cluster.proofs).toHaveLength(1);
    expect(r.unlinked.map((u) => u.source)).toEqual(["A"]);
  });
});
