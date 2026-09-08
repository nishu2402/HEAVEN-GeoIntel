// ── Explainable risk model — a logistic scorer over the signal features ──────
//
// This is deliberately a linear-logistic model with hand-set, checked-in
// coefficients rather than a black box: score = sigmoid(bias + Σ wᵢ·intensityᵢ),
// mapped to 0-100. Every point of the score decomposes back into the signals
// that produced it, so the panel can show WHY, and a wrong number is auditable
// against the fields it rests on. The coefficients live here as one table; a
// future trained model can replace the constants without touching a caller.
//
// Pure and deterministic: same signals in, same assessment out. It invents no
// data — it only weighs the signals signals.ts already grounded in real fields.

import type { Signal, SignalCategory } from "./signals";

export type RiskBand = "minimal" | "low" | "elevated" | "high" | "critical";

export interface RiskFactor {
  id: string;
  label: string;
  category: SignalCategory;
  intensity: number;
  weight: number;
  /** Weighted contribution wᵢ·intensityᵢ (the model's logit term). */
  contribution: number;
  /** This factor's share of the total positive contribution, in [0,1]. */
  share: number;
  evidence: string;
}

export interface RiskAssessment {
  /** 0-100. */
  score: number;
  band: RiskBand;
  /** How much evidence the score rests on, from the count of risk signals. */
  confidence: "low" | "medium" | "high";
  /** Contributing signals (intensity > 0), most influential first. */
  factors: RiskFactor[];
  /** One grounded sentence. No fact a source did not report. */
  rationale: string;
}

// Logistic intercept. With no positive signals the score is sigmoid(BIAS)·100,
// i.e. a deliberately small floor rather than a hard zero.
const BIAS = -3.2;

// Per-signal coefficients. The heaviest weights sit on direct evidence of
// compromise (malware capture, live CVEs, a compromised-host flag); the lightest
// on hygiene observations that colour a picture without proving harm.
const WEIGHTS: Record<string, number> = {
  "malware.stealer": 3.2,
  "exposure.compromised": 3.2,
  "network.scanner": 2.8,
  "exposure.vulns": 2.6,
  "credential.plaintext": 2.6,
  "infra.takeover": 2.4,
  "breach.password": 2.2,
  "reputation.malicious": 2.2,
  "network.tor": 1.6,
  "infra.tls_expired": 1.6,
  "infra.tls_untrusted": 1.5,
  "credential.reuse": 1.4,
  "breach.count": 1.4,
  "network.anonymizer": 1.4,
  "infra.security_grade": 1.4,
  "infra.no_dmarc": 1.2,
  "exposure.ports": 1.0,
  "hash.lowtrust": 1.0,
  "identity.resolved": 0.9,
  "hygiene.disposable": 0.9,
  "hygiene.premium": 0.9,
  "network.hosting": 0.8,
  "footprint.accounts": 0.7,
  "network.noise": 1.5,
  "breach.domain": 0.6,
  "hygiene.voip": 0.5,
  "hygiene.role": 0.5,
};

// Fallback when a signal id is not in the table above: weigh by category so a
// new signal still scores sensibly before it earns a tuned coefficient.
const CATEGORY_WEIGHTS: Record<SignalCategory, number> = {
  malware: 3.0,
  credential: 2.2,
  breach: 1.4,
  network: 1.4,
  infrastructure: 1.2,
  reputation: 1.6,
  identity: 0.8,
  hygiene: 0.6,
};

function weightFor(s: Signal): number {
  const byId = WEIGHTS[s.id];
  if (byId !== undefined) return byId;
  return CATEGORY_WEIGHTS[s.category];
}

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));

function bandFor(score: number): RiskBand {
  if (score < 15) return "minimal";
  if (score < 35) return "low";
  if (score < 60) return "elevated";
  if (score < 80) return "high";
  return "critical";
}

function confidenceFor(factorCount: number): "low" | "medium" | "high" {
  if (factorCount === 0) return "low";
  if (factorCount < 3) return "medium";
  return "high";
}

/**
 * Score a set of signals into an explainable risk assessment. Signals with an
 * intensity of 0 are informational: they render in the panel but never move the
 * score, so they are excluded from the factor list.
 */
export function scoreRisk(signals: Signal[]): RiskAssessment {
  const contributing = signals.filter((s) => s.intensity > 0);

  let logit = BIAS;
  const raw = contributing.map((s) => {
    const weight = weightFor(s);
    const contribution = weight * s.intensity;
    logit += contribution;
    return { s, weight, contribution };
  });

  // Every contributing signal has intensity > 0 and a positive weight, so the
  // total is > 0 whenever `raw` is non-empty. When `raw` is empty this map never
  // runs, so the division below is never reached with a zero denominator.
  const totalContribution = raw.reduce((sum, r) => sum + r.contribution, 0);

  const factors: RiskFactor[] = raw
    .map(({ s, weight, contribution }) => ({
      id: s.id,
      label: s.label,
      category: s.category,
      intensity: s.intensity,
      weight,
      contribution,
      share: contribution / totalContribution,
      evidence: s.evidence,
    }))
    .sort((a, b) => b.contribution - a.contribution || a.id.localeCompare(b.id));

  const score = Math.round(sigmoid(logit) * 100);
  const band = bandFor(score);
  const confidence = confidenceFor(factors.length);

  const top = factors[0];
  const rationale = top
    ? `${band === "critical" || band === "high" ? "Elevated" : "Some"} risk driven chiefly by ${top.label.toLowerCase()} (${top.evidence}).`
    : "No positive-risk signals were found across the sources that answered.";

  return { score, band, confidence, factors, rationale };
}
