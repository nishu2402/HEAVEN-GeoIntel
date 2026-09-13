// ── Entity resolution over cross-profile identity signals (pure) ─────────────
//
// The username sweep gathers name / location / avatar candidates from every
// verified profile. This turns them into ONE identity, but only as far as the
// evidence goes.
//
// What changed, and why: the previous version fused every profile that shared
// the handle, and its confidence score added +12 for simply HAVING a location.
// So three platforms claiming three different cities made the answer look more
// certain, not less. A live lookup of `torvalds` produced a single "identity"
// holding Portland, GT and Bern, with a Mastodon default-avatar file as the
// subject's photograph.
//
// Now a link between two accounts must be proven (see identityLinks.ts), and:
//
//   • fields are fused only WITHIN the proven cluster,
//   • values from unproven accounts are returned separately as candidates,
//   • disagreement inside the cluster SUBTRACTS confidence,
//   • with no proof at all, confidence is capped below "high" no matter how many
//     accounts share the handle.

import type { IdentitySignals } from "../types";
import type { LinkProof } from "./identityLinks";
import { linkedClusters } from "./identityLinks";

export interface ResolvedField {
  value: string;
  /** Distinct platforms that asserted this value. */
  sources: string[];
  /** How many platforms agreed on the winning value. */
  agreement: number;
  /** Distinct platforms that asserted ANY value for this field. */
  total: number;
}

export type IdentityFieldName = "name" | "location" | "avatar";

/** A value from an account nothing links to the subject: a lead, not a fact. */
export interface UnlinkedCandidate {
  field: IdentityFieldName;
  value: string;
  source: string;
}

/** Two accounts in the proven cluster asserting different values for one field. */
export interface IdentityConflict {
  field: IdentityFieldName;
  values: { value: string; source: string }[];
}

export interface ResolvedIdentity {
  name: ResolvedField | null;
  location: ResolvedField | null;
  avatar: ResolvedField | null;
  /** 0-100. Capped at UNPROVEN_CEILING while no link is proven. */
  confidence: number;
  label: "low" | "medium" | "high";
  /** The accounts proven to be one subject, and what proved it. */
  cluster: { platforms: string[]; proofs: LinkProof[] };
  /** Values from accounts outside the cluster. Never fused into the identity. */
  unlinked: UnlinkedCandidate[];
  /** Contradictions inside the cluster, which lower the confidence. */
  conflicts: IdentityConflict[];
}

/**
 * Ceiling on confidence while no account is linked to another by proof. A
 * popular handle is claimed by many people, so "five platforms show this name"
 * is consistent with five different people and must not read as certainty.
 */
export const UNPROVEN_CEILING = 40;

type Signal = { value: string; source: string };

/**
 * Comparison key for a claimed value.
 *
 * Punctuation is dropped, not just case and spacing. Measured on `bagder`:
 * GitHub says "Daniel Stenberg" and Mastodon says "daniel:// stenberg://" —
 * the same name in the owner's own styling. Treating those as two values made
 * the pair read as a contradiction and cost the identity 15 points of
 * confidence, on evidence that actually pointed the other way.
 */
function valueKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The value the most distinct platforms agree on; ties break by first appearance. */
function pickBest(items: Signal[]): ResolvedField | null {
  const totalSources = new Set(items.map((i) => i.source.toLowerCase())).size;
  const groups = new Map<string, { value: string; sources: Set<string> }>();
  for (const it of items) {
    const key = valueKey(it.value);
    if (!key) continue;
    const g = groups.get(key);
    if (g) g.sources.add(it.source.toLowerCase());
    else groups.set(key, { value: it.value.trim(), sources: new Set([it.source.toLowerCase()]) });
  }
  // Map preserves insertion order, so a strict `>` keeps the FIRST value that
  // reaches the maximum agreement — ties break by first appearance for free.
  let best: { value: string; sources: Set<string> } | null = null;
  for (const g of groups.values()) {
    if (!best || g.sources.size > best.sources.size) best = g;
  }
  if (!best) return null;
  return { value: best.value, sources: [...best.sources], agreement: best.sources.size, total: totalSources };
}

/** Distinct values for one field, so a contradiction can be reported as one. */
function conflictOf(field: IdentityFieldName, items: Signal[]): IdentityConflict | null {
  const byValue = new Map<string, Signal>();
  for (const it of items) {
    const key = valueKey(it.value);
    if (key && !byValue.has(key)) byValue.set(key, it);
  }
  if (byValue.size < 2) return null;
  return { field, values: [...byValue.values()] };
}

function scoreConfidence(
  name: ResolvedField | null,
  location: ResolvedField | null,
  avatar: ResolvedField | null,
  proofs: LinkProof[],
  conflicts: IdentityConflict[],
): number {
  if (!name) return location || avatar ? 15 : 0;

  // A name one platform asserts about itself. Lower than the old 35: a
  // self-declared display name is a claim, not a corroborated fact.
  let c = 25;
  c += (name.agreement - 1) * 20;                               // each corroborating platform
  if (name.total > 1 && name.agreement === name.total) c += 10; // unanimous inside the cluster
  if (proofs.length > 0) c += 15;                               // the accounts are provably one subject
  if (location) c += 8;
  if (avatar) c += 8;
  // Disagreement is evidence AGAINST a single identity, so it costs more than
  // agreement earns. This is the sign error that made three contradictory
  // cities read as corroboration.
  c -= conflicts.length * 15;

  const capped = proofs.length === 0 ? Math.min(c, UNPROVEN_CEILING) : c;
  return Math.max(0, Math.min(100, capped));
}

/**
 * Resolve an identity from the gathered signals and whatever proofs the route
 * could establish. With no proofs, the result is explicitly a candidate: fields
 * still come from real profiles, but `cluster.platforms` holds one platform and
 * the confidence cannot reach "high".
 */
export function resolveIdentity(id: IdentitySignals, proofs: LinkProof[] = []): ResolvedIdentity {
  const avatarSignals: Signal[] = id.avatars.map((a) => ({ value: a.url, source: a.source }));
  const platforms = [
    ...new Set([...id.names, ...id.locations, ...avatarSignals].map((s) => s.source)),
  ];
  const clusters = linkedClusters(platforms, proofs);

  // The subject cluster: the largest proven group, or — when nothing is proven —
  // the single platform behind the most-agreed name.
  const largest = clusters[0] ?? [];
  let subject: string[];
  if (largest.length > 1) {
    subject = largest;
  } else {
    const bestName = pickBest(id.names);
    const owner = bestName?.sources[0];
    const match = owner
      ? platforms.find((p) => p.toLowerCase() === owner)
      : undefined;
    subject = match ? [match] : largest;
  }

  const inSubject = (s: Signal) => subject.some((p) => p.toLowerCase() === s.source.toLowerCase());
  const names = id.names.filter(inSubject);
  const locations = id.locations.filter(inSubject);
  const avatars = avatarSignals.filter(inSubject);

  const name = pickBest(names);
  const location = pickBest(locations);
  const avatar = pickBest(avatars);

  const conflicts = [conflictOf("name", names), conflictOf("location", locations)]
    .filter((c): c is IdentityConflict => c !== null);

  // Proofs that actually joined the subject cluster, so the card can show what
  // the claim rests on rather than every proof the sweep found.
  const clusterProofs = proofs.filter((p) =>
    p.platforms.every((pl) => subject.some((s) => s.toLowerCase() === pl.toLowerCase())),
  );

  const unlinked: UnlinkedCandidate[] = [
    ...id.names.filter((s) => !inSubject(s)).map((s) => ({ field: "name" as const, value: s.value, source: s.source })),
    ...id.locations.filter((s) => !inSubject(s)).map((s) => ({ field: "location" as const, value: s.value, source: s.source })),
    ...avatarSignals.filter((s) => !inSubject(s)).map((s) => ({ field: "avatar" as const, value: s.value, source: s.source })),
  ];

  const confidence = scoreConfidence(name, location, avatar, clusterProofs, conflicts);
  const label = confidence >= 70 ? "high" : confidence >= 40 ? "medium" : "low";
  return {
    name, location, avatar, confidence, label,
    cluster: { platforms: subject, proofs: clusterProofs },
    unlinked,
    conflicts,
  };
}
