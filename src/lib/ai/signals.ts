// ── AI signal extraction — the feature layer beneath the risk model ──────────
//
// A Signal is one risk-relevant fact the deterministic lookups ALREADY found,
// normalised to a [0,1] intensity and carrying the exact field it came from.
// Nothing here is invented: every signal cites a value that appeared verbatim in
// the response, the same contract autoPivot.ts holds every pivot to. This is the
// "feature vector" the explainable risk model (risk.ts) scores.
//
// Intensity is the raw, un-weighted severity of the fact on its own. Intensity 0
// marks a fact worth SHOWING that carries no risk of its own — a known-good file
// hash, a benign scanner classification, a private-scope IP — so the panel can
// display it while the risk model, multiplying by it, adds nothing to the score.
// We never lower a score for a "reassuring" fact: a clean subject simply has no
// positive-intensity signals, which is already a low score by construction.

import type {
  LookupResponse, EmailLookupResponse, UsernameLookupResponse,
  IpLookupResponse, DomainLookupResponse, WalletLookupResponse, HashLookupResponse,
  BreachAggregate, CredentialExposure,
} from "../types";

export type SignalCategory =
  | "breach"
  | "credential"
  | "malware"
  | "network"
  | "infrastructure"
  | "reputation"
  | "identity"
  | "hygiene";

export interface Signal {
  /** Stable dotted id, e.g. "breach.count". Also the key into the weight table. */
  id: string;
  /** Human label for the panel. */
  label: string;
  category: SignalCategory;
  /** Un-weighted severity in [0,1]. 0 = informational (no risk of its own). */
  intensity: number;
  /** The real field/value this came from. Never a guess. */
  evidence: string;
}

/**
 * Saturating ramp: a non-negative `value` reaches full intensity (1) at `full`
 * and holds there. Callers only ever pass non-negative counts, so the ramp only
 * needs to clamp the top.
 */
const ramp = (value: number, full: number): number => Math.min(1, value / full);

/** English pluraliser for evidence strings (never shows a bare "1 breaches"). */
const plural = (n: number, one: string, many = `${one}s`): string => (n === 1 ? one : many);

// ── Shared: breach + credential signals ──────────────────────────────────────
// Email, phone and username all read from the same server-computed breach union
// and credential-exposure fusion, so the mapping lives once. Each branch is gated
// on positive evidence: a source that answered with zero hits produces nothing.

function credentialSignals(
  agg: BreachAggregate | undefined,
  cx: CredentialExposure | undefined,
): Signal[] {
  const out: Signal[] = [];

  if (agg && agg.total > 0) {
    out.push({
      id: "breach.count",
      label: "Appears in breach corpora",
      category: "breach",
      intensity: ramp(agg.total, 8),
      evidence: `${agg.total} ${plural(agg.total, "breach", "breaches")} reported by ${agg.sourcesReporting.join(", ")}`,
    });
  }

  if (agg && (agg.withPassword > 0 || agg.passwordFieldsSeen)) {
    const n = agg.withPassword;
    out.push({
      id: "breach.password",
      label: "Password exposed in a breach",
      category: "credential",
      intensity: n > 0 ? ramp(n, 3) : 0.4,
      evidence: n > 0
        ? `${n} ${plural(n, "breach", "breaches")} exposed a password`
        : "password fields appear in the breach set",
    });
  }

  if (cx && cx.distinctPasswords > 0) {
    out.push({
      id: "credential.plaintext",
      label: "Plaintext credentials leaked",
      category: "credential",
      intensity: ramp(cx.distinctPasswords, 4),
      evidence: `${cx.distinctPasswords} distinct ${plural(cx.distinctPasswords, "password")} seen in credential dumps`,
    });
  }

  if (cx && cx.stealerLogs > 0) {
    out.push({
      id: "malware.stealer",
      label: "Captured by infostealer malware",
      category: "malware",
      intensity: ramp(cx.stealerLogs, 2),
      evidence: `${cx.stealerLogs} infostealer ${plural(cx.stealerLogs, "log")} captured a credential`,
    });
  }

  if (cx && cx.reuse === "likely") {
    out.push({
      id: "credential.reuse",
      label: "Password reuse likely",
      category: "credential",
      intensity: 0.5,
      evidence: "distinct leaked passwords are few relative to the breach count",
    });
  }

  return out;
}

// ── Email ────────────────────────────────────────────────────────────────────

export function signalsFromEmail(d: EmailLookupResponse): Signal[] {
  const out = credentialSignals(d.breachAggregate, d.credentialExposure);

  const rep = d.emailrep.ok ? d.emailrep.data : undefined;
  if (rep && (rep.maliciousActivity || rep.blacklisted || rep.suspicious)) {
    out.push({
      id: "reputation.malicious",
      label: "Flagged by a reputation source",
      category: "reputation",
      intensity: rep.maliciousActivity ? 0.8 : rep.blacklisted ? 0.6 : 0.35,
      evidence: rep.maliciousActivity
        ? "EmailRep reports malicious activity"
        : rep.blacklisted
          ? "EmailRep reports the address blacklisted"
          : "EmailRep reports the address suspicious",
    });
  }

  if (d.analysis.isDisposable) {
    out.push({
      id: "hygiene.disposable",
      label: "Disposable email provider",
      category: "hygiene",
      intensity: 0.3,
      evidence: `provider ${d.analysis.providerName || d.analysis.domain} is a disposable service`,
    });
  }

  if (d.analysis.isRoleAddress) {
    out.push({
      id: "hygiene.role",
      label: "Role address (shared mailbox)",
      category: "hygiene",
      intensity: 0.15,
      evidence: "local part is a role name such as admin, info or support",
    });
  }

  return out;
}

// ── Phone ────────────────────────────────────────────────────────────────────

export function signalsFromPhone(d: LookupResponse): Signal[] {
  const out = credentialSignals(d.breachAggregate, d.credentialExposure);
  const a = d.analysis;

  if (a.isPremiumRate) {
    out.push({
      id: "hygiene.premium",
      label: "Premium-rate number",
      category: "hygiene",
      intensity: 0.3,
      evidence: "number is a premium-rate line, a common charge-scam vector",
    });
  }

  if (a.isVoip) {
    out.push({
      id: "hygiene.voip",
      label: "VoIP line",
      category: "hygiene",
      intensity: 0.2,
      evidence: "number is carried over VoIP, more easily provisioned anonymously",
    });
  }

  if (d.offline.confidence === "low") {
    out.push({
      id: "hygiene.unconfirmed",
      label: "Line not confirmed as active",
      category: "hygiene",
      intensity: 0,
      evidence: "offline reputation confidence is low, so this may not be a live subscriber line",
    });
  }

  return out;
}

// ── Username ─────────────────────────────────────────────────────────────────

export function signalsFromUsername(d: UsernameLookupResponse): Signal[] {
  const out = credentialSignals(d.breachAggregate, d.credentialExposure);

  const nameSources = new Set(d.identity.names.map((n) => n.source));
  if (nameSources.size >= 2) {
    out.push({
      id: "identity.resolved",
      label: "Real identity resolvable",
      category: "identity",
      intensity: 0.4,
      evidence: `a consistent real name appears across ${nameSources.size} confirmed profiles`,
    });
  }

  if (d.found > 0) {
    out.push({
      id: "footprint.accounts",
      label: "Broad public account footprint",
      category: "identity",
      intensity: ramp(d.found, 15),
      evidence: `${d.found} confirmed ${plural(d.found, "account")} across checked sites`,
    });
  }

  return out;
}

// ── IP ───────────────────────────────────────────────────────────────────────

export function signalsFromIp(d: IpLookupResponse): Signal[] {
  const out: Signal[] = [];
  const ip = d.ip;
  if (!ip) return out;

  if (ip.isTor) {
    out.push({
      id: "network.tor",
      label: "Tor exit node",
      category: "network",
      intensity: 0.8,
      evidence: "address is a known Tor exit",
    });
  } else if (ip.isProxy || ip.isVpn) {
    out.push({
      id: "network.anonymizer",
      label: "Anonymising network",
      category: "network",
      intensity: 0.5,
      evidence: ip.isProxy ? "address is flagged as a proxy" : "address is flagged as a VPN",
    });
  }

  if (ip.isHosting) {
    out.push({
      id: "network.hosting",
      label: "Hosting / datacenter address",
      category: "network",
      intensity: 0.25,
      evidence: "address belongs to a hosting provider, not a consumer connection",
    });
  }

  const gn = ip.greyNoise;
  if (gn && gn.classification === "malicious") {
    out.push({
      id: "network.scanner",
      label: "Malicious internet scanner",
      category: "network",
      intensity: 0.85,
      evidence: `GreyNoise classifies the address malicious${gn.name ? ` (${gn.name})` : ""}`,
    });
  } else if (gn && gn.noise) {
    out.push({
      id: "network.noise",
      label: "Mass-scanning address",
      category: "network",
      intensity: 0.4,
      evidence: "GreyNoise has seen the address mass-scanning the internet",
    });
  } else if (gn && gn.riot) {
    out.push({
      id: "network.benign",
      label: "Common business service",
      category: "network",
      intensity: 0,
      evidence: "GreyNoise RIOT lists the address as a common, likely benign service",
    });
  }

  if (ip.tags && ip.tags.includes("compromised")) {
    out.push({
      id: "exposure.compromised",
      label: "Flagged compromised",
      category: "network",
      intensity: 0.9,
      evidence: "Shodan tags the host as compromised",
    });
  }

  if (ip.vulns && ip.vulns.length > 0) {
    out.push({
      id: "exposure.vulns",
      label: "Known CVEs on exposed services",
      category: "network",
      intensity: 0.85,
      evidence: `${ip.vulns.length} ${plural(ip.vulns.length, "CVE")} observed: ${ip.vulns.slice(0, 4).join(", ")}`,
    });
  }

  if (ip.ports && ip.ports.length > 0) {
    out.push({
      id: "exposure.ports",
      label: "Internet-exposed services",
      category: "network",
      intensity: ramp(ip.ports.length, 10),
      evidence: `${ip.ports.length} open ${plural(ip.ports.length, "port")}: ${ip.ports.slice(0, 6).join(", ")}`,
    });
  }

  if (d.classification && !d.classification.isGloballyRoutable) {
    out.push({
      id: "network.nonroutable",
      label: "Non-routable scope",
      category: "network",
      intensity: 0,
      evidence: `${d.classification.label}: not a public-internet host`,
    });
  }

  return out;
}

// ── Domain ───────────────────────────────────────────────────────────────────

export function signalsFromDomain(d: DomainLookupResponse): Signal[] {
  const out: Signal[] = [];
  const http = d.http;

  if (http && http.tls) {
    if (http.tls.daysRemaining !== null && http.tls.daysRemaining < 0) {
      out.push({
        id: "infra.tls_expired",
        label: "TLS certificate expired",
        category: "infrastructure",
        intensity: 0.7,
        evidence: `certificate expired ${Math.abs(http.tls.daysRemaining)} ${plural(Math.abs(http.tls.daysRemaining), "day")} ago`,
      });
    } else if (!http.tls.trusted) {
      out.push({
        id: "infra.tls_untrusted",
        label: "TLS chain not trusted",
        category: "infrastructure",
        intensity: 0.5,
        evidence: http.tls.trustError || "certificate did not validate against the trust store",
      });
    }
  }

  if (http && (http.security.grade === "D" || http.security.grade === "F" || http.security.grade === "C")) {
    const g = http.security.grade;
    out.push({
      id: "infra.security_grade",
      label: "Weak security-header posture",
      category: "infrastructure",
      intensity: g === "F" ? 0.6 : g === "D" ? 0.45 : 0.25,
      evidence: `security-header grade ${g} (${http.security.percent}%)`,
    });
  }

  if (d.emailSecurity.hasMx && !d.emailSecurity.hasDmarc) {
    out.push({
      id: "infra.no_dmarc",
      label: "No DMARC on a mail domain",
      category: "infrastructure",
      intensity: 0.4,
      evidence: "domain sends mail (MX present) but publishes no DMARC record, so it is spoofable",
    });
  }

  if (d.takeoverCandidates && d.takeoverCandidates.length > 0) {
    out.push({
      id: "infra.takeover",
      label: "Subdomain-takeover candidate",
      category: "infrastructure",
      intensity: 0.85,
      evidence: `${d.takeoverCandidates.length} dangling ${plural(d.takeoverCandidates.length, "record")} point at a takeover-prone service`,
    });
  }

  if (d.knownBreaches && d.knownBreaches.length > 0) {
    out.push({
      id: "breach.domain",
      label: "Domain catalogued in breaches",
      category: "breach",
      intensity: 0.15,
      evidence: `${d.knownBreaches.length} catalogued ${plural(d.knownBreaches.length, "breach", "breaches")} name this domain (a public record, not a live compromise)`,
    });
  }

  if (d.dnssec === false) {
    out.push({
      id: "infra.dnssec_off",
      label: "DNSSEC not enabled",
      category: "infrastructure",
      intensity: 0,
      evidence: "no DNSKEY published, so DNS answers are not cryptographically signed",
    });
  }

  return out;
}

// ── Wallet ───────────────────────────────────────────────────────────────────
// Keyless chain reads describe activity, never intent. There is no free source
// that attests a wallet is malicious, so wallet mode emits only informational
// (intensity 0) signals and the risk model correctly returns minimal.

export function signalsFromWallet(d: WalletLookupResponse): Signal[] {
  const out: Signal[] = [];
  const f = d.facts;
  if (!f) return out;

  if (f.txCount !== null && f.txCount > 0) {
    out.push({
      id: "wallet.active",
      label: "On-chain activity",
      category: "identity",
      intensity: 0,
      evidence: `${f.txCount} ${plural(f.txCount, "transaction")} on ${f.chain}`,
    });
  }

  if (f.balanceRaw !== "0") {
    out.push({
      id: "wallet.balance",
      label: "Holds a balance",
      category: "identity",
      intensity: 0,
      evidence: `balance ${f.balance}`,
    });
  }

  return out;
}

// ── Hash ─────────────────────────────────────────────────────────────────────
// A hash present in a known-software database is reassuring; a hash absent from
// one is neither good nor bad. We never infer "malware" from absence.

export function signalsFromHash(d: HashLookupResponse): Signal[] {
  const out: Signal[] = [];
  const f = d.facts;
  if (!f) return out;

  if (f.known) {
    if (f.trust !== null && f.trust < 50) {
      out.push({
        id: "hash.lowtrust",
        label: "Known file, low trust",
        category: "reputation",
        intensity: 0.3,
        evidence: `matched in ${f.source || "a known-software database"} but hashlookup trust is ${f.trust}`,
      });
    } else {
      out.push({
        id: "hash.knowngood",
        label: "Matches known-good software",
        category: "reputation",
        intensity: 0,
        evidence: `matched in ${f.source || "a known-software database"}${f.productName ? ` (${f.productName})` : ""}`,
      });
    }
  } else {
    out.push({
      id: "hash.unknown",
      label: "Not in known-software databases",
      category: "reputation",
      intensity: 0,
      evidence: "absent from known-good databases, which is neither a good nor a bad verdict",
    });
  }

  return out;
}
