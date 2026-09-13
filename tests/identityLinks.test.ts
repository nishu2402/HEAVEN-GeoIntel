import { describe, it, expect } from "vitest";
import { selfLinkProofs, avatarProofs, linkedClusters } from "@/lib/analysis/identityLinks";
import type { SocialProfile } from "@/lib/types";

// Sharing a handle is not evidence. These are the only two proofs the tool can
// obtain keylessly: the subject linking one profile from another, and the same
// photograph appearing on both.

const profile = (over: Partial<SocialProfile> = {}): SocialProfile => ({
  platform: "GitHub", category: "developer", handle: "torvalds",
  url: "https://github.com/torvalds", avatarUrl: null, displayName: null,
  bio: null, stats: [], joinedYear: null, location: null, extra: null,
  ...over,
});

describe("selfLinkProofs", () => {
  it("accepts a link that names the other profile's host AND handle", () => {
    const proofs = selfLinkProofs([
      profile({ platform: "Codeberg", handle: "linus", url: "https://codeberg.org/linus", extra: "site: https://github.com/torvalds" }),
      profile(),
    ]);
    expect(proofs).toHaveLength(1);
    expect(proofs[0].kind).toBe("self-link");
    expect(proofs[0].platforms).toEqual(["Codeberg", "GitHub"]);
    expect(proofs[0].detail).toContain("github.com/torvalds");
  });

  it("finds the link in a bio as well as in the extra line", () => {
    const proofs = selfLinkProofs([
      profile({ platform: "Mastodon", handle: "linus", url: "https://mastodon.social/@linus", bio: "code at https://github.com/torvalds ." }),
      profile(),
    ]);
    expect(proofs).toHaveLength(1);
  });

  it("refuses a link to the right host but the wrong account", () => {
    const proofs = selfLinkProofs([
      profile({ platform: "Codeberg", handle: "linus", url: "https://codeberg.org/linus", bio: "https://github.com/someone-else" }),
      profile(),
    ]);
    expect(proofs).toEqual([]);
  });

  it("ignores a bare mention with no URL, and a link to itself", () => {
    expect(selfLinkProofs([
      profile({ platform: "Codeberg", handle: "linus", url: "https://codeberg.org/linus", bio: "I am on github as torvalds" }),
      profile(),
    ])).toEqual([]);
    expect(selfLinkProofs([profile({ bio: "https://github.com/torvalds" })])).toEqual([]);
  });

  it("emits one proof per platform pair, not one per mention", () => {
    const proofs = selfLinkProofs([
      profile({ platform: "Codeberg", handle: "linus", url: "https://codeberg.org/linus",
        bio: "https://github.com/torvalds", extra: "site: https://github.com/torvalds" }),
      profile(),
    ]);
    expect(proofs).toHaveLength(1);
  });

  it("survives malformed URLs in a bio", () => {
    expect(selfLinkProofs([
      profile({ platform: "X", handle: "a", url: "https://x.test/a", bio: "https://" }),
      profile(),
    ])).toEqual([]);
  });
});

describe("avatarProofs", () => {
  it("turns each cluster into one proof per platform pair", () => {
    const proofs = avatarProofs([
      { sources: ["GitHub", "Mastodon", "GitLab"], urls: ["a", "b", "c"], similarity: 97 },
    ]);
    expect(proofs).toHaveLength(3);
    expect(proofs.every((p) => p.kind === "avatar")).toBe(true);
    expect(proofs[0].detail).toContain("97% perceptual match");
  });

  it("does not repeat a pair that two clusters both contain", () => {
    const proofs = avatarProofs([
      { sources: ["A", "B"], urls: ["a", "b"], similarity: 100 },
      { sources: ["B", "A"], urls: ["b", "a"], similarity: 95 },
    ]);
    expect(proofs).toHaveLength(1);
  });
});

describe("linkedClusters", () => {
  it("groups platforms joined by a proof and leaves the rest alone", () => {
    const clusters = linkedClusters(
      ["GitHub", "Mastodon", "Chess.com", "Lichess"],
      [
        { kind: "avatar", platforms: ["GitHub", "Mastodon"], detail: "" },
      ],
    );
    expect(clusters[0]).toEqual(["GitHub", "Mastodon"]);
    // Largest first, then alphabetical, so the order is stable for a diff.
    expect(clusters.slice(1)).toEqual([["Chess.com"], ["Lichess"]]);
  });

  it("merges transitively: A-B and B-C is one subject", () => {
    const clusters = linkedClusters(["A", "B", "C"], [
      { kind: "avatar", platforms: ["A", "B"], detail: "" },
      { kind: "self-link", platforms: ["B", "C"], detail: "" },
    ]);
    expect(clusters).toEqual([["A", "B", "C"]]);
  });

  it("includes a platform that only a proof mentions", () => {
    expect(linkedClusters([], [{ kind: "avatar", platforms: ["X", "Y"], detail: "" }])).toEqual([["X", "Y"]]);
  });
});
