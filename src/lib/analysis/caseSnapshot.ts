// ── Case snapshots + diffing ─────────────────────────────────────────────────
//
// "Re-run this case and show me what changed" — the thing that turns a one-shot
// lookup console into monitoring. A breach count that grew, a subdomain that
// appeared, a port that opened: those are the events an analyst cares about,
// and none of them were observable before.
//
// A snapshot is deliberately NOT the whole response. Storing full results would
// balloon the case file and keep PII on disk forever. Instead each summariser
// reduces a lookup to a handful of scalar `facts` — the values worth watching —
// which is all a diff needs and is cheap to keep.
//
// Everything here is pure: no clock, no network. The caller supplies `takenAt`.

import type {
  LookupResponse, EmailLookupResponse, UsernameLookupResponse,
  IpLookupResponse, DomainLookupResponse, CaseSnapshot, EntityKind,
} from "../types";

export type Facts = Record<string, number | string>;

/**
 * A single fact that moved between two snapshots. `from: null` means the fact
 * did not exist before (a source that was down, or a newly-reported field);
 * `to: null` means it stopped being reported.
 */
export interface FactChange {
  fact: string;
  from: number | string | null;
  to: number | string | null;
}

export interface SnapshotDiff {
  kind: EntityKind;
  value: string;
  /** When the snapshot we compared against was taken; null on the first one. */
  previousAt: number | null;
  currentAt: number;
  /** True when this is the first snapshot — nothing to compare, not "no change". */
  baseline: boolean;
  changes: FactChange[];
  /** True when either side came from the result cache — see CaseSnapshot. */
  cacheInvolved: boolean;
}

/** Drop facts a source could not answer, so "absent" never reads as "zero". */
function defined(facts: Record<string, number | string | null | undefined>): Facts {
  const out: Facts = {};
  for (const [k, v] of Object.entries(facts)) {
    if (v !== null && v !== undefined) out[k] = v;
  }
  return out;
}

// ── Per-mode summarisers ─────────────────────────────────────────────────────

export function factsFromPhone(d: LookupResponse): Facts {
  const hr = d.sources.hudsonRock.ok ? d.sources.hudsonRock.data : undefined;
  const lc = d.sources.leakCheck.ok ? d.sources.leakCheck.data : undefined;
  const bd = d.sources.breachDirectory.ok ? d.sources.breachDirectory.data : undefined;
  return defined({
    threatScore: d.threatScore,
    threatLabel: d.threatLabel,
    carrier: d.aggregated.carrier,
    lineType: d.aggregated.lineType,
    infostealerHits: hr?.total,
    leakCheckRecords: lc?.found,
    leakCheckBreaches: lc?.sources.length,
    breachCredentials: bd?.found,
  });
}

export function factsFromEmail(d: EmailLookupResponse): Facts {
  const xon = d.xon.ok ? d.xon.data : undefined;
  const hr = d.hudsonRock.ok ? d.hudsonRock.data : undefined;
  const lc = d.leakCheck.ok ? d.leakCheck.data : undefined;
  const rep = d.emailrep.ok ? d.emailrep.data : undefined;
  return defined({
    breaches: xon?.breachCount,
    infostealerHits: hr?.total,
    leakCheckRecords: lc?.found,
    leakCheckBreaches: lc?.sources.length,
    gravatar: d.gravatar.found ? "present" : "none",
    reputation: rep?.reputation,
    providerType: d.analysis.providerType,
  });
}

export function factsFromUsername(d: UsernameLookupResponse): Facts {
  const lc = d.leakCheck.ok ? d.leakCheck.data : undefined;
  return defined({
    sitesFound: d.found,
    sitesChecked: d.checked,
    verifiedProfiles: d.profiles.length,
    leakCheckRecords: lc?.found,
  });
}

export function factsFromIp(d: IpLookupResponse): Facts {
  return defined({
    threatScore: d.threatScore,
    asn: d.ip?.asn,
    asnOrg: d.ip?.asnOrg,
    country: d.ip?.countryCode,
    reverse: d.ip?.reverse,
    openPorts: d.ip?.ports?.length,
    knownVulns: d.ip?.vulns?.length,
    greyNoise: d.ip?.greyNoise?.classification,
  });
}

export function factsFromDomain(d: DomainLookupResponse): Facts {
  return defined({
    aRecords: d.dns.a.length,
    mxRecords: d.dns.mx.length,
    nsRecords: d.dns.ns.length,
    subdomains: d.subdomains.length,
    registrar: d.whois?.registrar,
    expires: d.whois?.expiresDate,
    spf: d.emailSecurity.hasSpf ? "present" : "missing",
    dmarcPolicy: d.emailSecurity.dmarcPolicy,
    dnssec: d.dnssec === null ? undefined : d.dnssec ? "signed" : "unsigned",
  });
}

// ── Diff ─────────────────────────────────────────────────────────────────────

/**
 * Compare two fact bags. Union of both key sets, so a fact that APPEARS and one
 * that DISAPPEARS are both reported — a source going dark is itself a finding.
 */
export function diffFacts(prev: Facts, next: Facts): FactChange[] {
  const keys = Array.from(new Set([...Object.keys(prev), ...Object.keys(next)])).sort();
  const out: FactChange[] = [];
  for (const fact of keys) {
    const from = prev[fact] ?? null;
    const to = next[fact] ?? null;
    if (from !== to) out.push({ fact, from, to });
  }
  return out;
}

/**
 * Diff a new snapshot against the most recent earlier one for the SAME
 * identifier. `history` may hold snapshots for many identifiers — only matching
 * kind+value (case-insensitive) are considered.
 */
export function diffSnapshot(history: CaseSnapshot[], next: CaseSnapshot): SnapshotDiff {
  const key = `${next.kind}:${next.value.toLowerCase()}`;
  const prior = history.filter((s) => `${s.kind}:${s.value.toLowerCase()}` === key);
  const prev = prior.length > 0 ? prior[prior.length - 1] : null;

  return {
    kind: next.kind,
    value: next.value,
    previousAt: prev ? prev.takenAt : null,
    currentAt: next.takenAt,
    baseline: prev === null,
    changes: prev ? diffFacts(prev.facts, next.facts) : [],
    cacheInvolved: Boolean(next.fromCache) || Boolean(prev?.fromCache),
  };
}

/**
 * Append a snapshot, keeping at most `keep` per identifier so a case that is
 * re-run daily cannot grow without bound. Oldest matching entries are dropped
 * first; other identifiers are untouched and relative order is preserved.
 */
export function appendSnapshot(history: CaseSnapshot[], next: CaseSnapshot, keep: number): CaseSnapshot[] {
  const key = `${next.kind}:${next.value.toLowerCase()}`;
  const mine = history.filter((s) => `${s.kind}:${s.value.toLowerCase()}` === key);

  // `keep` counts the incoming snapshot, so with keep=5 and 5 already stored we
  // drop exactly one — the oldest.
  const dropCount = Math.max(0, mine.length + 1 - keep);
  const dropped = new Set(mine.slice(0, dropCount));

  return [...history.filter((s) => !dropped.has(s)), next];
}
