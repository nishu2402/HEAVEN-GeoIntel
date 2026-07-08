// ── Result → case entities ───────────────────────────────────────────────────
// One-click "turn this lookup into a linked case". Each extractor pulls the
// primary identifier PLUS the high-signal identifiers a result already derived —
// a domain's resolved IPs, an IP's reverse host, an email's domain, a username's
// confirmed profile handles — so pinning a single result seeds the case graph
// with real edges. Pure + deterministic; the primary is always element 0, the
// rest are "related". Deduped (kind + lowercased value); noisy/low-signal data
// (e.g. a domain's long subdomain list) is deliberately left out.

import type {
  EntityKind, LookupResponse, EmailLookupResponse, UsernameLookupResponse,
  IpLookupResponse, DomainLookupResponse,
} from "../types";
import { ipToDomainPivot, ipsFromRecords } from "./crossPivots";

export interface ExtractedEntity {
  kind: EntityKind;
  value: string;
}

function dedupe(list: ExtractedEntity[]): ExtractedEntity[] {
  const seen = new Set<string>();
  const out: ExtractedEntity[] = [];
  for (const e of list) {
    const value = e.value.trim();
    if (!value) continue;
    const key = `${e.kind}:${value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: e.kind, value });
  }
  return out;
}

export function entitiesFromPhone(d: LookupResponse): ExtractedEntity[] {
  const list: ExtractedEntity[] = [{ kind: "phone", value: d.input.e164 }];
  // FullContact enrichment can tie the number to real emails / social handles.
  const fc = d.sources.fullContact.ok ? d.sources.fullContact.data : undefined;
  if (fc) {
    for (const email of fc.otherEmails ?? []) list.push({ kind: "email", value: email });
    for (const p of fc.profiles ?? []) if (p.username) list.push({ kind: "username", value: p.username });
  }
  return dedupe(list);
}

export function entitiesFromEmail(d: EmailLookupResponse): ExtractedEntity[] {
  return dedupe([
    { kind: "email", value: d.email },
    { kind: "domain", value: d.analysis.domain },
  ]);
}

export function entitiesFromUsername(d: UsernameLookupResponse): ExtractedEntity[] {
  return dedupe([
    { kind: "username", value: d.username },
    // Confirmed API profiles — the handle can differ in case/spelling from the query.
    ...d.profiles.map((p) => ({ kind: "username" as const, value: p.handle })),
  ]);
}

export function entitiesFromIp(d: IpLookupResponse): ExtractedEntity[] {
  const list: ExtractedEntity[] = [{ kind: "ip", value: d.input }];
  const host = d.ip ? ipToDomainPivot(d.ip.reverse) : null;
  if (host) list.push({ kind: "domain", value: host });
  return dedupe(list);
}

export function entitiesFromDomain(d: DomainLookupResponse, ipCap = 6): ExtractedEntity[] {
  const ips = ipsFromRecords([...d.dns.a, ...d.dns.aaaa]).slice(0, ipCap);
  return dedupe([
    { kind: "domain", value: d.domain },
    ...ips.map((v) => ({ kind: "ip" as const, value: v })),
  ]);
}
