// ── Unified investigation report model + renderers (pure, no network) ────────
//
// One report model for every mode, rendered identically. Each mode's builder
// fills a normalised ReportModel from its lookup response; the renderers turn
// that single shape into a plain-text brief, a Markdown document, a STIX 2.1
// bundle for machine handoff, and two separate documents that deliberately do
// NOT share a stylesheet: an on-screen dossier (./reportHtml) and a paged A4
// document for print and PDF (./reportPrint). Because every mode flows through
// the same model and the same outline, a phone report and a domain report share
// their structure, masthead, risk block and export formats.
//
// It is pure derivation over data the response already holds — no new lookups,
// nothing invented. A field the lookup did not learn is simply omitted, so a
// report never pads itself with "N/A" walls. The risk block is the same
// explainable AI assessment shown live in the panel (src/lib/ai), so a handoff
// carries the reasoning, not just the raw fields.

import type {
  LookupResponse, EmailLookupResponse, UsernameLookupResponse, IpLookupResponse,
  DomainLookupResponse, WalletLookupResponse, HashLookupResponse, SourceProvenance,
  SecurityHeaderCheck,
} from "../types";
import type { AggregatedBreach, BreachAggregate } from "./breachAggregate";
import type { CredentialExposure } from "./credentialExposure";
import { analyzeLookup, type AnalyzeInput } from "../ai";
import { formatDms, decimalPair, mapLinks, reverseImageLinks } from "./exif";
import type { UniversalMeta } from "./meta/types";
import type { FileHashes } from "./meta/types";
import { BRAND, asciiLetterhead } from "../brand/logo";
import { APP_VERSION } from "../version";

export interface ReportRow { label: string; value: string }
export interface ReportSection { heading: string; rows?: ReportRow[]; list?: string[] }

/**
 * One queried source and what became of it. `skipped` is its own state on
 * purpose: an optional source with no API key was never called, and printing it
 * beside a genuine outage would report a failure that never happened.
 */
export interface ReportSource {
  source: string;
  ok: boolean;
  ms?: number;
  skipped?: boolean;
  error?: string;
}

/** A STIX Cyber-observable to emit: a type plus its primary value. */
export interface StixObservable {
  type: "domain-name" | "ipv4-addr" | "ipv6-addr" | "user-account" | "email-addr" | "url" | "file";
  value: string;
  /** For a `file` observable: the hash algorithm in STIX form (MD5 / SHA-1 / SHA-256). */
  hashAlg?: string;
}

/**
 * The grounded AI risk assessment carried by every mode's report — the same
 * explainable read-out shown live in the panel. Every field derives from the
 * evidence in the sections above; nothing is invented.
 */
export interface ReportAssessment {
  score: number;
  band: string;
  confidence: string;
  rationale: string;
  factors: { label: string; share: number; evidence: string }[];
  anomalies: { title: string; severity: string; detail: string }[];
  /** Grounded, model-free narration of the assessment. */
  narrative: string[];
}

export type ReportKind =
  | "phone" | "email" | "username" | "ip" | "domain" | "wallet" | "hash" | "file";

export interface ReportModel {
  kind: ReportKind;
  subject: string;
  generatedAt: string;
  /** The one-line verdict for the executive summary (score, grade, verdict). */
  headline?: ReportRow;
  /** A handful of curated key facts for the executive-summary band. */
  summary?: ReportRow[];
  sections: ReportSection[];
  sources: ReportSource[];
  pivots: { label: string; url: string }[];
  observables: StixObservable[];
  /** The uniform AI risk assessment. Present for every lookup mode. */
  assessment?: ReportAssessment;
}

const nowIso = () => new Date().toISOString();

/** The grounded, explainable AI assessment for a finished lookup (see src/lib/ai). */
function assess(input: AnalyzeInput): ReportAssessment {
  const a = analyzeLookup(input);
  return {
    score: a.risk.score,
    band: a.risk.band,
    confidence: a.risk.confidence,
    rationale: a.risk.rationale,
    factors: a.risk.factors.map((f) => ({ label: f.label, share: f.share, evidence: f.evidence })),
    anomalies: a.anomalies.map((an) => ({ title: an.title, severity: an.severity, detail: an.detail })),
    narrative: a.summary,
  };
}

function provRows(health: SourceProvenance[] | undefined): ReportSource[] {
  return (health ?? []).map((h) => ({
    source: h.source, ok: h.ok, ms: h.ms,
    // Both are carried only when set, so a report never states that a source
    // was skipped, or names an error, on no evidence.
    ...(h.skipped ? { skipped: true } : {}),
    ...(h.error ? { error: h.error } : {}),
  }));
}

/** The four distinct outcomes of querying a source, in the analyst's words. */
export function sourceState(
  s: ReportSource,
): "answered" | "failed" | "not configured" | "not applicable" {
  // A keyless source with nothing to ask about is not "not configured": saying
  // so would tell the reader an API key was the missing piece. See
  // SourceProvenance.skipped for the two reasons a source is never called.
  if (s.skipped) return s.error === "NO_INPUT" ? "not applicable" : "not configured";
  return s.ok ? "answered" : "failed";
}

/** Drop empty pairs, so a section never pads itself with blank rows. */
function compact(pairs: [string, string | null | undefined][]): ReportRow[] {
  return pairs.filter(([, v]) => v != null && v !== "").map(([label, value]) => ({ label, value: value as string }));
}

function boolFlag(v: boolean | null | undefined): string | null {
  return v === true ? "Yes" : v === false ? "No" : null;
}

/** A number as a row value, or null so `compact` drops the row entirely. */
function num(v: number | null | undefined): string | null {
  return v == null ? null : String(v);
}

/**
 * A list as one row value, capped so a 400-entry field cannot swallow a page.
 * The remainder is counted rather than silently dropped: a truncated list that
 * does not say it was truncated reads as a complete one.
 */
function joinList(v: readonly string[] | null | undefined, max = 12): string | null {
  if (!v || v.length === 0) return null;
  if (v.length <= max) return v.join(", ");
  return `${v.slice(0, max).join(", ")}, and ${v.length - max} more`;
}

/** Push a rows-section only when it has at least one row (no empty headings). */
function pushRows(sections: ReportSection[], heading: string, rows: ReportRow[]): void {
  if (rows.length) sections.push({ heading, rows });
}

/** Push a list-section only when it has at least one entry. */
function pushList(sections: ReportSection[], heading: string, list: string[]): void {
  if (list.length) sections.push({ heading, list });
}

/** STIX hash-algorithm names, keyed by our internal algorithm id. */
const STIX_ALG: Record<string, string> = { md5: "MD5", sha1: "SHA-1", sha256: "SHA-256" };

// ── Cross-mode sections ──────────────────────────────────────────────────────
// Breach and credential evidence has the same shape whichever identifier was
// looked up, so phone, email and username share one renderer for it rather than
// three that drift apart.

/** One breach as a single line: what it was, when, and what it exposed. */
function breachLine(b: AggregatedBreach): string {
  const marks = [b.password ? "password exposed" : null, b.verified ? "verified" : null].filter(Boolean);
  const parts = [
    b.date ? `${b.name} (${b.date})` : b.name,
    b.records != null ? `${b.records.toLocaleString("en-US")} records` : null,
    joinList(b.dataClasses, 8),
    marks.length ? marks.join(", ") : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

/**
 * Breach exposure and, when the sources went that far, the credential evidence
 * behind it. `sourcesAnswered` is reported next to `sourcesReporting` because a
 * source that answered with nothing is evidence of absence; a source that never
 * answered is not, and a report that conflates them overstates a clean result.
 */
function breachSections(
  sections: ReportSection[],
  agg: BreachAggregate | undefined,
  cred: CredentialExposure | undefined,
): void {
  if (agg) {
    pushRows(sections, "Breach exposure", compact([
      ["Breaches", String(agg.total)],
      ["Verified by a source", agg.verified > 0 ? String(agg.verified) : null],
      ["With passwords", agg.withPassword > 0 ? String(agg.withPassword) : null],
      ["First breach", agg.firstBreach],
      ["Most recent breach", agg.lastBreach],
      ["Reporting sources", joinList(agg.sourcesReporting)],
      ["Sources that answered", joinList(agg.sourcesAnswered)],
      ["Catalog-enriched", agg.enrichedCount > 0 ? String(agg.enrichedCount) : null],
      ["Data classes", joinList(agg.dataClasses)],
    ]));
    pushList(sections, "Breaches by name", agg.breaches.slice(0, 40).map(breachLine));
  }
  if (cred?.exposed) {
    pushRows(sections, "Credential exposure", compact([
      ["Reuse assessment", cred.reuse],
      ["Distinct leaked passwords", cred.distinctPasswords > 0 ? `${cred.distinctPasswords} (floor)` : null],
      ["Leaked credential pairs", cred.pairs > 0 ? `${cred.pairs} (floor)` : null],
      ["Breaches exposing a password", cred.passwordBreaches > 0 ? String(cred.passwordBreaches) : null],
      ["Infostealer logs", cred.stealerLogs > 0 ? String(cred.stealerLogs) : null],
      ["Passwords in those logs", cred.stealerPasswords > 0 ? `${cred.stealerPasswords} (floor)` : null],
      ["Source page truncated", cred.capped ? "Yes: more pairs may exist beyond the page that was read" : null],
    ]));
  }
}

// ── Builders ─────────────────────────────────────────────────────────────────

export function buildPhoneReport(data: LookupResponse): ReportModel {
  const { input, aggregated: ag } = data;
  const sections: ReportSection[] = [];

  // Assignability leads, because it governs how every row under it reads: a
  // number no subscriber can hold has no carrier to attribute and no breach to
  // inherit, and a report that buried that would invite exactly that mistake.
  const assign = data.assignability;
  if (assign) {
    pushRows(sections, "Assignability", compact([
      ["Can hold a subscriber", boolFlag(assign.assignable)],
      ["Verdict", assign.detail],
      ["Reason", assign.reason],
      ["Reserved block", assign.block],
    ]));
  }

  pushRows(sections, "Number", compact([
    ["E.164", input.e164],
    ["International", ag.formatInternational],
    ["National", ag.formatNational],
    ["RFC 3966", ag.formatRfc3966],
    ["Valid", boolFlag(input.isValid)],
    ["Digits", num(ag.numberLength)],
    ["Line type", ag.lineType],
    ["Type detail", ag.typeDescription],
    ["Type is ambiguous", ag.isAmbiguousType ? "Yes: the number structure cannot separate mobile from fixed line" : null],
    ["Confirmed mobile", boolFlag(ag.isMobile)],
    ["Confirmed fixed line", boolFlag(ag.isFixedLine)],
    ["Toll free", boolFlag(ag.isTollFree)],
    ["Premium rate", boolFlag(ag.isPremiumRate)],
  ]));
  pushRows(sections, "Carrier and SIM", compact([
    ["Carrier", ag.carrier],
    ["Carrier prefix", ag.carrierPrefix],
    ["Prepaid", boolFlag(ag.prepaid)],
    ["Line active", boolFlag(ag.active)],
    ["Active status", ag.activeStatus],
    ["Recent user activity", ag.userActivity],
    ["Mobile country code", ag.mobileCountryCode],
    ["Mobile network code", ag.mobileNetworkCode],
    ["Caller name", ag.callerName],
    ["Caller type", ag.callerType],
  ]));
  pushRows(sections, "Geolocation", compact([
    ["Country", ag.countryName ? `${ag.countryName} (${ag.country})` : null],
    ["Calling code", input.countryCallingCode],
    ["Region", ag.region],
    ["City", ag.city],
    ["Area code", ag.areaCode],
    ["Timezones", joinList(ag.timezone)],
    ["UTC offsets", joinList(ag.utcOffsets)],
  ]));
  pushRows(sections, "Risk signals", compact([
    ["Fraud score", ag.fraudScore != null ? `${ag.fraudScore}/100` : null],
    ["High risk", boolFlag(ag.isRisky)],
    ["Recent abuse", boolFlag(ag.recentAbuse)],
    ["VoIP", boolFlag(ag.isVoip)],
    ["Disposable", boolFlag(ag.isDisposable)],
  ]));
  pushList(sections, "Associated email addresses", ag.associatedEmails ?? []);
  breachSections(sections, data.breachAggregate, data.credentialExposure);

  // The verdict is the headline above; the summary carries the supporting facts.
  const summary = compact([
    ["Number", input.e164],
    ["Country", ag.countryName ?? null],
    ["Line type", ag.lineType],
    ["Carrier", ag.carrier],
    ["Prepaid", boolFlag(ag.prepaid)],
    ["Can hold a subscriber", assign ? boolFlag(assign.assignable) : null],
    ["Abuse risk", `${data.threatScore}/100 ${data.threatLabel}`],
    ["Exposure", data.exposureScore === undefined ? null : `${data.exposureScore}/100 ${data.exposureLabel ?? ""}`.trim()],
    ["Breaches", data.breachAggregate ? String(data.breachAggregate.total) : null],
  ]);

  // Exposure and abuse are separate rows because they answer separate
  // questions: what is already public about this number, and whether the number
  // itself behaves badly. See analysis/riskModel.ts.
  pushList(sections, "Abuse signals", data.threatReasons ?? []);
  pushList(sections, "Exposure signals", data.exposureReasons ?? []);

  return {
    kind: "phone", subject: input.e164, generatedAt: nowIso(),
    headline: { label: "Abuse risk", value: `${data.threatScore}/100: ${data.threatLabel}` },
    summary, sections, sources: provRows(data.sourceHealth), pivots: [], observables: [],
    assessment: assess({ kind: "phone", data }),
  };
}

export function buildEmailReport(data: EmailLookupResponse): ReportModel {
  const { analysis: an, gravatar: gr } = data;
  const a = assess({ kind: "email", data });
  const sections: ReportSection[] = [];

  pushRows(sections, "Classification", compact([
    ["Provider", an.providerName],
    ["Type", an.providerType],
    ["Disposable", boolFlag(an.isDisposable)],
    ["Role account", boolFlag(an.isRoleAddress)],
    ["Webmail", boolFlag(an.isWebmail)],
    ["Privacy-focused", boolFlag(an.isPrivacyFocused)],
  ]));

  const mail = data.mail?.ok ? data.mail.data : null;
  if (mail) {
    pushRows(sections, "Mail exchange", compact([
      ["Publishes MX", mail.nullMx ? "null MX: the domain accepts no mail" : boolFlag(mail.hasMx)],
      ["Provider", mail.provider],
      ["Category", mail.category],
      ["Mail exchangers", joinList(mail.mxHosts, 6)],
    ]));
  }

  const r = data.emailrep.ok ? data.emailrep.data : null;
  if (r) {
    pushRows(sections, "Reputation", compact([
      ["Reputation", r.reputation],
      ["Suspicious", boolFlag(r.suspicious)],
      ["Blacklisted", boolFlag(r.blacklisted)],
      ["Malicious activity", boolFlag(r.maliciousActivity)],
      ["Credentials leaked", boolFlag(r.credentialsLeaked)],
      ["Deliverable", boolFlag(r.deliverable)],
      ["Spoofable", boolFlag(r.spoofable)],
    ]));
  }

  const agg = data.breachAggregate;
  breachSections(sections, agg, data.credentialExposure);

  if (gr.found) {
    pushRows(sections, "Gravatar profile", compact([
      ["Display name", gr.displayName],
      ["Location", gr.currentLocation],
      ["Profile", gr.profileUrl],
      ["Linked accounts", gr.accounts.length ? String(gr.accounts.length) : null],
    ]));
    pushList(sections, "Gravatar linked accounts", gr.accounts.map((a) => `${a.shortname}: ${a.url}`));
  }

  // The risk verdict is the headline above; the summary carries the facts.
  const summary = compact([
    ["Address", data.email],
    ["Provider", an.providerName],
    ["Type", an.providerType],
    ["Mail exchange", mail?.provider ?? null],
    ["Abuse risk", data.threatScore === undefined ? null : `${data.threatScore}/100 ${data.threatLabel ?? ""}`.trim()],
    ["Exposure", data.exposureScore === undefined ? null : `${data.exposureScore}/100 ${data.exposureLabel ?? ""}`.trim()],
    ["Breaches", agg ? String(agg.total) : null],
    ["Credential exposure", data.credentialExposure?.exposed ? data.credentialExposure.reuse : null],
  ]);

  pushList(sections, "Abuse signals", data.threatReasons ?? []);
  pushList(sections, "Exposure signals", data.exposureReasons ?? []);

  return {
    kind: "email", subject: data.email, generatedAt: nowIso(),
    headline: { label: "Risk", value: `${a.score}/100: ${a.band}` },
    summary, sections, sources: provRows(data.sourceHealth), pivots: [],
    observables: [{ type: "email-addr", value: data.email }],
    assessment: a,
  };
}

export function buildUsernameReport(data: UsernameLookupResponse): ReportModel {
  const found = data.hits.filter((h) => h.status === "found");
  const sections: ReportSection[] = [
    {
      heading: "Summary",
      rows: [
        { label: "Username", value: data.username },
        { label: "Sites checked", value: String(data.checked) },
        { label: "Confirmed accounts", value: String(data.found) },
        ...(data.manual ? [{ label: "Open-to-verify sites", value: String(data.manual) }] : []),
        { label: "Rich profiles", value: String(data.profiles.length) },
      ],
    },
  ];

  pushList(sections, "Confirmed accounts", found.map((h) => `${h.site} (${h.category}): ${h.url}`));
  // Sites a server-side probe cannot decide. They are listed apart from the
  // confirmed ones and labelled as leads, because a "manual" site answers 200
  // for every handle, and folding them in would manufacture accounts.
  pushList(
    sections,
    "Open to verify (not confirmed)",
    data.hits.filter((h) => h.status === "manual").map((h) => `${h.site} (${h.category}): ${h.url}`),
  );
  pushList(sections, "Verified profiles", data.profiles.map((p) => {
    const bits = [p.platform, p.displayName, p.location, p.joinedYear ? `joined ${p.joinedYear}` : null]
      .filter(Boolean).join(" · ");
    return `${bits}: ${p.url}`;
  }));
  pushList(sections, "Profile metrics", data.profiles.flatMap((p) =>
    p.stats.map((s) => `${p.platform}: ${s.label} ${s.value}`)));

  // What the identity claim RESTS on. Without this the report asserted a fused
  // identity and gave the reader no way to weigh it: a lookup of a popular
  // handle merges accounts belonging to different people.
  const resolved = data.resolvedIdentity;
  if (resolved) {
    pushRows(sections, "Resolved identity", compact([
      ["Name", resolved.name?.value ?? null],
      ["Location", resolved.location?.value ?? null],
      ["Confidence", `${resolved.confidence}/100 (${resolved.label})`],
      ["Accounts linked", resolved.cluster.platforms.join(", ")],
    ]));
    pushList(sections, "Proof of linkage", resolved.cluster.proofs.map((p) => `${p.kind}: ${p.detail}`));
    pushList(sections, "Contradictions between linked accounts", resolved.conflicts.map((c) =>
      `${c.field}: ${c.values.map((v) => `${v.value} (${v.source})`).join(" vs ")}`));
    // Values from accounts nothing ties to the subject. Listed apart, and
    // labelled, because they are leads rather than facts about this person.
    pushList(sections, "Unlinked candidates (same handle, no proof)", resolved.unlinked.map((u) =>
      `${u.field}: ${u.value} (${u.source})`));
  }
  pushList(sections, "Avatar matches", (data.avatarClusters ?? []).map((c) =>
    `${c.similarity}% perceptual match: ${c.sources.join(" + ")}`));
  pushList(sections, "Avatars not compared", (data.avatarSkipped ?? []).map((a) => `${a.source}: ${a.reason}`));

  const id = data.identity;
  pushList(sections, "Identity signals: names", id.names.map((n) => `${n.value} (${n.source})`));
  pushList(sections, "Identity signals: locations", id.locations.map((l) => `${l.value} (${l.source})`));
  pushList(sections, "Identity signals: biographies", id.bios.map((b) => `${b.source}: ${b.value}`));
  pushList(sections, "Identity signals: avatars", id.avatars.map((a) => `${a.source}: ${a.url}`));
  breachSections(sections, data.breachAggregate, data.credentialExposure);

  // The confirmed-account count is the headline above; the summary adds facts.
  const summary = compact([
    ["Username", data.username],
    ["Sites checked", String(data.checked)],
    ["Rich profiles", String(data.profiles.length)],
    ["Names found", id.names.length ? String(id.names.length) : null],
    ["Locations found", id.locations.length ? String(id.locations.length) : null],
    ["Breaches", data.breachAggregate ? String(data.breachAggregate.total) : null],
  ]);

  return {
    kind: "username", subject: data.username, generatedAt: nowIso(),
    headline: { label: "Confirmed accounts", value: `${data.found} of ${data.checked}` },
    summary, sections, sources: provRows(data.sourceHealth), pivots: data.pivots,
    observables: [{ type: "user-account", value: data.username }],
    assessment: assess({ kind: "username", data }),
  };
}

export function buildIpReport(data: IpLookupResponse): ReportModel {
  const ip = data.ip;
  const sections: ReportSection[] = [];
  const cls = data.classification;
  if (cls) {
    pushRows(sections, "Address scope", compact([
      ["Scope", cls.label],
      ["Globally routable", boolFlag(cls.isGloballyRoutable)],
      ["Defining RFC", cls.rfc],
      ["Detail", cls.description],
    ]));
  }
  if (ip) {
    sections.push({
      heading: "Geolocation",
      rows: compact([
        ["City", ip.city], ["Region", ip.region], ["Postal code", ip.postal],
        ["Country", ip.country], ["Country code", ip.countryCode], ["Continent", ip.continent],
        ["Coordinates", ip.latitude != null && ip.longitude != null ? `${ip.latitude}, ${ip.longitude}` : null],
        ["Timezone", ip.timezone], ["UTC offset", ip.utcOffset],
      ]),
    });
    sections.push({
      heading: "Network / ASN",
      rows: compact([
        ["Address type", ip.type],
        ["ASN", ip.asn != null ? `AS${ip.asn}` : null], ["AS org", ip.asnOrg], ["ISP", ip.isp],
        ["Organisation", ip.org],
        ["Reverse DNS", ip.reverse], ["Prefix", ip.prefix ?? null],
        ["ASN prefixes", num(ip.announcedPrefixes)],
        ["Abuse contact", ip.abuseContact ?? null],
      ]),
    });
    const flags = compact([
      ["Proxy", boolFlag(ip.isProxy)], ["VPN", boolFlag(ip.isVpn)],
      ["Hosting", boolFlag(ip.isHosting)],
      ["Tor", boolFlag(ip.isTor)], ["Mobile", boolFlag(ip.isMobile)],
    ]);
    if (flags.length) sections.push({ heading: "Risk flags", rows: flags });
    const gn = ip.greyNoise;
    if (gn) {
      pushRows(sections, "Internet-scanner classification", compact([
        ["Classification", gn.classification],
        ["Mass-scanning traffic", boolFlag(gn.noise)],
        ["Common business service", boolFlag(gn.riot)],
        ["Operator", gn.name],
        ["Last seen", gn.lastSeen],
      ]));
    }
    pushList(sections, "Open ports", (ip.ports ?? []).map(String));
    pushList(sections, "Known CVEs", ip.vulns ?? []);
    pushList(sections, "Hostnames", ip.hostnames ?? []);
    pushList(sections, "Exposure tags", ip.tags ?? []);
  }

  // The threat verdict is the headline above; the summary carries the facts.
  const summary = compact([
    ["IP", data.input],
    ["Location", ip?.city && ip?.country ? `${ip.city}, ${ip.country}` : (ip?.country ?? null)],
    ["Network", ip?.asn != null ? `AS${ip.asn}${ip.asnOrg ? ` (${ip.asnOrg})` : ""}` : null],
    ["Reverse DNS", ip?.reverse ?? null],
  ]);

  const observables: StixObservable[] = [{ type: data.ip?.type === "IPv6" ? "ipv6-addr" : "ipv4-addr", value: data.input }];
  return {
    kind: "ip", subject: data.input, generatedAt: nowIso(),
    headline: { label: "Threat", value: `${data.threatScore}/100: ${data.threatLabel}` },
    summary, sections, sources: provRows(data.sourceHealth ?? data.sources), pivots: data.pivots.map((p) => ({ label: p.label, url: p.url })),
    observables,
    assessment: assess({ kind: "ip", data }),
  };
}

// A posture whose DNS query got no answer is unknown. Printing "missing" for it
// put a false finding into an exported report.
const DNS_UNKNOWN = "unknown (no DNS answer)";
const postureWord = (v: boolean | null, yes: string, no: string) => (v === null ? DNS_UNKNOWN : v ? yes : no);

/** One security-header check: whether it is set, its value, and why it scored. */
function headerCheckLine(c: SecurityHeaderCheck): string {
  const state = c.present ? "present" : "absent";
  const value = c.present && c.value ? `: ${c.value}` : "";
  return `${c.name} (${state}, ${c.score} of ${c.max})${value} · ${c.note}`;
}

export function buildDomainReport(data: DomainLookupResponse): ReportModel {
  const sections: ReportSection[] = [];
  const { dns, whois, emailSecurity: es } = data;

  sections.push({
    heading: "DNS",
    // compact() drops empty joins, so no `|| null` is needed on each row.
    rows: compact([
      ["A", dns.a.map((r) => r.value).join(", ")],
      ["AAAA", dns.aaaa.map((r) => r.value).join(", ")],
      ["MX", dns.mx.map((r) => r.value).join(", ")],
      ["NS", dns.ns.map((r) => r.value).join(", ")],
      ["CNAME", dns.cname.map((r) => r.value).join(", ")],
      ["DNSSEC", postureWord(data.dnssec, "signed", "unsigned")],
      ["No answer for", (data.dnsFailed ?? []).join(", ")],
    ]),
  });
  pushList(sections, "TXT records", dns.txt.map((r) => r.value));
  sections.push({
    heading: "Email security",
    rows: [
      { label: "SPF", value: postureWord(es.hasSpf, "present", "missing") },
      ...(es.spf ? [{ label: "SPF record", value: es.spf }] : []),
      { label: "DMARC", value: postureWord(es.hasDmarc, es.dmarcPolicy ?? "set", "missing") },
      { label: "MX", value: es.nullMx ? "declared none (RFC 7505 null MX)" : postureWord(es.hasMx, "yes", "no") },
    ],
  });
  if (whois) {
    sections.push({
      heading: "WHOIS",
      rows: compact([
        ["Registrar", whois.registrar], ["Created", whois.createdDate],
        ["Updated", whois.updatedDate], ["Expires", whois.expiresDate],
        ["Registrant", whois.registrantOrg], ["Registrant country", whois.registrantCountry],
        ["Nameservers", joinList(whois.nameservers, 8)],
        ["Status codes", joinList(whois.statuses, 8)],
      ]),
    });
  }

  const http = data.http;
  if (http) {
    pushRows(sections, "HTTP posture", compact([
      ["Final URL", http.url],
      ["Status", String(http.status)],
      ["Page title", http.title],
      ["Upgrades HTTP to HTTPS", postureWord(http.httpsRedirect, "yes", "no")],
      ["Redirect hops", http.redirectChain.length ? String(http.redirectChain.length) : null],
      ["Security-header grade", `${http.security.grade} (${http.security.score} of ${http.security.max}, ${http.security.percent}%)`],
    ]));
    pushList(sections, "Redirect chain", http.redirectChain);
    // Present and missing headers both matter, and a grade alone says which
    // only in aggregate, so each check is listed with the note that scored it.
    pushList(sections, "Security-header checks", http.security.checks.map(headerCheckLine));
    pushList(sections, "Technology fingerprints", http.tech.map((t) =>
      `${t.name}${t.version ? ` ${t.version}` : ""} (${t.kind}) from ${t.evidence}`));
    pushList(sections, "Version disclosures", http.disclosures.map((d) =>
      `${d.header}: ${d.value}${d.hasVersion ? " (exposes a version)" : ""}`));
    pushList(sections, "Cookie flags", http.cookies.map((c) =>
      `${c.name}: Secure ${c.secure ? "yes" : "no"}, HttpOnly ${c.httpOnly ? "yes" : "no"}, SameSite ${c.sameSite ?? "unset"}`));

    const tls = http.tls;
    if (tls) {
      pushRows(sections, "TLS certificate", compact([
        ["Protocol", tls.protocol], ["Cipher", tls.cipher],
        ["Issuer", tls.issuer], ["Subject", tls.subject],
        ["Valid from", tls.validFrom], ["Valid to", tls.validTo],
        ["Days remaining", num(tls.daysRemaining)],
        ["Chain trusted", boolFlag(tls.trusted)],
        ["Trust error", tls.trustError],
        ["Alternative names", joinList(tls.altNames, 10)],
      ]));
    }
  }

  const wb = data.wayback;
  if (wb) {
    pushRows(sections, "Internet Archive", compact([
      ["Archived", boolFlag(wb.available)],
      ["First snapshot", wb.firstSnapshot],
      ["Snapshot URL", wb.snapshotUrl],
    ]));
  }

  // Catalogued breaches OF THE DOMAIN, which is not the same claim as "this
  // domain's users are compromised". The heading says which one it is.
  pushList(sections, "Breaches catalogued for this domain", (data.knownBreaches ?? []).map((b) => {
    const parts = [b.date ? `${b.name} (${b.date})` : b.name,
      b.records != null ? `${b.records.toLocaleString("en-US")} records` : null,
      joinList(b.dataClasses, 8), b.verified ? "verified" : null].filter(Boolean);
    return parts.join(" · ");
  }));

  if (data.subdomains.length) {
    sections.push({ heading: `Subdomains (${data.subdomains.length})`, list: data.subdomains });
  }
  // A subdomain count means nothing without its coverage basis: a
  // recent-issuance feed and the full CT history answered 9 and 25 for the same
  // domain in one measurement.
  const cov = data.subdomainCoverage;
  if (cov) {
    pushList(sections, "Subdomain coverage", [
      ...cov.sources.map((c) => `${c.source}: ${c.ok ? `${c.found} found` : "no answer"}`),
      `${cov.distinct} distinct${cov.capped ? `, list truncated to ${cov.limit}` : ""}`,
    ]);
  }
  pushList(sections, "Resolved subdomains", (data.subdomainHosts ?? []).map((h) =>
    `${h.host} → ${h.addresses.length ? h.addresses.join(", ") : "no A record"}`));

  const pdns = data.passiveDns;
  if (pdns && pdns.records.length > 0) {
    sections.push({
      heading: `Passive DNS (${pdns.total.toLocaleString("en-US")} records held)`,
      list: pdns.records.slice(0, 40).map((r) =>
        `${r.rrtype} ${r.query} → ${r.answer}${r.firstSeen ? ` (${r.firstSeen} to ${r.lastSeen ?? "now"})` : ""}`),
    });
  }

  pushList(sections, "Exposure on resolved addresses", (data.hostExposure ?? []).map((h) => {
    const bits = [
      h.ports?.length ? `ports ${h.ports.join(", ")}` : null,
      h.vulns?.length ? `CVEs ${joinList(h.vulns, 8)}` : null,
      h.tags?.length ? `tags ${h.tags.join(", ")}` : null,
      h.greyNoise ? `GreyNoise ${h.greyNoise.classification}` : null,
    ].filter(Boolean);
    return bits.length ? `${h.ip}: ${bits.join(" · ")}` : `${h.ip}: nothing reported`;
  }));

  const rip = data.reverseIp;
  if (rip && rip.hosts.length > 0) {
    sections.push({
      heading: `Co-hosted on ${rip.ip} (${rip.total.toLocaleString("en-US")} names)`,
      list: rip.hosts.slice(0, 40),
    });
  }

  const lei = data.lei;
  if (lei && lei.records.length > 0) {
    pushList(sections, `Legal entity register (queried as "${lei.query}" from the ${lei.source})`,
      lei.records.map((r) => {
        const bits = [r.legalName, `LEI ${r.lei}`, r.registeredAs ? `company no. ${r.registeredAs}` : null,
          r.legalAddress, r.status, r.exact ? "exact name match" : "similar name only"].filter(Boolean);
        return bits.join(" · ");
      }));
  }
  if (data.takeoverCandidates?.length) {
    // A reader cannot act on "candidate" alone, and the two states here mean
    // very different things: one was probed and shown to be takeable, the other
    // simply did not answer. The row says which.
    sections.push({
      heading: "Subdomain-takeover candidates",
      list: data.takeoverCandidates.map((c) =>
        c.verification === "unclaimed"
          ? `${c.name} → ${c.host} (${c.service}, ${c.status}, confirmed unclaimed)`
          : `${c.name} → ${c.host} (${c.service}, ${c.status}, unverified: host did not answer)`),
    });
  }

  // The HTTP-header grade is the headline above; the summary carries the facts.
  const summary = compact([
    ["Domain", data.domain],
    ["Registrar", whois?.registrar ?? null],
    ["Created", whois?.createdDate ?? null],
    ["Subdomains", data.subdomains.length ? String(data.subdomains.length) : null],
    ["Email posture", `SPF ${postureWord(es.hasSpf, "present", "missing")}, DMARC ${postureWord(es.hasDmarc, "present", "missing")}`],
    ["DNSSEC", postureWord(data.dnssec, "signed", "unsigned")],
    ["TLS", http?.tls ? `${http.tls.issuer ?? "issuer unknown"}, ${http.tls.trusted ? "trusted" : "not trusted"}` : null],
    ["Takeover candidates", data.takeoverCandidates?.length ? String(data.takeoverCandidates.length) : null],
    ["Passive DNS records", data.passiveDns ? String(data.passiveDns.total) : null],
    ["Co-hosted names", data.reverseIp ? String(data.reverseIp.total) : null],
    ["Legal entity", data.lei?.records.find((r) => r.exact)?.legalName ?? null],
  ]);

  const observables: StixObservable[] = [
    { type: "domain-name", value: data.domain },
    ...dns.a.map((r): StixObservable => ({ type: "ipv4-addr", value: r.value })),
  ];
  return {
    kind: "domain", subject: data.domain, generatedAt: nowIso(),
    headline: data.http ? { label: "HTTP headers", value: `grade ${data.http.security.grade}` } : undefined,
    summary, sections, sources: provRows(data.sourceHealth ?? data.sources), pivots: data.pivots.map((p) => ({ label: p.label, url: p.url })),
    observables,
    assessment: assess({ kind: "domain", data }),
  };
}

export function buildWalletReport(data: WalletLookupResponse): ReportModel {
  const { facts, ens } = data;
  const sections: ReportSection[] = [];

  if (facts) {
    pushRows(sections, "On-chain", compact([
      ["Chain", facts.chain.toUpperCase()],
      ["Address", facts.address],
      ["Balance", facts.balance],
      ["Balance in base units", facts.balanceRaw],
      ["Transactions", num(facts.txCount)],
      ["Total received", facts.totalReceived],
      ["Total sent", facts.totalSent],
    ]));
  }
  if (ens) {
    pushRows(sections, "ENS identity", compact([
      ["Name", ens.name],
      ["Address", ens.address],
      ["Forward-confirmed", boolFlag(ens.verified)],
      // A reverse record that does not resolve back is a spoofing signal, and
      // "verified: No" alone does not say that out loud.
      ["Caution", ens.verified ? null : "The reverse record does not resolve back to this address. Treat the name as unconfirmed."],
    ]));
  }

  // Sanctions first in the document, because it is the finding with a legal
  // consequence attached and the only one that can be answered offline.
  const sanc = data.sanctions;
  if (sanc) {
    pushRows(sections, "Sanctions screening", compact([
      ["OFAC SDN", sanc.listed ? "LISTED" : "not on the list"],
      ["Designated entity", sanc.matches.map((m) => m.entity).join("; ") || null],
      ["Programs", sanc.matches.flatMap((m) => m.programs).join(", ") || null],
      ["SDN entries", sanc.matches.map((m) => m.uid).join(", ") || null],
      ["List snapshot", `${sanc.listSize.toLocaleString("en-US")} addresses, ${sanc.snapshotDate}`],
      ["Scope", "The OFAC SDN list only. No match means not on this list, which is not the same as clean."],
    ]));
  }

  const act = data.activity;
  if (act) {
    pushRows(sections, "Recent activity (sampled)", compact([
      ["Last seen", act.lastActivity],
      ["Oldest in sample", act.oldestSampled],
      ["Transactions sampled", String(act.sampled)],
      ["Distinct counterparties", String(act.counterparties)],
      ["Sample note", act.capped
        ? "The address has more transactions than were sampled, so these are floors."
        : "The sample covers every transaction the explorer returned."],
    ]));
  }

  pushList(sections, "Token holdings", (data.tokens ?? []).map((t) => `${t.symbol}: ${t.amount}`));

  // The balance is the headline above; the summary carries the other facts.
  const summary = compact([
    ["Address", data.input],
    ["Chain", data.chain ? data.chain.toUpperCase() : null],
    ["Balance", facts?.balance ?? null],
    ["Transactions", num(facts?.txCount)],
    ["Sanctioned", sanc ? (sanc.listed ? "YES: OFAC SDN" : "no") : null],
    ["Last activity", act?.lastActivity ?? null],
    ["Token holdings", data.tokens?.length ? String(data.tokens.length) : null],
    ["ENS name", ens?.name ?? null],
  ]);

  return {
    kind: "wallet", subject: data.input, generatedAt: nowIso(),
    // A sanctions hit outranks a balance as the headline of the document.
    headline: sanc?.listed
      ? { label: "Sanctions", value: `OFAC SDN: ${sanc.matches[0]?.entity ?? "listed"}` }
      : facts ? { label: "Balance", value: facts.balance } : undefined,
    summary, sections, sources: provRows(data.sourceHealth),
    pivots: data.pivots.map((p) => ({ label: p.label, url: p.url })),
    observables: [],
    assessment: assess({ kind: "wallet", data }),
  };
}

export function buildHashReport(data: HashLookupResponse): ReportModel {
  const { facts, kind } = data;
  const sections: ReportSection[] = [];

  pushRows(sections, "Submitted hash", compact([
    ["Value", data.input],
    ["Algorithm", kind ? kind.toUpperCase() : null],
    ["Length", `${data.input.length} hex characters`],
  ]));

  if (facts) {
    pushRows(sections, "Known-software reputation", compact([
      ["Known software", boolFlag(facts.known)],
      ["File name", facts.fileName],
      ["File size", facts.fileSize != null ? `${facts.fileSize.toLocaleString("en-US")} bytes` : null],
      ["Product", facts.productName],
      ["Source", facts.source],
      ["Database", facts.database],
      ["Trust", facts.trust != null ? `${facts.trust}/100` : null],
    ]));
    pushRows(sections, "Cross-algorithm hashes", compact([
      ["MD5", facts.md5],
      ["SHA-1", facts.sha1],
      ["SHA-256", facts.sha256],
    ]));
  }

  // Absence of a catalog record is the finding most often misread, so the
  // report spells out what it does and does not mean rather than leaving a
  // reader to infer "unknown" means "suspicious".
  sections.push({
    heading: "How to read this verdict",
    list: [facts?.known
      ? "The hash matches a catalogued release of known software, so the file is very unlikely to be malicious on its own. Confirm the path and the code signature before clearing it."
      : "The catalogs do not hold this hash. That is not a malicious verdict: they index released software, not every file that exists. Pivot to a multi-engine scanner before drawing a conclusion."],
  });

  const verdict = facts?.known ? "Known software (catalogued benign)" : "Unknown (not in known-software catalog)";
  // The verdict is the headline above; the summary carries the other facts.
  const summary = compact([
    ["Hash", data.input],
    ["Algorithm", kind ? kind.toUpperCase() : null],
    ["Product", facts?.productName ?? null],
  ]);

  const observables: StixObservable[] = kind
    ? [{ type: "file", value: data.input, hashAlg: STIX_ALG[kind] }]
    : [];

  return {
    kind: "hash", subject: data.input, generatedAt: nowIso(),
    headline: { label: "Verdict", value: verdict },
    summary, sections, sources: provRows(data.sourceHealth),
    pivots: data.pivots.map((p) => ({ label: p.label, url: p.url })),
    observables,
    assessment: assess({ kind: "hash", data }),
  };
}

/** Everything the file panel knows about the file it just read. */
export interface FileReportInput {
  meta: UniversalMeta;
  /** The name the file was dropped under, which the bytes never state. */
  fileName: string;
  /** The filesystem's own modification time, in ISO form, when the browser
   *  reported one. It is the one fact here that comes from outside the bytes. */
  lastModified?: string | null;
  hashes?: FileHashes | null;
}

// The order metadata groups are printed in. A group the engine produces that is
// not listed here still prints, after these, in the order it was extracted; the
// list only fixes the sequence of the ones an analyst reads first.
const GROUP_ORDER = [
  "Document", "Mail", "Media", "Image", "Device", "Location", "IPTC", "XMP", "Data",
  "Statistics", "Structure", "Build", "Font", "Database", "Capture", "Archive", "Container",
  // Last, because it is the same handful of generic facts for every text file.
  "Text",
];

/** Human-readable byte size, matching what the panel shows. */
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** One-line reading of the entropy figure, as the panel words it. */
function entropyNote(bits: number): string {
  if (bits >= 7.5) return "high, so the contents are likely compressed or encrypted";
  if (bits < 1) return "very low, so the contents are highly repetitive";
  return "typical for structured data";
}

/**
 * A report for one locally inspected file.
 *
 * It is the only mode whose evidence came from no source at all: every field
 * was read out of the bytes in the browser, nothing was uploaded, and nothing
 * was asked of a third party. So it carries no source table and no risk score,
 * because there is no lookup to score. What it does carry is everything the
 * file discloses about itself, grouped the way the panel groups it.
 */
export function buildFileReport(input: FileReportInput): ReportModel {
  const { meta, fileName, lastModified, hashes } = input;
  const sections: ReportSection[] = [];

  pushRows(sections, "File", compact([
    ["Name", fileName],
    ["Detected type", meta.identity.label],
    ["MIME type", meta.identity.mime],
    ["Category", meta.identity.category],
    ["Size", `${humanSize(meta.size)} (${meta.size.toLocaleString("en-US")} bytes)`],
    ["Modified on disk", lastModified ?? null],
    ["Extension check", meta.extMismatch
      ? `MISMATCH: named .${meta.extMismatch.claimed}, contents are ${meta.extMismatch.actual}`
      : "the name matches the contents"],
    ["Entropy", meta.entropy === null ? null : `${meta.entropy.toFixed(2)} bits/byte (${entropyNote(meta.entropy)})`],
  ]));

  if (hashes) {
    pushRows(sections, "Integrity", compact([
      ["SHA-256", hashes.sha256],
      ["SHA-1", hashes.sha1],
    ]));
  }

  const gps = meta.gps;
  if (gps) {
    pushRows(sections, "Location", compact([
      ["Coordinate", decimalPair(gps)],
      ["Latitude", formatDms(gps.latitude, "lat")],
      ["Longitude", formatDms(gps.longitude, "lon")],
      ["Altitude", gps.altitude === null ? null : `${gps.altitude.toFixed(1)} m`],
      ["Heading", gps.direction === null ? null : `${gps.direction.toFixed(0)}°`],
    ]));
  }

  const image = meta.image;
  if (image) {
    pushRows(sections, "Image", compact([
      ["Format", image.format],
      ["Dimensions", image.width !== null && image.height !== null ? `${image.width} × ${image.height} px` : null],
      ["EXIF block", image.hasExif ? "present" : "absent"],
    ]));
  }
  if (image?.hasExif) {
    pushRows(sections, "Camera and capture", compact([
      ["Make", image.tags.make],
      ["Model", image.tags.model],
      ["Lens", image.tags.lens],
      ["Software", image.tags.software],
      ["Taken", image.tags.dateTimeOriginal],
      ["Aperture", image.tags.fNumber === null ? null : `f/${image.tags.fNumber}`],
      ["Shutter", image.tags.exposureTime],
      ["ISO", image.tags.iso === null ? null : String(image.tags.iso)],
      ["Focal length", image.tags.focalLength === null ? null : `${image.tags.focalLength} mm`],
      ["Orientation", image.tags.orientation === null ? null : String(image.tags.orientation)],
    ]));
  }

  // The format-specific fields, one section per group, in a fixed order so two
  // reports of the same kind of file read the same way.
  const groups = [...new Set(meta.fields.map((f) => f.group))];
  const ordered = [
    ...GROUP_ORDER.filter((g) => groups.includes(g)),
    ...groups.filter((g) => !GROUP_ORDER.includes(g)),
  ];
  for (const group of ordered) {
    pushRows(sections, `${group} metadata`, meta.fields
      .filter((f) => f.group === group)
      .map((f) => ({ label: f.label, value: f.value })));
  }

  if (meta.notes.length) pushList(sections, "Reading notes", meta.notes);

  const sensitive = meta.fields.filter((f) => f.sensitive);
  const headline = meta.hasDeepMeta
    ? `${meta.identity.label} carrying ${meta.fields.length} embedded ${meta.fields.length === 1 ? "field" : "fields"}`
    : `${meta.identity.label} with no embedded metadata`;

  const pivots = [
    ...(gps ? mapLinks(gps).map((p) => ({ label: p.label, url: p.url })) : []),
    ...(image ? reverseImageLinks().map((p) => ({ label: p.label, url: p.url })) : []),
  ];

  return {
    kind: "file",
    subject: fileName || meta.identity.label,
    generatedAt: nowIso(),
    headline: { label: "Contents", value: headline },
    summary: compact([
      ["Detected type", meta.identity.label],
      ["Size", humanSize(meta.size)],
      ["Embedded fields", String(meta.fields.length)],
      ["Attribution fields", sensitive.length > 0 ? String(sensitive.length) : null],
      ["Coordinate", gps ? decimalPair(gps) : null],
      ["SHA-256", hashes?.sha256 ?? null],
    ]),
    sections,
    // A local file inspection queries nothing, so there is no source table to
    // print and no latency to report.
    sources: [],
    pivots,
    observables: hashes ? [{ type: "file", value: hashes.sha256, hashAlg: "SHA-256" }] : [],
  };
}

// ── Shared document kit ────────────────────────────────────────────────────────
// Everything below is consumed by all four renderers. The on-screen dossier and
// the paged print document look nothing alike on purpose, but they are the same
// report: same outline, same numbering, same copy, same statistics. Anything a
// renderer invents for itself is a place where two exports of one lookup can
// disagree, so nothing here lives in a renderer.

export const CLASSIFICATION = "OSINT // Open-source derived // For authorized investigative use only";

export const METHODOLOGY: string[] = [
  "Produced by HEAVEN-GeoIntel from open-source lookups. Every field in this report was returned by a named data source; nothing was inferred, enriched by a language model, or invented.",
  "The risk score is a transparent, explainable model over the collected signals. It asserts no fact a source did not report, and each factor cites the evidence it came from.",
  "Fields a source did not return are omitted rather than printed as N/A, so a gap here means the data was not collected, not that it does not exist.",
  "A source that was never called because no API key is configured is recorded as not configured, never as a failure, and never as a negative finding.",
  "Collection is a snapshot. DNS, hosting, reputation and breach indexes all move, so re-run the lookup before relying on a report that has been sitting for a while.",
  "For authorized investigative use only. Verify every finding against the primary source before acting on it.",
];

/**
 * A file report is the one kind whose evidence came from nowhere but the file,
 * so the lines about sources, keys and re-running a lookup would all be false
 * in it. It gets its own set, which says what actually happened instead.
 */
export const FILE_METHODOLOGY: string[] = [
  "Produced by HEAVEN-GeoIntel by reading the file's own bytes in the browser. The file was not uploaded, and no data source was queried, so every field below was read out of the file itself.",
  "A field appears only when the format genuinely carried it. Nothing is inferred from the contents, and a value that was malformed is skipped rather than guessed at.",
  "Fields the file did not carry are omitted rather than printed as N/A, so a gap here means the format did not record it, not that it is unknown.",
  "Metadata is written by whatever produced the file, so it states what that software recorded. A timestamp, a name or a coordinate can be wrong, absent, or deliberately set, and none of it is independently verified here.",
  "Removing metadata from a copy does not remove it from the original, and an earlier copy of the same file may carry fields this one no longer has.",
  "For authorized investigative use only. Verify every finding against the primary source before acting on it.",
];

/** The methodology block appropriate to a report's kind. */
export function methodologyFor(m: ReportModel): string[] {
  return m.kind === "file" ? FILE_METHODOLOGY : METHODOLOGY;
}

/**
 * The cover's one-paragraph statement of where the evidence came from. A file
 * report queried nothing, so saying it was assembled from zero sources of which
 * zero answered would be both true and useless; it says what it did instead.
 */
export function provenanceNotice(m: ReportModel): string {
  const st = reportStats(m);
  if (m.kind === "file") {
    // The File section alone contributes five rows to every file report, so the
    // field count is never one and needs no singular form.
    return `Every field in this document was read from the file's own bytes, in the browser, without uploading it or querying any source. ${st.fields} fields were recorded across ${st.sections} ${st.sections === 1 ? "section" : "sections"}. Fields the file did not carry are omitted rather than padded, so a gap means the format did not record it.`;
  }
  return `This document was assembled from ${st.sources} open-source ${st.sources === 1 ? "source" : "sources"}, of which ${st.sourcesAnswered} answered. Every field it contains was returned by one of them. Fields no source returned are omitted rather than padded, so a gap means the data was not collected, not that it does not exist.`;
}

/** Plain-language legend, so the numbers survive being read outside the tool. */
export const LEGEND: ReportRow[] = [
  { label: "Risk score", value: "0 to 100, weighed over the signals that were actually collected. It is a triage aid, not a probability, and not a judgement about a person." },
  { label: "Band", value: "The plain-language bucket the score falls into: minimal, low, elevated, high or critical." },
  { label: "Confidence", value: "How much evidence the score rests on. Low confidence means few sources answered, not that the subject is clean." },
  { label: "Contributing factors", value: "Each factor's share of the score, with the evidence it was derived from. The shares sum to the score, so nothing is hidden." },
  { label: "Omitted fields", value: "A field a source did not return is left out. A gap means not collected, never confirmed absent." },
  { label: "Source states", value: "Answered, failed, or not configured. Only the first two involved a request to the source." },
];

export const TITLES: Record<ReportKind, string> = {
  phone: "Phone", email: "Email", username: "Username",
  ip: "IP Address", domain: "Domain", wallet: "Crypto Wallet", hash: "File Hash",
  file: "File Metadata",
};

export function reportTitle(m: ReportModel): string {
  return `${TITLES[m.kind]} Intelligence Report`;
}

/** Fixed section names, so a rename lands in every format at once. */
export const HEAD = {
  summary: "Executive summary",
  risk: "Risk assessment",
  sources: "Data sources",
  pivots: "Investigative pivots",
  narrative: "Analyst narrative",
  method: "Methodology and limitations",
  observables: "Appendix A: observables (STIX)",
  stats: "Appendix B: collection statistics",
} as const;

/**
 * The ordered outline every renderer follows. Returning it from one place is
 * what lets four documents share a table of contents: a renderer that skipped a
 * block the outline lists, or added one it does not, fails its own test.
 */
export function reportOutline(m: ReportModel): string[] {
  const out: string[] = [HEAD.summary];
  if (m.assessment) out.push(HEAD.risk);
  out.push(...m.sections.map((s) => s.heading));
  if (m.sources.length) out.push(HEAD.sources);
  if (m.pivots.length) out.push(HEAD.pivots);
  if (m.assessment?.narrative.length) out.push(HEAD.narrative);
  out.push(HEAD.method);
  if (m.observables.length) out.push(HEAD.observables);
  out.push(HEAD.stats);
  return out;
}

/** How much evidence the report rests on. Counted, never estimated. */
export interface ReportStats {
  sections: number;
  fields: number;
  items: number;
  sources: number;
  sourcesAnswered: number;
  sourcesFailed: number;
  /** Keyed sources whose key is not set. Adding one would enable them. */
  sourcesUnconfigured: number;
  /** Keyless sources this lookup had nothing to ask about. */
  sourcesNotApplicable: number;
  /** Median source latency in ms, or null when no source reported one. */
  medianMs: number | null;
  pivots: number;
  observables: number;
  factors: number;
  anomalies: number;
}

export function reportStats(m: ReportModel): ReportStats {
  let fields = m.summary?.length ?? 0;
  let items = 0;
  for (const s of m.sections) {
    fields += s.rows?.length ?? 0;
    items += s.list?.length ?? 0;
  }
  const latencies = m.sources
    .map((s) => s.ms)
    .filter((ms): ms is number => typeof ms === "number")
    .sort((a, b) => a - b);
  const mid = latencies.length >> 1;
  const medianMs = latencies.length === 0
    ? null
    : latencies.length % 2 === 1
      ? latencies[mid]!
      : Math.round((latencies[mid - 1]! + latencies[mid]!) / 2);
  const states = m.sources.map(sourceState);
  return {
    sections: m.sections.length,
    fields,
    items,
    sources: m.sources.length,
    sourcesAnswered: states.filter((s) => s === "answered").length,
    sourcesFailed: states.filter((s) => s === "failed").length,
    sourcesUnconfigured: states.filter((s) => s === "not configured").length,
    sourcesNotApplicable: states.filter((s) => s === "not applicable").length,
    medianMs,
    pivots: m.pivots.length,
    observables: m.observables.length,
    factors: m.assessment?.factors.length ?? 0,
    anomalies: m.assessment?.anomalies.length ?? 0,
  };
}

/** The collection-statistics appendix, identical in all four formats. */
export function statsRows(m: ReportModel): ReportRow[] {
  const st = reportStats(m);
  return compact([
    ["Sources queried", String(st.sources)],
    ["Answered", String(st.sourcesAnswered)],
    ["Failed", st.sourcesFailed > 0 ? String(st.sourcesFailed) : null],
    ["Not configured", st.sourcesUnconfigured > 0 ? String(st.sourcesUnconfigured) : null],
    ["Not applicable", st.sourcesNotApplicable > 0 ? String(st.sourcesNotApplicable) : null],
    ["Median source latency", st.medianMs != null ? `${st.medianMs} ms` : null],
    ["Evidence sections", String(st.sections)],
    ["Recorded fields", String(st.fields)],
    ["Recorded list entries", st.items > 0 ? String(st.items) : null],
    ["Risk factors", st.factors > 0 ? String(st.factors) : null],
    ["Flagged patterns", st.anomalies > 0 ? String(st.anomalies) : null],
    ["Pivot links", st.pivots > 0 ? String(st.pivots) : null],
    ["Observables", st.observables > 0 ? String(st.observables) : null],
  ]);
}

/**
 * Identity of the document itself, for the cover page and the file footer. The
 * id folds in `generatedAt`, so two runs of the same subject are two documents
 * and can be told apart when they are quoted back at you.
 */
export interface ReportMeta {
  documentId: string;
  title: string;
  subject: string;
  subjectType: string;
  generatedAt: string;
  tool: string;
  version: string;
  classification: string;
}

export function reportMeta(m: ReportModel): ReportMeta {
  return {
    documentId: `HGI-${detUuid(`${m.kind}:${m.subject}:${m.generatedAt}`).replace(/-/g, "").slice(0, 10).toUpperCase()}`,
    title: reportTitle(m),
    subject: m.subject,
    subjectType: TITLES[m.kind],
    generatedAt: m.generatedAt,
    tool: BRAND.name,
    version: APP_VERSION,
    classification: CLASSIFICATION,
  };
}

/** The document-control rows the cover page and the text letterhead share. */
export function controlRows(m: ReportModel): ReportRow[] {
  const meta = reportMeta(m);
  const st = reportStats(m);
  return [
    { label: "Document ID", value: meta.documentId },
    { label: "Subject", value: meta.subject },
    { label: "Subject type", value: meta.subjectType },
    { label: "Generated (UTC)", value: meta.generatedAt },
    { label: "Produced by", value: `${meta.tool} v${meta.version}` },
    {
      label: "Evidence basis",
      // A file report queried nothing, and "0 sources queried, 0 answered"
      // reads as a failed collection rather than as the local read it was.
      value: m.kind === "file"
        ? `read from the file's own bytes, ${st.fields} recorded fields`
        : `${st.sources} sources queried, ${st.sourcesAnswered} answered, ${st.fields} recorded fields`,
    },
    { label: "Handling", value: meta.classification },
  ];
}

// Escapes the four characters that matter in both HTML text and a double-quoted
// attribute value. The `"` escape is what keeps an interpolated href (or any
// other `attr="${esc(x)}"`) from being broken out of its quotes.
export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// GitHub-style heading anchor, so a Contents index can link straight to a
// section: lowercase, drop punctuation, spaces to hyphens.
export const slug = (s: string) => s.toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");

/** Risk-band accent for paper: legible ink, not the panel's neon. */
export const BAND_INK: Record<string, string> = {
  minimal: "#0a7a33", low: "#3f7d10", elevated: "#b26a00", high: "#c2410c", critical: "#b00020",
};

/** Risk-band accent for the screen dossier: the palette the app itself uses. */
export const BAND_NEON: Record<string, string> = {
  minimal: "#00ff85", low: "#7ee787", elevated: "#fbbf24", high: "#ff9f43", critical: "#ff4d6d",
};

export const bandInk = (band: string | undefined) => (band ? BAND_INK[band] ?? "#0a7a33" : "#0a7a33");
export const bandNeon = (band: string | undefined) => (band ? BAND_NEON[band] ?? "#00ff85" : "#00ff85");

// ── Plain-text renderer ────────────────────────────────────────────────────────

const BAR = "─".repeat(64);

/** `01.` … `12.`, so the Contents index and the body carry the same numbers. */
const no = (i: number) => String(i + 1).padStart(2, "0");

export function reportToText(m: ReportModel): string {
  const outline = reportOutline(m);
  const body: string[] = [];
  // The heading's number comes from its position in the shared outline, so the
  // index and the body can never disagree about what section 7 is.
  let n = 0;
  const block = (heading: string) => { body.push("", `${no(n++)}. ${heading.toUpperCase()}`, BAR); };
  const rows = (rs: ReportRow[] | undefined) => { for (const r of rs ?? []) body.push(`  ${r.label.padEnd(24)}: ${r.value}`); };
  const bullets = (items: string[]) => { for (const i of items) body.push(`  • ${i}`); };

  block(HEAD.summary);
  if (m.headline) body.push(`  ${m.headline.label.padEnd(24)}: ${m.headline.value}`);
  rows(m.summary);

  const a = m.assessment;
  if (a) {
    block(HEAD.risk);
    body.push(`  ${"Score".padEnd(24)}: ${a.score}/100 (${a.band}), confidence ${a.confidence}`);
    body.push(`  ${a.rationale}`);
    if (a.factors.length) {
      body.push("", "  Contributing factors:");
      for (const f of a.factors) {
        const share = Math.round(f.share * 100);
        // A bar drawn in hashes survives every terminal and every paste.
        body.push(`    ${"█".repeat(Math.max(1, Math.round(share / 5))).padEnd(20)} ${String(share).padStart(3)}%  ${f.label}`);
        body.push(`      evidence: ${f.evidence}`);
      }
    }
    if (a.anomalies.length) {
      body.push("", "  Flagged patterns:");
      for (const an of a.anomalies) body.push(`    - ${an.title} (${an.severity}): ${an.detail}`);
    }
  }

  for (const s of m.sections) {
    block(s.heading);
    rows(s.rows);
    bullets(s.list ?? []);
  }

  if (m.sources.length) {
    block(HEAD.sources);
    body.push(`  ${"SOURCE".padEnd(28)} ${"RESULT".padEnd(16)} LATENCY`);
    for (const s of m.sources) {
      body.push(`  ${s.source.padEnd(28)} ${sourceState(s).padEnd(16)} ${s.ms != null ? `${s.ms} ms` : ""}`.trimEnd());
      if (s.error) body.push(`    reported: ${s.error}`);
    }
  }

  if (m.pivots.length) {
    block(HEAD.pivots);
    for (const p of m.pivots) body.push(`  ${p.label}: ${p.url}`);
  }

  if (a?.narrative.length) {
    block(HEAD.narrative);
    for (const line of a.narrative) body.push(`  ${line}`);
  }

  block(HEAD.method);
  for (const line of methodologyFor(m)) body.push(`  ${line}`);
  body.push("", "  How to read the numbers:");
  for (const l of LEGEND) body.push(`    ${l.label}: ${l.value}`);

  if (m.observables.length) {
    block(HEAD.observables);
    body.push(`  ${"TYPE".padEnd(14)} ${"VALUE".padEnd(44)} STIX ID`);
    for (const o of m.observables) body.push(`  ${o.type.padEnd(14)} ${o.value.padEnd(44)} ${observableStixId(o)}`);
  }

  block(HEAD.stats);
  rows(statsRows(m));

  const out: string[] = [
    asciiLetterhead([
      `${BRAND.name}: ${reportTitle(m)}`,
      BRAND.tagline,
      "",
      // 15 is the longest control label ("Generated (UTC)"), so the colons line up.
      ...controlRows(m).map((r) => `${r.label.padEnd(15)}: ${r.value}`),
    ]),
  ];
  out.push("", "CONTENTS", BAR);
  outline.forEach((t, i) => out.push(`  ${no(i)}. ${t}`));
  out.push(...body);
  out.push("", BAR, `${reportMeta(m).documentId} · Generated by ${BRAND.name} v${APP_VERSION}: for authorized use only. Verify before acting.`);
  return out.join("\n");
}

// ── Markdown renderer ──────────────────────────────────────────────────────────

// Escape the backslash FIRST, then the pipe. Escaping only the pipe would turn
// an input backslash-pipe into "\\|", where the doubled backslash is itself an
// escaped backslash and the pipe reopens as a live table delimiter.
const mdCell = (s: string) => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");

function mdTable(out: string[], rs: ReportRow[]): void {
  out.push("", "| Field | Value |", "| --- | --- |");
  for (const r of rs) out.push(`| ${mdCell(r.label)} | ${mdCell(r.value)} |`);
}

export function reportToMarkdown(m: ReportModel): string {
  const outline = reportOutline(m);
  const body: string[] = [];
  let n = 0;
  const h2 = (title: string) => { body.push("", `## ${no(n++)}. ${title}`); };

  h2(HEAD.summary);
  if (m.headline) body.push("", `**${mdCell(m.headline.label)}: ${mdCell(m.headline.value)}**`);
  if (m.summary?.length) mdTable(body, m.summary);

  const a = m.assessment;
  if (a) {
    h2(HEAD.risk);
    body.push("", `- Score: ${a.score}/100 (${a.band}), confidence ${a.confidence}`, `- ${mdCell(a.rationale)}`);
    if (a.factors.length) {
      body.push("", "**Contributing factors**", "", "| Factor | Share | Evidence |", "| --- | --- | --- |");
      for (const f of a.factors) body.push(`| ${mdCell(f.label)} | ${Math.round(f.share * 100)}% | ${mdCell(f.evidence)} |`);
    }
    if (a.anomalies.length) {
      body.push("", "**Flagged patterns**", "", "| Pattern | Severity | Detail |", "| --- | --- | --- |");
      for (const an of a.anomalies) body.push(`| ${mdCell(an.title)} | ${an.severity} | ${mdCell(an.detail)} |`);
    }
  }

  for (const s of m.sections) {
    h2(s.heading);
    if (s.rows?.length) mdTable(body, s.rows);
    for (const item of s.list ?? []) body.push(`- ${mdCell(item)}`);
  }

  if (m.sources.length) {
    h2(HEAD.sources);
    body.push("", "| Source | Result | Latency | Reported |", "| --- | --- | --- | --- |");
    for (const s of m.sources) {
      body.push(`| ${mdCell(s.source)} | ${sourceState(s)} | ${s.ms != null ? `${s.ms} ms` : ""} | ${mdCell(s.error ?? "")} |`);
    }
  }

  if (m.pivots.length) {
    h2(HEAD.pivots);
    body.push("");
    for (const p of m.pivots) body.push(`- [${mdCell(p.label)}](${p.url})`);
  }

  if (a?.narrative.length) {
    h2(HEAD.narrative);
    body.push("", "_Grounded, computed locally; nothing invented._", "");
    for (const line of a.narrative) body.push(`- ${mdCell(line)}`);
  }

  h2(HEAD.method);
  body.push("");
  for (const line of methodologyFor(m)) body.push(`- ${mdCell(line)}`);
  body.push("", "**How to read the numbers**", "", "| Term | Meaning |", "| --- | --- |");
  for (const l of LEGEND) body.push(`| ${mdCell(l.label)} | ${mdCell(l.value)} |`);

  if (m.observables.length) {
    h2(HEAD.observables);
    body.push("", "| Type | Value | STIX ID |", "| --- | --- | --- |");
    for (const o of m.observables) body.push(`| \`${o.type}\` | ${mdCell(o.value)} | \`${observableStixId(o)}\` |`);
  }

  h2(HEAD.stats);
  mdTable(body, statsRows(m));

  const meta = reportMeta(m);
  const out: string[] = [
    `# ${BRAND.name}: ${reportTitle(m)}`,
    "",
    `> ${BRAND.tagline} · ${CLASSIFICATION}`,
    "",
    "| Document control | |",
    "| --- | --- |",
    ...controlRows(m).map((r) => `| ${mdCell(r.label)} | ${mdCell(r.value)} |`),
    "",
    "## Contents",
    "",
    ...outline.map((t, i) => `- [${no(i)}. ${t}](#${slug(`${no(i)}. ${t}`)})`),
  ];
  out.push(...body);
  out.push("", "---", "", `_${meta.documentId} · Generated by ${BRAND.name} v${meta.version}. For authorized use only; verify before acting._`);
  return out.join("\n");
}

// ── STIX 2.1 bundle ────────────────────────────────────────────────────────────

/**
 * 32-bit FNV-1a with a murmur3 final avalanche, multiplied through Math.imul.
 *
 * `Math.imul` is not a micro-optimisation here, it is the whole point: a plain
 * `h * 16777619` leaves the exact-integer range at 2^53, so the low bits of the
 * product are rounded away and every subsequent round inherits the damage.
 */
function fnv1a(seed: string, offset: number): number {
  let h = offset >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193) >>> 0;
  }
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Deterministic UUID-shaped id from a seed, so the same subject yields stable
 * STIX ids across exports.
 *
 * The first version of this ran a 32-bit LCG in floating-point arithmetic and
 * read four bits per round out of the damaged low end. It produced ids like
 * `d8888888-8888-4888-8888-888888888888` and collided on 6% of 20,000 distinct
 * seeds, which in a STIX bundle means two unrelated observables sharing one id
 * and a consumer merging them. Four independently-seeded avalanche rounds now
 * fill the 128 bits, with no collisions over the same 20,000 seeds.
 */
export function detUuid(seed: string): string {
  const a = fnv1a(seed, 0x811c9dc5);
  const b = fnv1a(seed, (a ^ 0x9e3779b9) >>> 0);
  const c = fnv1a(seed, (b ^ 0x85ebca6b) >>> 0);
  const d = fnv1a(seed, (c ^ 0xc2b2ae35) >>> 0);
  const s = [a, b, c, d].map((v) => v.toString(16).padStart(8, "0")).join("");
  // Version and variant nibbles pinned, so the id is a well-formed v4 shape.
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-8${s.slice(17, 20)}-${s.slice(20, 32)}`;
}

/**
 * The id this observable gets in the bundle. Exported so the observables
 * appendix in every rendered report can print the same id the STIX file
 * carries, which is what makes a document and its machine handoff citable
 * against each other.
 */
export function observableStixId(o: StixObservable): string {
  return `${o.type}--${detUuid(`${o.type}:${o.value}`)}`;
}

/** The scalar body of one STIX SCO, keyed by observable type. */
function scoBody(o: StixObservable): Record<string, unknown> {
  if (o.type === "user-account") return { account_login: o.value };
  if (o.type === "file") return { hashes: { [o.hashAlg ?? "SHA-256"]: o.value } };
  return { value: o.value };
}

/** STIX 2.1 bundle: an identity, the observables as SCOs, and a report SDO. */
export function reportToStixBundle(m: ReportModel): Record<string, unknown> {
  const created = m.generatedAt;
  const identityId = `identity--${detUuid("HEAVEN-GeoIntel")}`;
  const scos = m.observables.map((o) => ({
    type: o.type,
    spec_version: "2.1",
    id: observableStixId(o),
    ...scoBody(o),
  }));
  // A STIX report must reference at least one object; when a mode has no core
  // SCO (phone, wallet) the report references the producing identity instead.
  const objectRefs = scos.length ? scos.map((s) => s.id) : [identityId];
  const report = {
    type: "report", spec_version: "2.1",
    id: `report--${detUuid(`${m.kind}:${m.subject}`)}`,
    created, modified: created, name: `HEAVEN-GeoIntel ${m.kind} report: ${m.subject}`,
    published: created, report_types: ["osint"],
    created_by_ref: identityId,
    object_refs: objectRefs,
  };
  return {
    type: "bundle",
    id: `bundle--${detUuid(`bundle:${m.subject}`)}`,
    objects: [
      { type: "identity", spec_version: "2.1", id: identityId, created, modified: created, name: "HEAVEN-GeoIntel", identity_class: "system" },
      ...scos,
      report,
    ],
  };
}
