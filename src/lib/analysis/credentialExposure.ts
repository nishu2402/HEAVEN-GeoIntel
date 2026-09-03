// ── Credential exposure + password-reuse assessment ──────────────────────────
//
// Three independent kinds of evidence say a password leaked:
//   • the breach union — how many breaches that named this identifier also
//     exposed passwords (from the aggregate's per-breach password evidence);
//   • ProxyNova COMB — actual (masked) email:password pairs for this address,
//     matched on the exact login (email only);
//   • Hudson Rock infostealer logs — passwords a stealer captured off an infected
//     machine, keyed on the exact identifier (email, phone, OR username), already
//     masked at the source. This is the "different upstream, not COMB" that gives
//     phone and username modes real credential evidence: it never substring-
//     matches, so it can't manufacture the false positive COMB's exact-login
//     discipline exists to prevent.
//
// This pure function fuses them into one view and, carefully, into a reuse
// verdict. Reuse is the claim a ten-year analyst most wants and the easiest to
// overstate, so it is claimable ONLY when the visible distinct-password set is
// small yet the identifier's password was exposed across MORE breaches than
// that — i.e. the same few passwords span many breached sites. That verdict rests
// on COMB's CLEARTEXT distinct count alone: Hudson Rock's passwords arrive masked,
// and masking can collapse two distinct passwords into one shape, which would bias
// a distinct-count-driven reuse call toward over-claiming. So stealer captures
// raise EXPOSURE (all modes) but never, on their own, the "reuse likely" verdict.

import type { CombExposure, HudsonRockData } from "../types";

export type ReuseLevel = "none" | "exposed" | "likely";

export interface CredentialExposure {
  /** Distinct leaked passwords actually seen (COMB) — a floor, never a guess. */
  distinctPasswords: number;
  /** Total leaked pairs seen (COMB) — a floor. */
  pairs: number;
  /** True when COMB truncated its page, so more may exist beyond it. */
  capped: boolean;
  /** Masked password previews — never a usable secret. */
  samples: string[];
  /** Breaches in the union that exposed a password for this identifier. */
  passwordBreaches: number;
  /** Infostealer logs that captured at least one credential for this identifier. */
  stealerLogs: number;
  /** Distinct passwords captured across those logs (masked at source) — a floor. */
  stealerPasswords: number;
  /** True when any leaked-credential evidence exists at all. */
  exposed: boolean;
  /** Reuse assessment across the combined evidence. */
  reuse: ReuseLevel;
}

/** Infostealer credential evidence distilled from a Hudson Rock result. */
export interface StealerCredentialSummary {
  /** Infostealer logs that captured at least one password for this identifier. */
  logs: number;
  /** Distinct captured passwords across those logs (masked at source) — a floor. */
  distinctPasswords: number;
}

const NO_COMB: CombExposure = { pairs: 0, distinctPasswords: 0, capped: false, samples: [] };
const NO_STEALER: StealerCredentialSummary = { logs: 0, distinctPasswords: 0 };

/**
 * Distil Hudson Rock's stealer records into a credential summary. Counts only
 * logs that actually captured a password (an infection that surfaced no password
 * is device compromise, reported by the infostealer panel, not password exposure)
 * and the distinct set of those masked passwords — a floor, since masking can
 * collapse two real passwords that share a shape, and the record list is capped.
 */
export function stealerCredentialSummary(
  hr: HudsonRockData | null | undefined,
): StealerCredentialSummary {
  if (!hr || hr.stealers.length === 0) return NO_STEALER;
  const passwords = new Set<string>();
  let logs = 0;
  for (const s of hr.stealers) {
    const pws = s.topPasswords.map((p) => p.trim()).filter((p) => p.length > 0);
    if (pws.length > 0) logs++;
    for (const p of pws) passwords.add(p);
  }
  return { logs, distinctPasswords: passwords.size };
}

/**
 * Decide the reuse level from the visible distinct-password count and the
 * number of password-exposing breaches.
 */
export function assessReuse(distinctPasswords: number, passwordBreaches: number): ReuseLevel {
  if (distinctPasswords === 0 && passwordBreaches === 0) return "none";
  if (distinctPasswords >= 1 && passwordBreaches > distinctPasswords && passwordBreaches >= 2) {
    return "likely";
  }
  return "exposed";
}

/**
 * Fuse the three evidence kinds — COMB (may be absent), the union's
 * password-breach count, and infostealer captures (default: none) — into one
 * view. Any of them flips `exposed`; the strong `reuse` verdict stays keyed on
 * COMB's cleartext distinct count alone (see the module note).
 */
export function assessCredentialExposure(
  comb: CombExposure | null,
  passwordBreaches: number,
  stealer: StealerCredentialSummary = NO_STEALER,
): CredentialExposure {
  const c = comb ?? NO_COMB;
  return {
    distinctPasswords: c.distinctPasswords,
    pairs: c.pairs,
    capped: c.capped,
    samples: c.samples,
    passwordBreaches,
    stealerLogs: stealer.logs,
    stealerPasswords: stealer.distinctPasswords,
    exposed: c.pairs > 0 || passwordBreaches > 0 || stealer.distinctPasswords > 0,
    reuse: assessReuse(c.distinctPasswords, passwordBreaches),
  };
}
