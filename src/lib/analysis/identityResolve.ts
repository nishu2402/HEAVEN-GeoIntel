// ── Entity resolution over cross-profile identity signals (pure) ─────────────
//
// The username sweep already gathers name / location / avatar candidates from
// every verified profile. This turns that raw list into a single most-likely
// identity with a confidence score, the way an analyst reasons: a claim two or
// three independent platforms agree on is stronger than one only a single
// account makes. It invents nothing — every resolved value came from a real
// profile, and the confidence is a function of how much those profiles corroborate.

import type { IdentitySignals } from "../types";

export interface ResolvedField {
  value: string;
  /** Distinct platforms that asserted this value. */
  sources: string[];
  /** How many platforms agreed on the winning value. */
  agreement: number;
  /** Distinct platforms that asserted ANY value for this field. */
  total: number;
}

export interface ResolvedIdentity {
  name: ResolvedField | null;
  location: ResolvedField | null;
  avatar: ResolvedField | null;
  /** 0–100, driven mainly by cross-platform agreement on the name. */
  confidence: number;
  label: "low" | "medium" | "high";
}

/** The value the most distinct platforms agree on; ties break by first appearance. */
function pickBest(items: { value: string; source: string }[]): ResolvedField | null {
  const totalSources = new Set(items.map((i) => i.source.toLowerCase())).size;
  const groups = new Map<string, { value: string; sources: Set<string> }>();
  for (const it of items) {
    const key = it.value.trim().toLowerCase().replace(/\s+/g, " ");
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

function scoreConfidence(name: ResolvedField | null, location: ResolvedField | null, avatar: ResolvedField | null): number {
  if (!name) return location || avatar ? 15 : 0;
  let c = 35;                                   // a name from a single platform
  c += (name.agreement - 1) * 20;               // each corroborating platform
  if (name.total > 1 && name.agreement === name.total) c += 10; // unanimous across platforms
  if (location) c += 12;
  if (avatar) c += 8;
  return Math.min(100, c);
}

export function resolveIdentity(id: IdentitySignals): ResolvedIdentity {
  const name = pickBest(id.names);
  const location = pickBest(id.locations);
  const avatar = pickBest(id.avatars.map((a) => ({ value: a.url, source: a.source })));
  const confidence = scoreConfidence(name, location, avatar);
  const label = confidence >= 70 ? "high" : confidence >= 40 ? "medium" : "low";
  return { name, location, avatar, confidence, label };
}
