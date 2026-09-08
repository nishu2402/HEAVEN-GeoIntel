// ── AI analysis orchestrator — one call, one grounded assessment ─────────────
//
// analyzeLookup() is the single entry point the UI and later phases use. Given a
// finished lookup response it extracts the signal features (signals.ts), scores
// them through the explainable risk model (risk.ts), names cross-field anomalies
// (anomaly.ts), and narrates the result in plain language (summary.ts). Pure and
// deterministic end to end: no network, no clock, no randomness, nothing
// invented. The whole bundle is what the optional local/cloud analyst (Phase 3)
// reasons over, so grounding is guaranteed one layer down from any model.

import type {
  LookupResponse, EmailLookupResponse, UsernameLookupResponse,
  IpLookupResponse, DomainLookupResponse, WalletLookupResponse, HashLookupResponse,
} from "../types";
import {
  signalsFromEmail, signalsFromPhone, signalsFromUsername, signalsFromIp,
  signalsFromDomain, signalsFromWallet, signalsFromHash, type Signal,
} from "./signals";
import {
  anomaliesFromEmail, anomaliesFromPhone, anomaliesFromUsername,
  anomaliesFromIp, anomaliesFromDomain, type Anomaly,
} from "./anomaly";
import { scoreRisk, type RiskAssessment } from "./risk";
import { narrate } from "./summary";

export type { Signal, SignalCategory } from "./signals";
export type { RiskAssessment, RiskFactor, RiskBand } from "./risk";
export type { Anomaly, AnomalySeverity } from "./anomaly";

export type AiSubjectKind = "phone" | "email" | "username" | "ip" | "domain" | "wallet" | "hash";

export interface AiAnalysis {
  kind: AiSubjectKind;
  /** The identifier assessed (email, e164, handle, ip, domain, address, digest). */
  subject: string;
  signals: Signal[];
  risk: RiskAssessment;
  anomalies: Anomaly[];
  /** Grounded, model-free narration of the assessment. */
  summary: string[];
}

/** Discriminated input so the dispatch is type-safe with no casts. */
export type AnalyzeInput =
  | { kind: "phone"; data: LookupResponse }
  | { kind: "email"; data: EmailLookupResponse }
  | { kind: "username"; data: UsernameLookupResponse }
  | { kind: "ip"; data: IpLookupResponse }
  | { kind: "domain"; data: DomainLookupResponse }
  | { kind: "wallet"; data: WalletLookupResponse }
  | { kind: "hash"; data: HashLookupResponse };

/**
 * Analyse one finished lookup into an explainable, grounded AiAnalysis.
 * The single entry point for every AI surface in the app.
 */
export function analyzeLookup(input: AnalyzeInput): AiAnalysis {
  let signals: Signal[];
  let anomalies: Anomaly[];
  let subject: string;

  switch (input.kind) {
    case "phone":
      signals = signalsFromPhone(input.data);
      anomalies = anomaliesFromPhone(input.data);
      subject = input.data.analysis.e164;
      break;
    case "email":
      signals = signalsFromEmail(input.data);
      anomalies = anomaliesFromEmail(input.data);
      subject = input.data.email;
      break;
    case "username":
      signals = signalsFromUsername(input.data);
      anomalies = anomaliesFromUsername(input.data);
      subject = input.data.username;
      break;
    case "ip":
      signals = signalsFromIp(input.data);
      anomalies = anomaliesFromIp(input.data);
      subject = input.data.input;
      break;
    case "domain":
      signals = signalsFromDomain(input.data);
      anomalies = anomaliesFromDomain(input.data);
      subject = input.data.domain;
      break;
    case "wallet":
      // No keyless source attests wallet intent, so wallet emits only
      // informational signals and no anomalies.
      signals = signalsFromWallet(input.data);
      anomalies = [];
      subject = input.data.input;
      break;
    default:
      // "hash": a known-software match is reassuring, absence is neutral.
      signals = signalsFromHash(input.data);
      anomalies = [];
      subject = input.data.input;
      break;
  }

  const risk = scoreRisk(signals);
  const analysis: AiAnalysis = { kind: input.kind, subject, signals, risk, anomalies, summary: [] };
  analysis.summary = narrate(analysis);
  return analysis;
}
