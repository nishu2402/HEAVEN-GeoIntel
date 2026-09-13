// ── Proof that two accounts belong to one person ─────────────────────────────
//
// Sharing a handle is not evidence. That was the flaw in the old identity card:
// it merged every profile the sweep found under one heading, so a lookup of
// `torvalds` presented "Portland, OR" (GitHub, the real Linus), "GT"
// (Chess.com) and "Bern" (Lichess) as one person's locations, alongside a
// 10-follower Bluesky account with zero posts. A popular handle is claimed on
// dozens of platforms by dozens of people; that is the base rate, not an
// anomaly.
//
// So a link has to be PROVEN, and there are exactly two kinds of proof this tool
// can obtain without a key:
//
//   self-link — one profile publicly points at the other (a Codeberg website
//               field holding github.com/<their handle>, a bio linking their
//               Mastodon). The subject asserted the connection themselves.
//   avatar    — the same photograph is used on both, established by perceptual
//               hash (see server/avatarHash.ts) and not by filename.
//
// Everything else is a candidate. Candidates are still shown, because they are
// where the next lead comes from, but they are shown as candidates.

import type { SocialProfile } from "../types";
import type { AvatarCluster } from "./phash";

export type LinkKind = "self-link" | "avatar";

export interface LinkProof {
  kind: LinkKind;
  /** The two platforms this proof joins, in the order they were found. */
  platforms: [string, string];
  /** What the proof actually is, in words, for the panel and the report. */
  detail: string;
}

/** Every http(s) URL inside a blob of profile text. */
function urlsIn(text: string | null): URL[] {
  if (!text) return [];
  const out: URL[] = [];
  for (const raw of text.match(/https?:\/\/[^\s"'<>)\]]+/gi) ?? []) {
    try {
      out.push(new URL(raw.replace(/[.,;:]+$/, "")));
    } catch {
      /* v8 ignore next 2 -- the regex only matches http(s) URLs, which `URL`
         parses; the guard is here so a pathological match cannot throw. */
      continue;
    }
  }
  return out;
}

/** Registrable-ish host comparison: ignore `www.` and case. */
function sameHost(a: string, b: string): boolean {
  const norm = (h: string) => h.toLowerCase().replace(/^www\./, "");
  return norm(a) === norm(b);
}

/**
 * Links a profile declares to another profile the sweep also found.
 *
 * The bar is deliberately high: the URL must point at the SAME HOST as the other
 * profile and carry that profile's handle. A bio that merely mentions "github"
 * proves nothing, and a link to someone else's GitHub proves nothing about this
 * subject.
 */
export function selfLinkProofs(profiles: SocialProfile[]): LinkProof[] {
  const proofs: LinkProof[] = [];
  const seen = new Set<string>();

  for (const from of profiles) {
    const candidates = [...urlsIn(from.bio), ...urlsIn(from.extra)];
    for (const url of candidates) {
      for (const to of profiles) {
        if (to.platform === from.platform) continue;
        let toHost: string;
        try {
          toHost = new URL(to.url).hostname;
        } catch {
          /* v8 ignore next 2 -- every normaliser builds `url` from a literal
             https:// template, so it always parses. */
          continue;
        }
        if (!sameHost(url.hostname, toHost)) continue;
        const path = decodeURIComponent(`${url.pathname}${url.search}`).toLowerCase();
        if (!path.includes(to.handle.toLowerCase())) continue;
        const key = [from.platform, to.platform].sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        proofs.push({
          kind: "self-link",
          platforms: [from.platform, to.platform],
          detail: `${from.platform} profile links to ${url.hostname}${url.pathname}`,
        });
      }
    }
  }
  return proofs;
}

/** One proof per platform pair inside each perceptual-hash cluster. */
export function avatarProofs(clusters: AvatarCluster[]): LinkProof[] {
  const proofs: LinkProof[] = [];
  const seen = new Set<string>();
  for (const c of clusters) {
    for (let i = 0; i < c.sources.length; i++) {
      for (let j = i + 1; j < c.sources.length; j++) {
        const a = c.sources[i] as string;
        const b = c.sources[j] as string;
        const key = [a, b].sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        proofs.push({
          kind: "avatar",
          platforms: [a, b],
          detail: `same profile photo on ${a} and ${b} (${c.similarity}% perceptual match)`,
        });
      }
    }
  }
  return proofs;
}

/**
 * Group platforms into sets joined by at least one proof (single-linkage
 * union-find). A platform with no proof comes back as a set of one, which is the
 * honest description of an account nothing connects to anything.
 */
export function linkedClusters(platforms: string[], proofs: LinkProof[]): string[][] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x);
    if (p === undefined || p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  };
  const union = (a: string, b: string) => {
    parent.set(find(a), find(b));
  };

  for (const p of platforms) if (!parent.has(p)) parent.set(p, p);
  for (const proof of proofs) {
    const [a, b] = proof.platforms;
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    union(a, b);
  }

  const groups = new Map<string, string[]>();
  for (const p of parent.keys()) {
    const root = find(p);
    const list = groups.get(root) ?? [];
    if (list.length === 0) groups.set(root, list);
    list.push(p);
  }
  // Largest first, then alphabetically, so the order is stable for a snapshot
  // diff and for the report.
  return [...groups.values()]
    .map((g) => g.sort())
    .sort((a, b) => b.length - a.length || (a[0] as string).localeCompare(b[0] as string));
}
