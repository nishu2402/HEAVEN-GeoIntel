// ── Anomaly detection — cross-field combinations worth a callout ─────────────
//
// A single signal is a fact; an anomaly is a COMBINATION of facts whose joint
// meaning is greater than either alone (a password both breached and captured by
// malware; an exposed service that also carries a live CVE). The risk model
// already folds signals into a number, so anomalies exist to name the specific,
// actionable pattern in words an analyst acts on.
//
// Same discipline as the rest of the AI layer: pure, and every anomaly rests on
// fields the response already holds. Nothing is inferred beyond the combination.

import type {
  LookupResponse, EmailLookupResponse, UsernameLookupResponse,
  IpLookupResponse, DomainLookupResponse,
  BreachAggregate, CredentialExposure,
} from "../types";

export type AnomalySeverity = "info" | "warn" | "high" | "critical";

export interface Anomaly {
  id: string;
  title: string;
  detail: string;
  severity: AnomalySeverity;
}

// ── Shared credential-combination rules ──────────────────────────────────────

// The caller reaches this only with a present `cx`, so it takes a non-null one:
// "was a password breached anywhere" is cx's own count OR the union's.
function passwordBreachedElsewhere(agg: BreachAggregate | undefined, cx: CredentialExposure): boolean {
  if (cx.passwordBreaches > 0) return true;
  if (agg && agg.withPassword > 0) return true;
  return false;
}

function credComboAnomalies(
  agg: BreachAggregate | undefined,
  cx: CredentialExposure | undefined,
): Anomaly[] {
  const out: Anomaly[] = [];

  if (cx && cx.stealerLogs > 0 && passwordBreachedElsewhere(agg, cx)) {
    out.push({
      id: "combo.stealer_breach",
      title: "Credentials both breached and malware-captured",
      detail:
        "The identity appears in a public breach exposing a password and in infostealer logs, so a working credential is very likely in active circulation.",
      severity: "critical",
    });
  }

  if (agg && agg.withPassword > 0 && cx && cx.reuse === "likely") {
    out.push({
      id: "combo.reuse_plaintext",
      title: "Reused password exposed",
      detail:
        "A password was exposed in a breach and reuse looks likely, so any other account sharing that password is at risk.",
      severity: "high",
    });
  }

  return out;
}

// ── Email ────────────────────────────────────────────────────────────────────

export function anomaliesFromEmail(d: EmailLookupResponse): Anomaly[] {
  const out = credComboAnomalies(d.breachAggregate, d.credentialExposure);

  const rep = d.emailrep.ok ? d.emailrep.data : undefined;
  const breachTotal = d.breachAggregate ? d.breachAggregate.total : 0;
  if (rep && rep.maliciousActivity && breachTotal > 0) {
    out.push({
      id: "combo.malicious_breach",
      title: "Address flagged malicious and breach-exposed",
      detail:
        "A reputation source reports malicious activity for this address and it also appears in breach corpora, a pattern typical of a compromised or throwaway account.",
      severity: "high",
    });
  }

  return out;
}

// ── Phone ────────────────────────────────────────────────────────────────────

export function anomaliesFromPhone(d: LookupResponse): Anomaly[] {
  return credComboAnomalies(d.breachAggregate, d.credentialExposure);
}

// ── Username ─────────────────────────────────────────────────────────────────

export function anomaliesFromUsername(d: UsernameLookupResponse): Anomaly[] {
  const out = credComboAnomalies(d.breachAggregate, d.credentialExposure);

  const nameSources = new Set(d.identity.names.map((n) => n.source));
  const breachTotal = d.breachAggregate ? d.breachAggregate.total : 0;
  if (nameSources.size >= 2 && breachTotal > 0) {
    out.push({
      id: "combo.identity_breach",
      title: "Real identity resolvable and breach-exposed",
      detail:
        "A consistent real name resolves across multiple confirmed profiles and the same handle appears in breaches, so the person behind the handle is both identifiable and exposed.",
      severity: "high",
    });
  }

  return out;
}

// ── IP ───────────────────────────────────────────────────────────────────────

export function anomaliesFromIp(d: IpLookupResponse): Anomaly[] {
  const out: Anomaly[] = [];
  const ip = d.ip;
  if (!ip) return out;

  const hasPorts = !!ip.ports && ip.ports.length > 0;

  if (hasPorts && ip.vulns && ip.vulns.length > 0) {
    out.push({
      id: "combo.exposed_cve",
      title: "Internet-exposed service with known CVEs",
      detail: `The host exposes services and carries ${ip.vulns.length} known ${ip.vulns.length === 1 ? "vulnerability" : "vulnerabilities"}, a directly exploitable combination.`,
      severity: "high",
    });
  }

  if (hasPorts && ip.greyNoise && ip.greyNoise.classification === "malicious") {
    out.push({
      id: "combo.malicious_scanner",
      title: "Malicious scanner with open services",
      detail:
        "The address is both classified as a malicious scanner and exposes open services, so it may be a compromised host used to attack others.",
      severity: "high",
    });
  }

  return out;
}

// ── Domain ───────────────────────────────────────────────────────────────────

export function anomaliesFromDomain(d: DomainLookupResponse): Anomaly[] {
  const out: Anomaly[] = [];

  if (d.takeoverCandidates && d.takeoverCandidates.length > 0) {
    out.push({
      id: "domain.takeover",
      title: "Subdomain-takeover candidate",
      detail: `${d.takeoverCandidates.length} dangling DNS ${d.takeoverCandidates.length === 1 ? "record points" : "records point"} at a takeover-prone service and should be verified and reclaimed.`,
      severity: "high",
    });
  }

  if (d.http && d.http.tls && d.http.tls.daysRemaining !== null && d.http.tls.daysRemaining < 0) {
    out.push({
      id: "domain.tls_expired",
      title: "Serving an expired certificate",
      detail: "The live TLS certificate has expired, so browsers will warn visitors and mail delivery may break.",
      severity: "warn",
    });
  }

  if (d.emailSecurity.hasMx && !d.emailSecurity.hasDmarc) {
    out.push({
      id: "domain.spoofable",
      title: "Mail domain can be spoofed",
      detail: "The domain accepts mail but publishes no DMARC policy, so anyone can send mail that appears to come from it.",
      severity: "warn",
    });
  }

  return out;
}
