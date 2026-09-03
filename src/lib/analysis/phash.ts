// ── Perceptual avatar hashing — pure dHash + cross-platform correlation ──────
//
// When the same person reuses one profile photo across platforms, the images are
// often re-encoded, resized or lightly cropped — so a byte hash won't match, but
// a PERCEPTUAL hash will. dHash (difference hash) captures the gradient
// structure of an image in 64 bits; two versions of the same photo stay within a
// few bits of each other, while unrelated photos are far apart.
//
// This module is pure: it works on already-grayscaled pixels, so it is fully
// unit-tested. Turning an <img> into those pixels (canvas draw + getImageData)
// is browser glue that lives in the panel — and it is best-effort, because a
// cross-origin avatar whose host sends no CORS header taints the canvas and
// cannot be read. A correlation is only ever asserted from a real perceptual
// match, never guessed, so an unreadable avatar simply drops out.

/**
 * Difference hash of a grayscale image. `gray` is row-major, `cols` wide and
 * `rows` tall; each row contributes `cols-1` bits (left-pixel brighter than its
 * right neighbour). A 9×8 input yields the canonical 64-bit dHash.
 */
export function dHashFromGray(gray: number[], cols: number, rows: number): bigint {
  let hash = BigInt(0);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols - 1; x++) {
      const left = gray[y * cols + x];
      const right = gray[y * cols + x + 1];
      hash = (hash << BigInt(1)) | (left > right ? BigInt(1) : BigInt(0));
    }
  }
  return hash;
}

/** Number of differing bits between two hashes. */
export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x > BigInt(0)) {
    count += Number(x & BigInt(1));
    x >>= BigInt(1);
  }
  return count;
}

/** Percentage similarity of two hashes over `bits` positions (default 64). */
export function similarity(a: bigint, b: bigint, bits = 64): number {
  return Math.round((1 - hamming(a, b) / bits) * 100);
}

export interface HashedAvatar {
  source: string;
  url: string;
  hash: bigint;
}

export interface AvatarCluster {
  /** The platforms whose avatars match, deduplicated. */
  sources: string[];
  urls: string[];
  /** Tightest pairwise similarity in the cluster, as a percentage. */
  similarity: number;
}

/**
 * Cluster avatars whose perceptual hashes are within `maxDistance` bits, keeping
 * only clusters that span at least two DISTINCT platforms — the signal that
 * matters ("the same photo on GitHub and GitLab"). Single-linkage union-find.
 */
export function correlateAvatars(items: HashedAvatar[], maxDistance = 8): AvatarCluster[] {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number) => { parent[find(a)] = find(b); };

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (hamming(items[i].hash, items[j].hash) <= maxDistance) union(i, j);
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < items.length; i++) {
    const root = find(i);
    const list = groups.get(root) ?? [];
    if (list.length === 0) groups.set(root, list);
    list.push(i);
  }

  const clusters: AvatarCluster[] = [];
  for (const idxs of groups.values()) {
    if (idxs.length < 2) continue;
    const sources = [...new Set(idxs.map((i) => items[i].source))];
    if (sources.length < 2) continue; // same platform twice is not cross-platform evidence
    let minSim = 100;
    for (let a = 0; a < idxs.length; a++) {
      for (let b = a + 1; b < idxs.length; b++) {
        minSim = Math.min(minSim, similarity(items[idxs[a]].hash, items[idxs[b]].hash));
      }
    }
    clusters.push({
      sources,
      urls: idxs.map((i) => items[i].url),
      similarity: minSim,
    });
  }
  return clusters.sort((a, b) => b.similarity - a.similarity);
}
