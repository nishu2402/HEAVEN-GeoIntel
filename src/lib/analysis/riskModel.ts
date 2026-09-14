// ── Two figures, not one: exposure and abuse ─────────────────────────────────
//
// The old single "threat score" answered two different questions with one
// number, and got both wrong in the same breath. Measured live: the White House
// switchboard, +1 202 456 1111, scored 20 / MODERATE — entirely because a public
// breach index holds 11 records mentioning it. A published number appearing in a
// marketing dump is EXPOSURE. It is not a claim that the line is dangerous, and
// an analyst triaging by that bar was reading a threat that did not exist.
//
// So the two are separated at the source:
//
//   exposure — what is already out there about this identifier: breach records,
//              credential dumps, infostealer captures. The subject is the
//              victim. High exposure is a reason to warn someone, not to
//              distrust them.
//   abuse    — signals that the identifier itself behaves badly or is
//              structurally risky: a fraud score, a recent-abuse flag, a
//              blacklisting, premium-rate billing. The subject is the actor.
//
// Both are 0-100 and both carry their reasons, because a bar with no explanation
// is not evidence. Nothing here invents a signal: every reason names the input
// that produced it, and a null input contributes nothing at all.

export interface RiskFigure {
  /** 0-100. */
  score: number;
  label: string;
  /** One line per contributing signal, in the analyst's terms. */
  reasons: string[];
}

/** Raise a floor without letting a second weak signal push past a strong one. */
function floor(current: number, at: number): number {
  return Math.max(current, at);
}

const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

// ── Exposure ─────────────────────────────────────────────────────────────────

export interface ExposureInput {
  /** Indexed breach records mentioning the identifier (LeakCheck `found`). */
  breachRecords?: number | null;
  /**
   * True when `breachRecords` is the source's ceiling rather than a total. Only
   * changes how the reason reads: the score already saturates far below it.
   */
  breachRecordsAtLeast?: boolean | null;
  /** Distinct named breaches it appears in. */
  namedBreaches?: number | null;
  /** Credential pairs recovered for it (BreachDirectory / COMB). */
  credentialRecords?: number | null;
  /** Infostealer-infected machines that captured it (Hudson Rock `total`). */
  stealerInfections?: number | null;
  /** A source stating outright that credentials for it have leaked. */
  credentialsLeaked?: boolean | null;
}

/** 0 → nothing observed; the bands above it are evidence volume, not danger. */
export function exposureLabelFor(score: number): string {
  if (score === 0) return "NONE OBSERVED";
  if (score < 25) return "LIMITED";
  if (score < 60) return "SIGNIFICANT";
  return "EXTENSIVE";
}

/**
 * How much of this identifier is already public.
 *
 * Infostealer captures dominate deliberately: a stealer log means a specific
 * machine handed over live credentials, which is a different order of evidence
 * from a name appearing in a ten-year-old forum dump.
 */
export function assessExposure(i: ExposureInput): RiskFigure {
  let score = 0;
  const reasons: string[] = [];

  const infections = i.stealerInfections ?? 0;
  if (infections > 0) {
    score = floor(score, 70);
    score += Math.min(infections * 5, 25);
    reasons.push(`captured by ${infections} infostealer infection${infections === 1 ? "" : "s"}`);
  }

  const creds = i.credentialRecords ?? 0;
  if (creds > 0) {
    score = floor(score, 50);
    score += Math.min(creds * 5, 20);
    reasons.push(`${creds} credential record${creds === 1 ? "" : "s"} recovered`);
  }

  if (i.credentialsLeaked === true) {
    score = floor(score, 45);
    reasons.push("a reputation source reports leaked credentials");
  }

  const named = i.namedBreaches ?? 0;
  if (named > 0) {
    score += Math.min(named * 8, 40);
    reasons.push(`named in ${named} breach${named === 1 ? "" : "es"}`);
  }

  const records = i.breachRecords ?? 0;
  if (records > 0) {
    score += Math.min(records * 2, 25);
    // A count the source stopped at is reported as a floor. "1000 records" and
    // "1000+ records" score identically; only one of them is true.
    const atLeast = i.breachRecordsAtLeast === true ? "+" : "";
    reasons.push(`${records}${atLeast} indexed breach record${records === 1 ? "" : "s"}`);
  }

  const final = clamp(score);
  return { score: final, label: exposureLabelFor(final), reasons };
}

// ── Abuse ────────────────────────────────────────────────────────────────────

export function abuseLabelFor(score: number): string {
  if (score >= 70) return "CRITICAL";
  if (score >= 40) return "HIGH RISK";
  if (score >= 20) return "MODERATE";
  if (score > 0) return "LOW RISK";
  return "CLEAN";
}

export interface PhoneAbuseInput {
  /** A provider's own 0-100 fraud score. */
  fraudScore?: number | null;
  isRisky?: boolean | null;
  recentAbuse?: boolean | null;
  isVoip?: boolean | null;
  /** False means the provider says the line is not in service. */
  active?: boolean | null;
  prepaid?: boolean | null;
  isPremiumRate?: boolean | null;
}

/**
 * Abuse risk for a phone number. Every weight is the one the old combined score
 * used for the same signal, so a genuinely abusive number scores exactly as it
 * did; what changed is that breach volume no longer leaks in here.
 */
export function assessPhoneAbuse(i: PhoneAbuseInput): RiskFigure {
  let score = 0;
  const reasons: string[] = [];

  if (typeof i.fraudScore === "number" && Number.isFinite(i.fraudScore) && i.fraudScore > 0) {
    score = floor(score, Math.round(i.fraudScore * 0.6));
    reasons.push(`provider fraud score ${i.fraudScore}/100`);
  }
  if (i.isPremiumRate === true) {
    score = floor(score, 60);
    reasons.push("premium-rate range: billed to the caller");
  }
  if (i.isRisky === true) {
    score = floor(score, 55);
    reasons.push("flagged risky by a provider");
  }
  if (i.recentAbuse === true) {
    score = floor(score, 50);
    reasons.push("recent abuse reported");
  }
  if (i.active === false) {
    score = floor(score, 30);
    reasons.push("line reported not in service");
  }
  if (i.isVoip === true) {
    score = floor(score, 25);
    reasons.push("confirmed VOIP line");
  }
  if (i.prepaid === true) {
    score += 5;
    reasons.push("prepaid SIM");
  }

  const final = clamp(score);
  return { score: final, label: abuseLabelFor(final), reasons };
}

export interface EmailAbuseInput {
  blacklisted?: boolean | null;
  maliciousActivity?: boolean | null;
  suspicious?: boolean | null;
  spam?: boolean | null;
  /** Reputation word a source assigned ("none" / "low" / "medium" / "high"). */
  reputation?: string | null;
  isDisposable?: boolean | null;
}

/** Abuse risk for an email address. Same weights the email bar used before. */
export function assessEmailAbuse(i: EmailAbuseInput): RiskFigure {
  let score = 0;
  const reasons: string[] = [];

  if (i.blacklisted === true) {
    score = floor(score, 60);
    reasons.push("blacklisted by a reputation source");
  }
  if (i.maliciousActivity === true) {
    score = floor(score, 50);
    reasons.push("malicious activity reported");
  }
  if (i.suspicious === true) {
    score = floor(score, 40);
    reasons.push("marked suspicious by a reputation source");
  }
  if (i.isDisposable === true) {
    score = floor(score, 20);
    reasons.push("disposable / throwaway provider");
  }
  if (i.spam === true) {
    score += 5;
    reasons.push("seen in spam reports");
  }
  const rep = (i.reputation ?? "").trim().toLowerCase();
  if (rep === "low") {
    score = floor(score, 30);
    reasons.push("reputation reported low");
  }

  const final = clamp(score);
  return { score: final, label: abuseLabelFor(final), reasons };
}

/**
 * The pair, as every mode reports it. `abuse` keeps the `threatScore` name in
 * the API for compatibility; `exposure` is the figure that used to be folded
 * into it.
 */
export interface RiskPair {
  abuse: RiskFigure;
  exposure: RiskFigure;
}
