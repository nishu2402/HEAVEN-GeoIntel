// ── Cross-identifier auto-pivot engine ───────────────────────────────────────
//
// The gap this closes: the console *recorded* that a phone and an email were
// both looked up, but nothing *derived* the link. An analyst who saw an email
// inside a Hudson Rock hit still had to select it, switch mode, and paste it —
// the exact manual pivoting the tool exists to remove.
//
// Given one finished lookup, these functions read the identifiers that result
// already contains and return runnable suggestions: "this domain's MX host is
// aspmx.l.google.com — run a domain lookup on it".
//
// Rules this module holds itself to:
//   1. PURE. No network, no clock, no randomness. Same input → same output, so
//      the UI can render it during the same paint as the result.
//   2. NEVER INVENT. Every suggestion is a value that appeared verbatim in the
//      response. Nothing is guessed, completed, or pattern-generated — an email
//      is not synthesised from a username, a phone is not built from a country
//      code. A wrong pivot is a false positive with extra steps.
//   3. VALIDATE BY KIND. A value is only offered if it passes the shape check
//      for the mode it would be handed to, so a malformed upstream field can
//      never produce a dead-end lookup.
//   4. DROP MASKED VALUES. Free-tier Hudson Rock returns "82.167.***.**" and
//      "i****@gmail.com". Those are evidence, not identifiers; the shape checks
//      reject them because `*` is not legal in any of the five kinds.
//   5. NEVER SUGGEST THE SUBJECT. Pivoting a lookup to itself is noise.

import type {
  LookupResponse, EmailLookupResponse, UsernameLookupResponse,
  IpLookupResponse, DomainLookupResponse, EntityKind, EntityRef,
} from "../types";
import { ipsFromRecords, ipToDomainPivot } from "./crossPivots";

/** A runnable next lookup derived from the result on screen. */
export interface PivotSuggestion {
  /** Which lookup mode runs this value. */
  kind: EntityKind;
  /** The identifier to run — always verbatim from the source result. */
  value: string;
  /** Which source/field produced it, shown so the analyst can judge it. */
  reason: string;
  /**
   * `confirmed` — the upstream asserts this identifier belongs to the subject
   * (a linked account, an enriched contact detail).
   * `related`   — a true association whose meaning needs judgement (the mail
   * host serving a domain, a breach's own domain, an infected machine's IP).
   */
  strength: "confirmed" | "related";
}

// ── Shape validation, per kind ───────────────────────────────────────────────
// Deliberately stricter than the API-side validators: this decides what to
// SHOW, and an offered pivot that cannot run is worse than one not offered.

const EMAIL_RE = /^[^\s@*]+@[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const USERNAME_RE = /^[a-zA-Z0-9._-]{2,40}$/;
const E164_RE = /^\+[1-9]\d{6,14}$/;

function isIp(v: string): boolean {
  return ipsFromRecords([{ value: v }]).length === 1;
}

function validFor(kind: EntityKind, value: string): boolean {
  switch (kind) {
    case "email": return EMAIL_RE.test(value) && value.length <= 254;
    case "domain": return DOMAIN_RE.test(value);
    case "username": return USERNAME_RE.test(value);
    case "ip": return isIp(value);
    /* v8 ignore next -- exhaustive: the remaining kind is "phone" */
    default: return E164_RE.test(value);
  }
}

/** Normalise a value for its kind before validating (case, trailing dot, @). */
function normalise(kind: EntityKind, raw: string): string {
  const v = raw.trim();
  if (kind === "domain") return v.replace(/\.$/, "").toLowerCase();
  if (kind === "email") return v.toLowerCase();
  if (kind === "username") return v.replace(/^@/, "");
  if (kind === "phone") return v.replace(/[\s()-]/g, "");
  return v;
}

/** The hostname part of a URL or a bare host string; null if neither. */
function hostOf(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`;
  try {
    // `hostname` deliberately excludes any userinfo and port — for a
    // "user:pass@host/path" URL the pivot target is the host, not the
    // credentials, and the WHATWG parser separates them for us.
    const host = new URL(withScheme).hostname.replace(/^www\./, "");
    // Schemes like file:// parse cleanly but carry no host.
    return host || null;
  } catch {
    return null;
  }
}

// ── Collector ────────────────────────────────────────────────────────────────

class Pivots {
  private readonly out: PivotSuggestion[] = [];
  private readonly seen = new Set<string>();

  constructor(subjectKind: EntityKind, subjectValue: string) {
    // Seed with the subject so rule 5 falls out of the de-dupe.
    this.seen.add(`${subjectKind}:${normalise(subjectKind, subjectValue).toLowerCase()}`);
  }

  add(kind: EntityKind, raw: string | null | undefined, reason: string, strength: PivotSuggestion["strength"]): void {
    if (!raw) return;
    const value = normalise(kind, raw);
    if (!validFor(kind, value)) return;
    const key = `${kind}:${value.toLowerCase()}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.out.push({ kind, value, reason, strength });
  }

  /** Add the host of a URL (or bare host) as a domain pivot. */
  addHost(raw: string | null | undefined, reason: string, strength: PivotSuggestion["strength"]): void {
    if (!raw) return;
    this.add("domain", hostOf(raw), reason, strength);
  }

  /** Confirmed suggestions first; insertion order is preserved within a group. */
  done(): PivotSuggestion[] {
    return [
      ...this.out.filter((p) => p.strength === "confirmed"),
      ...this.out.filter((p) => p.strength === "related"),
    ];
  }
}

/** Identifiers captured on an infected machine, shared by phone and email. */
function addHudsonRock(
  p: Pivots,
  stealers: { ip: string | null; topLogins: string[] }[],
): void {
  for (const s of stealers) {
    // Masked on the free tier — validFor() rejects those, so only a genuinely
    // unmasked address survives to become a pivot.
    p.add("ip", s.ip, "Hudson Rock: infected machine IP", "related");
    for (const login of s.topLogins) {
      p.add("email", login, "Hudson Rock: credential captured on the same machine", "related");
    }
  }
}

/** Breach names LeakCheck reports are often the site's own domain. */
function addLeakCheck(p: Pivots, sources: { name: string }[]): void {
  for (const s of sources) {
    const name = normalise("domain", s.name);
    // Only names that ARE a domain ("Trello.com"); plain labels like
    // "Stealer Logs" are not pivotable and are skipped rather than mangled.
    if (validFor("domain", name)) p.add("domain", name, "LeakCheck: breached site", "related");
  }
}

/**
 * Turn pivot suggestions into persistable graph edges rooted at the subject of
 * the lookup that produced them. The `reason` carries through unchanged, so the
 * stored graph records *why* two identifiers are linked — the thing the old
 * localStorage graph could never say.
 */
export function edgesFromPivots(
  subject: { kind: EntityKind; value: string },
  pivots: PivotSuggestion[],
): { from: EntityRef; to: EntityRef; reason: string }[] {
  return pivots.map((p) => ({
    from: { kind: subject.kind, value: subject.value },
    to: { kind: p.kind, value: p.value },
    reason: p.reason,
  }));
}

// ── Per-mode extractors ──────────────────────────────────────────────────────

export function pivotsFromPhone(d: LookupResponse): PivotSuggestion[] {
  const p = new Pivots("phone", d.input.e164);

  const fc = d.sources.fullContact.ok ? d.sources.fullContact.data : undefined;
  if (fc) {
    for (const e of fc.otherEmails ?? []) p.add("email", e, "FullContact: linked email", "confirmed");
    for (const prof of fc.profiles ?? []) {
      p.add("username", prof.username, `FullContact: ${prof.platform} profile`, "confirmed");
    }
  }

  // IPQS returns addresses it has seen paired with the number.
  const ipqs = d.sources.ipqs.ok ? d.sources.ipqs.data : undefined;
  for (const e of ipqs?.associated_email_addresses?.emails ?? []) {
    p.add("email", e, "IPQualityScore: associated email", "confirmed");
  }

  const hr = d.sources.hudsonRock.ok ? d.sources.hudsonRock.data : undefined;
  if (hr) addHudsonRock(p, hr.stealers);

  const lc = d.sources.leakCheck.ok ? d.sources.leakCheck.data : undefined;
  if (lc) addLeakCheck(p, lc.sources);

  return p.done();
}

export function pivotsFromEmail(d: EmailLookupResponse): PivotSuggestion[] {
  const p = new Pivots("email", d.email);

  // The local part is the analyst's most common next move, and it is a value
  // that exists in the address itself — not a guess.
  p.add("username", d.analysis.username, "Email local part", "related");
  p.add("domain", d.analysis.domain, "Email domain", "related");

  if (d.gravatar.found) {
    p.add("username", d.gravatar.preferredUsername, "Gravatar: profile handle", "confirmed");
    for (const a of d.gravatar.accounts) {
      p.add("username", a.username, `Gravatar: linked ${a.shortname || "account"}`, "confirmed");
      p.addHost(a.url, `Gravatar: linked ${a.shortname || "account"}`, "related");
    }
  }

  const fc = d.fullContact.ok ? d.fullContact.data : undefined;
  if (fc) {
    for (const e of fc.otherEmails ?? []) p.add("email", e, "FullContact: linked email", "confirmed");
    for (const ph of fc.phones ?? []) p.add("phone", ph, "FullContact: linked phone", "confirmed");
    for (const prof of fc.profiles ?? []) {
      p.add("username", prof.username, `FullContact: ${prof.platform} profile`, "confirmed");
    }
  }

  const hr = d.hudsonRock.ok ? d.hudsonRock.data : undefined;
  if (hr) addHudsonRock(p, hr.stealers);

  const xon = d.xon.ok ? d.xon.data : undefined;
  for (const b of xon?.breaches ?? []) {
    p.add("domain", b.domain, `XposedOrNot: breached site (${b.breach})`, "related");
  }

  const lc = d.leakCheck.ok ? d.leakCheck.data : undefined;
  if (lc) addLeakCheck(p, lc.sources);

  // EmailRep names the mail host that accepts this address.
  const rep = d.emailrep.ok ? d.emailrep.data : undefined;
  p.addHost(rep?.primaryMx, "EmailRep: primary MX host", "related");

  return p.done();
}

export function pivotsFromUsername(d: UsernameLookupResponse): PivotSuggestion[] {
  const p = new Pivots("username", d.username);

  // A confirmed profile whose login differs from the query (case, or a rename)
  // is a distinct handle worth sweeping on its own.
  for (const prof of d.profiles) {
    p.add("username", prof.handle, `${prof.platform}: confirmed account handle`, "confirmed");
  }

  const lc = d.leakCheck.ok ? d.leakCheck.data : undefined;
  if (lc) addLeakCheck(p, lc.sources);

  return p.done();
}

export function pivotsFromIp(d: IpLookupResponse): PivotSuggestion[] {
  const p = new Pivots("ip", d.input);
  if (!d.ip) return p.done();

  p.add("domain", ipToDomainPivot(d.ip.reverse), "Reverse DNS (PTR)", "confirmed");
  for (const h of d.ip.hostnames ?? []) {
    p.add("domain", h, "Shodan InternetDB: hostname on this IP", "confirmed");
  }
  return p.done();
}

export function pivotsFromDomain(d: DomainLookupResponse, subdomainCap = 8): PivotSuggestion[] {
  const p = new Pivots("domain", d.domain);

  for (const ip of ipsFromRecords([...d.dns.a, ...d.dns.aaaa])) {
    p.add("ip", ip, "DNS: A/AAAA record", "confirmed");
  }
  for (const mx of d.dns.mx) {
    p.addHost(mx.value, "DNS: MX host (mail provider)", "related");
  }
  for (const ns of d.dns.ns) {
    p.addHost(ns.value, "DNS: nameserver", "related");
  }
  for (const c of d.dns.cname) {
    p.addHost(c.value, "DNS: CNAME target", "confirmed");
  }
  // Subdomains are the longest list on the page; cap so the panel stays
  // actionable rather than becoming a second copy of the subdomain table.
  for (const sub of d.subdomains.slice(0, subdomainCap)) {
    p.add("domain", sub, "Certificate transparency: subdomain", "confirmed");
  }
  return p.done();
}
