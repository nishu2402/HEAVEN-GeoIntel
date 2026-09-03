// ── Corporate email permutation ──────────────────────────────────────────────
//
// Given a person's name and an organisation's domain, produce the addresses
// that organisation plausibly uses. This is the standard opening move of an
// engagement: you have a domain from recon and a name from LinkedIn, and you
// need the mailbox before anything else can happen.
//
// The honesty rule this module lives under: these are CANDIDATES, never
// findings. Nothing here verifies that an address exists — SMTP callback
// verification is unreliable (catch-all domains answer yes to everything,
// greylisting answers no to everything) and noisy against a live target. The
// output is a list to test elsewhere, and the UI must say so.
//
// `inferPattern` is the part that changes the odds: one known address at the
// domain collapses seventeen guesses into one rule.

export interface NameParts {
  first: string;
  middle: string | null;
  last: string;
}

export interface EmailCandidate {
  address: string;
  /** The rule that produced it, e.g. "first.last". */
  pattern: string;
  /**
   * Rough real-world prevalence of the pattern, 0-100. An ordering hint for
   * the analyst, not a probability that this mailbox exists.
   */
  weight: number;
}

/**
 * Split a display name into parts.
 *
 * Diacritics are folded because mail systems overwhelmingly do the same:
 * "José Müller" is provisioned as jose.muller, not josé.müller. Everything
 * outside `a-z` is dropped after folding, which also takes care of the
 * apostrophe in "O'Brien" (obrien) and leaves hyphenated surnames joined.
 *
 * A single-token name yields `last: ""`; the generator then emits only the
 * patterns that do not need a surname rather than producing "john." addresses.
 */
export function parseName(raw: string): NameParts | null {
  const tokens = raw
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[\s,]+/)
    .map((t) => t.replace(/[^a-z]/g, ""))
    .filter(Boolean);
  if (tokens.length === 0) return null;
  if (tokens.length === 1) return { first: tokens[0], middle: null, last: "" };
  return {
    first: tokens[0],
    middle: tokens.length > 2 ? tokens[1] : null,
    last: tokens[tokens.length - 1],
  };
}

interface PatternDef {
  id: string;
  weight: number;
  /** Returns null when the pattern cannot be built from these parts. */
  build: (n: NameParts) => string | null;
}

// Weights reflect what actually turns up across corporate mail: first.last is
// the overwhelming default, the initial-plus-surname forms dominate the rest,
// and surname-first forms are common in European and Japanese organisations
// without being the global norm.
const PATTERNS: PatternDef[] = [
  { id: "first.last",  weight: 95, build: (n) => n.last ? `${n.first}.${n.last}` : null },
  { id: "flast",       weight: 80, build: (n) => n.last ? `${n.first[0]}${n.last}` : null },
  { id: "firstlast",   weight: 70, build: (n) => n.last ? `${n.first}${n.last}` : null },
  { id: "first",       weight: 60, build: (n) => n.first },
  { id: "first_last",  weight: 50, build: (n) => n.last ? `${n.first}_${n.last}` : null },
  { id: "f.last",      weight: 48, build: (n) => n.last ? `${n.first[0]}.${n.last}` : null },
  { id: "firstl",      weight: 40, build: (n) => n.last ? `${n.first}${n.last[0]}` : null },
  { id: "first.l",     weight: 35, build: (n) => n.last ? `${n.first}.${n.last[0]}` : null },
  { id: "last.first",  weight: 32, build: (n) => n.last ? `${n.last}.${n.first}` : null },
  { id: "lastfirst",   weight: 28, build: (n) => n.last ? `${n.last}${n.first}` : null },
  { id: "first-last",  weight: 25, build: (n) => n.last ? `${n.first}-${n.last}` : null },
  { id: "lfirst",      weight: 20, build: (n) => n.last ? `${n.last[0]}${n.first}` : null },
  { id: "last",        weight: 18, build: (n) => n.last || null },
  { id: "l.first",     weight: 15, build: (n) => n.last ? `${n.last[0]}.${n.first}` : null },
  { id: "fl",          weight: 12, build: (n) => n.last ? `${n.first[0]}${n.last[0]}` : null },
  { id: "first.m.last", weight: 10, build: (n) => n.middle && n.last ? `${n.first}.${n.middle[0]}.${n.last}` : null },
  { id: "fmlast",      weight: 8,  build: (n) => n.middle && n.last ? `${n.first[0]}${n.middle[0]}${n.last}` : null },
];

/**
 * Candidate addresses, most-likely first.
 *
 * De-duplicated by address: for a name whose first and last are the same token
 * several patterns collapse onto one string, and showing it four times over
 * would imply four independent reasons to believe it.
 */
export function permuteEmails(name: string, domain: string): EmailCandidate[] {
  const parts = parseName(name);
  const host = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  if (!parts || !host) return [];

  const seen = new Set<string>();
  const out: EmailCandidate[] = [];
  for (const p of PATTERNS) {
    const local = p.build(parts);
    if (!local) continue;
    const address = `${local}@${host}`;
    if (seen.has(address)) continue;
    seen.add(address);
    out.push({ address, pattern: p.id, weight: p.weight });
  }
  return out.sort((a, b) => b.weight - a.weight);
}

/**
 * Work backwards from one known address to the organisation's rule.
 *
 * Ambiguity is real and is reported rather than resolved: "sam.sam@x.com" for
 * Sam Sam matches first.last and last.first identically, and picking one would
 * be inventing certainty. The caller gets every rule that fits.
 */
export function inferPattern(knownEmail: string, knownName: string): string[] {
  const local = knownEmail.split("@")[0]?.trim().toLowerCase();
  const parts = parseName(knownName);
  if (!local || !parts) return [];
  return PATTERNS.filter((p) => p.build(parts) === local).map((p) => p.id);
}

/** Apply a rule discovered by `inferPattern` to a different person. */
export function applyPattern(patternId: string, name: string, domain: string): string | null {
  const parts = parseName(name);
  const def = PATTERNS.find((p) => p.id === patternId);
  const host = domain.trim().toLowerCase().replace(/^www\./, "");
  if (!parts || !def || !host) return null;
  const local = def.build(parts);
  return local ? `${local}@${host}` : null;
}
