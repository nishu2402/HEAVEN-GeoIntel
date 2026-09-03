import { describe, it, expect } from "vitest";
import { dHashFromGray, hamming, similarity, correlateAvatars, type HashedAvatar } from "@/lib/analysis/phash";

// A 9×8 grayscale image → 64-bit dHash. Build small synthetic gradients.
const cols = 9, rows = 8;
function gradient(mul: number): number[] {
  // brightness increases left→right, so each pixel > its right neighbour is false
  const g: number[] = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) g.push(x * mul);
  return g;
}

describe("dHashFromGray", () => {
  it("produces a 0 hash for a left→right increasing gradient (never brighter than the right)", () => {
    expect(dHashFromGray(gradient(10), cols, rows)).toBe(BigInt(0));
  });
  it("sets every bit for a right→left increasing gradient (always brighter than the right)", () => {
    const g: number[] = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) g.push((cols - x) * 10);
    // 64 ones
    expect(dHashFromGray(g, cols, rows)).toBe((BigInt(1) << BigInt(64)) - BigInt(1));
  });
});

describe("hamming + similarity", () => {
  it("counts differing bits and maps them to a percentage", () => {
    expect(hamming(BigInt(0b1010), BigInt(0b0110))).toBe(2);
    expect(hamming(BigInt(255), BigInt(255))).toBe(0);
    expect(similarity(BigInt(0), BigInt(0))).toBe(100);
    // 32 differing bits out of 64 → 50%
    const half = (BigInt(1) << BigInt(32)) - BigInt(1);
    expect(similarity(BigInt(0), half)).toBe(50);
  });
});

describe("correlateAvatars", () => {
  const A = BigInt("0xF0F0F0F0F0F0F0F0");
  const near = A ^ BigInt(0b11); // 2 bits off → within default distance
  const far = ~A & ((BigInt(1) << BigInt(64)) - BigInt(1)); // fully inverted

  it("clusters near-identical avatars that span two platforms", () => {
    const items: HashedAvatar[] = [
      { source: "GitHub", url: "g", hash: A },
      { source: "GitLab", url: "l", hash: near },
      { source: "Reddit", url: "r", hash: far },
    ];
    const clusters = correlateAvatars(items);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].sources.sort()).toEqual(["GitHub", "GitLab"]);
    expect(clusters[0].similarity).toBeGreaterThanOrEqual(95);
    expect(clusters[0].urls.sort()).toEqual(["g", "l"]);
  });

  it("ignores a duplicate avatar on the SAME platform (not cross-platform evidence)", () => {
    const items: HashedAvatar[] = [
      { source: "GitHub", url: "a", hash: A },
      { source: "GitHub", url: "b", hash: A }, // same platform, same image
    ];
    expect(correlateAvatars(items)).toEqual([]);
  });

  it("returns nothing when no two avatars are close", () => {
    const items: HashedAvatar[] = [
      { source: "GitHub", url: "g", hash: A },
      { source: "Reddit", url: "r", hash: far },
    ];
    expect(correlateAvatars(items)).toEqual([]);
  });

  it("returns multiple clusters, tightest similarity first", () => {
    const B = ~A & ((BigInt(1) << BigInt(64)) - BigInt(1)); // far from A
    const items: HashedAvatar[] = [
      { source: "GitHub", url: "g", hash: A },
      { source: "GitLab", url: "l", hash: A ^ BigInt(0b11) }, // cluster 1: ~97%
      { source: "Reddit", url: "r", hash: B },
      { source: "Bluesky", url: "b", hash: B },                // cluster 2: 100%
    ];
    const clusters = correlateAvatars(items);
    expect(clusters).toHaveLength(2);
    // sorted by similarity descending: the exact (100%) B-cluster first
    expect(clusters[0].similarity).toBe(100);
    expect(clusters[0].sources.sort()).toEqual(["Bluesky", "Reddit"]);
    expect(clusters[1].similarity).toBeLessThan(100);
  });

  it("merges a three-platform match via single linkage and reports the tightest similarity", () => {
    const items: HashedAvatar[] = [
      { source: "GitHub", url: "g", hash: A },
      { source: "GitLab", url: "l", hash: A ^ BigInt(0b1) },   // 1 bit off A
      { source: "Bluesky", url: "b", hash: A ^ BigInt(0b110) }, // 2 bits off A, links via A
    ];
    const clusters = correlateAvatars(items);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].sources.sort()).toEqual(["Bluesky", "GitHub", "GitLab"]);
    expect(clusters[0].similarity).toBeLessThan(100);
  });
});
