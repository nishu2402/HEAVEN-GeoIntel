// ── Unified investigation report model + renderers (pure, no network) ────────
//
// One report model for every mode, rendered identically. Each mode's builder
// fills a normalised ReportModel from its lookup response; the renderers turn
// that single shape into a plain-text brief, a Markdown document, a
// print-optimised HTML page (the browser's "Save as PDF" does the rest), and a
// STIX 2.1 bundle for machine handoff. Because every mode flows through the same
// model and the same renderers, a phone report and a domain report share the
// exact same structure, masthead, risk block and export formats.
//
// It is pure derivation over data the response already holds — no new lookups,
// nothing invented. A field the lookup did not learn is simply omitted, so a
// report never pads itself with "N/A" walls. The risk block is the same
// explainable AI assessment shown live in the panel (src/lib/ai), so a handoff
// carries the reasoning, not just the raw fields.

import type {
  LookupResponse, EmailLookupResponse, UsernameLookupResponse, IpLookupResponse,
  DomainLookupResponse, WalletLookupResponse, HashLookupResponse, SourceProvenance,
} from "../types";
import { analyzeLookup, type AnalyzeInput } from "../ai";
import { BRAND, asciiLetterhead, logoSvg } from "../brand/logo";

export interface ReportRow { label: string; value: string }
export interface ReportSection { heading: string; rows?: ReportRow[]; list?: string[] }

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
  | "phone" | "email" | "username" | "ip" | "domain" | "wallet" | "hash";

export interface ReportModel {
  kind: ReportKind;
  subject: string;
  generatedAt: string;
  /** The one-line verdict for the executive summary (score, grade, verdict). */
  headline?: ReportRow;
  /** A handful of curated key facts for the executive-summary band. */
  summary?: ReportRow[];
  sections: ReportSection[];
  sources: { source: string; ok: boolean; ms?: number }[];
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

function provRows(health: SourceProvenance[] | undefined): { source: string; ok: boolean; ms?: number }[] {
  return (health ?? []).map((h) => ({ source: h.source, ok: h.ok, ms: h.ms }));
}

/** Drop empty pairs, so a section never pads itself with blank rows. */
function compact(pairs: [string, string | null | undefined][]): ReportRow[] {
  return pairs.filter(([, v]) => v != null && v !== "").map(([label, value]) => ({ label, value: value as string }));
}

function boolFlag(v: boolean | null | undefined): string | null {
  return v === true ? "Yes" : v === false ? "No" : null;
}

/** Push a rows-section only when it has at least one row (no empty headings). */
function pushRows(sections: ReportSection[], heading: string, rows: ReportRow[]): void {
  if (rows.length) sections.push({ heading, rows });
}

/** STIX hash-algorithm names, keyed by our internal algorithm id. */
const STIX_ALG: Record<string, string> = { md5: "MD5", sha1: "SHA-1", sha256: "SHA-256" };

// ── Builders ─────────────────────────────────────────────────────────────────

export function buildPhoneReport(data: LookupResponse): ReportModel {
  const { input, aggregated: ag } = data;
  const sections: ReportSection[] = [];

  pushRows(sections, "Number", compact([
    ["E.164", input.e164],
    ["International", ag.formatInternational],
    ["National", ag.formatNational],
    ["Valid", boolFlag(input.isValid)],
    ["Line type", ag.lineType],
    ["Carrier", ag.carrier],
    ["Prepaid", boolFlag(ag.prepaid)],
  ]));
  pushRows(sections, "Geolocation", compact([
    ["Country", ag.countryName ? `${ag.countryName} (${ag.country})` : null],
    ["Calling code", input.countryCallingCode],
    ["Region", ag.region],
    ["City", ag.city],
    ["Timezone", ag.timezone?.[0] ?? null],
  ]));
  pushRows(sections, "Risk signals", compact([
    ["Fraud score", ag.fraudScore != null ? `${ag.fraudScore}/100` : null],
    ["High risk", boolFlag(ag.isRisky)],
    ["Recent abuse", boolFlag(ag.recentAbuse)],
    ["VoIP", boolFlag(ag.isVoip)],
    ["Disposable", boolFlag(ag.isDisposable)],
  ]));

  // The verdict is the headline above; the summary carries the supporting facts.
  const summary = compact([
    ["Number", input.e164],
    ["Country", ag.countryName ?? null],
    ["Line type", ag.lineType],
    ["Carrier", ag.carrier],
    ["Prepaid", boolFlag(ag.prepaid)],
  ]);

  return {
    kind: "phone", subject: input.e164, generatedAt: nowIso(),
    headline: { label: "Threat", value: `${data.threatScore}/100: ${data.threatLabel}` },
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
  if (agg) {
    pushRows(sections, "Breach exposure", compact([
      ["Breaches", String(agg.total)],
      ["With passwords", agg.withPassword > 0 ? String(agg.withPassword) : null],
      ["Reporting sources", agg.sourcesReporting.join(", ") || null],
      ["Data classes", agg.dataClasses.slice(0, 12).join(", ") || null],
    ]));
  }

  if (gr.found) {
    pushRows(sections, "Gravatar profile", compact([
      ["Display name", gr.displayName],
      ["Location", gr.currentLocation],
      ["Profile", gr.profileUrl],
      ["Linked accounts", gr.accounts.length ? String(gr.accounts.length) : null],
    ]));
  }

  // The risk verdict is the headline above; the summary carries the facts.
  const summary = compact([
    ["Address", data.email],
    ["Provider", an.providerName],
    ["Type", an.providerType],
    ["Breaches", agg ? String(agg.total) : null],
  ]);

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

  if (found.length) {
    sections.push({ heading: "Confirmed accounts", list: found.map((h) => `${h.site}: ${h.url}`) });
  }
  if (data.profiles.length) {
    sections.push({
      heading: "Verified profiles",
      list: data.profiles.map((p) => {
        const bits = [p.platform, p.displayName, p.location, p.joinedYear ? `joined ${p.joinedYear}` : null]
          .filter(Boolean).join(" · ");
        return `${bits}: ${p.url}`;
      }),
    });
  }
  const names = data.identity.names.map((n) => `${n.value} (${n.source})`);
  if (names.length) sections.push({ heading: "Identity signals: names", list: names });

  // The confirmed-account count is the headline above; the summary adds facts.
  const summary = compact([
    ["Username", data.username],
    ["Sites checked", String(data.checked)],
    ["Rich profiles", String(data.profiles.length)],
    ["Names found", data.identity.names.length ? String(data.identity.names.length) : null],
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
  if (ip) {
    sections.push({
      heading: "Geolocation",
      rows: compact([
        ["City", ip.city], ["Region", ip.region],
        ["Country", ip.country], ["Country code", ip.countryCode],
        ["Coordinates", ip.latitude != null && ip.longitude != null ? `${ip.latitude}, ${ip.longitude}` : null],
        ["Timezone", ip.timezone],
      ]),
    });
    sections.push({
      heading: "Network / ASN",
      rows: compact([
        ["ASN", ip.asn != null ? `AS${ip.asn}` : null], ["AS org", ip.asnOrg], ["ISP", ip.isp],
        ["Reverse DNS", ip.reverse], ["Prefix", ip.prefix ?? null],
        ["ASN prefixes", ip.announcedPrefixes != null ? String(ip.announcedPrefixes) : null],
        ["Abuse contact", ip.abuseContact ?? null],
      ]),
    });
    const flags = compact([
      ["VPN / proxy", boolFlag(ip.isVpn)], ["Hosting", boolFlag(ip.isHosting)],
      ["Tor", boolFlag(ip.isTor)], ["Mobile", boolFlag(ip.isMobile)],
    ]);
    if (flags.length) sections.push({ heading: "Risk flags", rows: flags });
    if (ip.ports?.length) sections.push({ heading: "Open ports", list: ip.ports.map(String) });
    if (ip.vulns?.length) sections.push({ heading: "Known CVEs", list: ip.vulns });
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
    ]),
  });
  sections.push({
    heading: "Email security",
    rows: [
      { label: "SPF", value: es.hasSpf ? "present" : "missing" },
      { label: "DMARC", value: es.hasDmarc ? (es.dmarcPolicy ?? "set") : "missing" },
      { label: "MX", value: es.hasMx ? "yes" : "no" },
    ],
  });
  if (whois) {
    sections.push({
      heading: "WHOIS",
      rows: compact([
        ["Registrar", whois.registrar], ["Created", whois.createdDate],
        ["Expires", whois.expiresDate], ["Registrant", whois.registrantOrg],
      ]),
    });
  }
  if (data.subdomains.length) {
    sections.push({ heading: `Subdomains (${data.subdomains.length})`, list: data.subdomains });
  }
  if (data.takeoverCandidates?.length) {
    sections.push({
      heading: "Subdomain-takeover candidates",
      list: data.takeoverCandidates.map((c) => `${c.name} → ${c.host} (${c.service}, ${c.status})`),
    });
  }

  // The HTTP-header grade is the headline above; the summary carries the facts.
  const summary = compact([
    ["Domain", data.domain],
    ["Registrar", whois?.registrar ?? null],
    ["Subdomains", data.subdomains.length ? String(data.subdomains.length) : null],
    ["Email posture", `SPF ${es.hasSpf ? "present" : "missing"}, DMARC ${es.hasDmarc ? "present" : "missing"}`],
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
      ["Balance", facts.balance],
      ["Transactions", facts.txCount != null ? String(facts.txCount) : null],
      ["Total received", facts.totalReceived],
      ["Total sent", facts.totalSent],
    ]));
  }
  if (ens) {
    pushRows(sections, "ENS identity", compact([
      ["Name", ens.name],
      ["Address", ens.address],
      ["Verified", boolFlag(ens.verified)],
    ]));
  }

  // The balance is the headline above; the summary carries the other facts.
  const summary = compact([
    ["Address", data.input],
    ["Chain", data.chain ? data.chain.toUpperCase() : null],
    ["Transactions", facts?.txCount != null ? String(facts.txCount) : null],
  ]);

  return {
    kind: "wallet", subject: data.input, generatedAt: nowIso(),
    headline: facts ? { label: "Balance", value: facts.balance } : undefined,
    summary, sections, sources: provRows(data.sourceHealth),
    pivots: data.pivots.map((p) => ({ label: p.label, url: p.url })),
    observables: [],
    assessment: assess({ kind: "wallet", data }),
  };
}

export function buildHashReport(data: HashLookupResponse): ReportModel {
  const { facts, kind } = data;
  const sections: ReportSection[] = [];

  if (facts) {
    pushRows(sections, "Known-software reputation", compact([
      ["Known software", boolFlag(facts.known)],
      ["File name", facts.fileName],
      ["File size", facts.fileSize != null ? `${facts.fileSize} bytes` : null],
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

// ── Shared copy ────────────────────────────────────────────────────────────────

const CLASSIFICATION = "OSINT // Open-source derived // For authorized investigative use only";

const METHODOLOGY: string[] = [
  "Produced by HEAVEN-GeoIntel from keyless, open-source lookups. Every field above was returned by a named data source; nothing was inferred or invented.",
  "The risk score is a transparent, explainable model over the collected signals. It asserts no fact a source did not report, and each factor cites the evidence it came from.",
  "Fields a source did not return are omitted, so a gap here means the data was not collected, not that it does not exist.",
  "For authorized investigative use only. Verify every finding before acting on it.",
];

const TITLES: Record<ReportKind, string> = {
  phone: "Phone", email: "Email", username: "Username",
  ip: "IP Address", domain: "Domain", wallet: "Crypto Wallet", hash: "File Hash",
};

function reportTitle(m: ReportModel): string {
  return `${TITLES[m.kind]} Intelligence Report`;
}

// ── Plain-text renderer ────────────────────────────────────────────────────────

const BAR = "─".repeat(64);

export function reportToText(m: ReportModel): string {
  // Body and table-of-contents are built together: `block()` records each
  // top-level heading in `toc` as it writes it, so the CONTENTS index can never
  // list a section the report does not actually contain.
  const body: string[] = [];
  const toc: string[] = [];
  const block = (heading: string) => { toc.push(heading); body.push("", heading, BAR); };
  const rows = (rs: ReportRow[] | undefined) => { for (const r of rs ?? []) body.push(`  ${r.label.padEnd(18)}: ${r.value}`); };

  block("EXECUTIVE SUMMARY");
  if (m.headline) body.push(`  ${m.headline.label.padEnd(18)}: ${m.headline.value}`);
  rows(m.summary);

  const a = m.assessment;
  if (a) {
    block("RISK ASSESSMENT");
    body.push(`  ${"Score".padEnd(18)}: ${a.score}/100 (${a.band}), confidence ${a.confidence}`);
    body.push(`  ${a.rationale}`);
    if (a.factors.length) {
      body.push("", "  Contributing factors:");
      for (const f of a.factors) body.push(`    - ${f.label} (${Math.round(f.share * 100)}%): ${f.evidence}`);
    }
    if (a.anomalies.length) {
      body.push("", "  Flagged patterns:");
      for (const an of a.anomalies) body.push(`    - ${an.title} (${an.severity}): ${an.detail}`);
    }
  }

  for (const s of m.sections) {
    block(s.heading.toUpperCase());
    rows(s.rows);
    for (const item of s.list ?? []) body.push(`  • ${item}`);
  }

  if (m.sources.length) {
    block("DATA SOURCES");
    for (const s of m.sources) body.push(`  ${s.ok ? "OK " : "ERR"} ${s.source}${s.ms != null ? ` · ${s.ms}ms` : ""}`);
  }

  if (m.pivots.length) {
    block("INVESTIGATIVE PIVOTS");
    for (const p of m.pivots) body.push(`  ${p.label}: ${p.url}`);
  }

  if (a?.narrative.length) {
    block("ANALYST NARRATIVE");
    for (const line of a.narrative) body.push(`  ${line}`);
  }

  block("METHODOLOGY & CAVEATS");
  for (const line of METHODOLOGY) body.push(`  ${line}`);

  if (m.observables.length) {
    block("APPENDIX: OBSERVABLES (STIX)");
    for (const o of m.observables) body.push(`  ${o.type.padEnd(12)}: ${o.value}`);
  }

  const out: string[] = [
    asciiLetterhead([
      `${BRAND.name}: ${reportTitle(m)}`,
      BRAND.tagline,
      "",
      `Subject       : ${m.subject}`,
      `Generated     : ${m.generatedAt}`,
      `Classification: ${CLASSIFICATION}`,
    ]),
  ];
  out.push("", "CONTENTS", BAR);
  toc.forEach((t, i) => out.push(`  ${String(i + 1).padStart(2, "0")}. ${t}`));
  out.push(...body);
  out.push("", BAR, "Generated by HEAVEN-GeoIntel: for authorized use only. Verify before acting.");
  return out.join("\n");
}

// ── Markdown renderer ──────────────────────────────────────────────────────────

// Escape the backslash FIRST, then the pipe. Escaping only the pipe would turn
// an input backslash-pipe into "\\|", where the doubled backslash is itself an
// escaped backslash and the pipe reopens as a live table delimiter.
const mdCell = (s: string) => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
// Escapes the four characters that matter in both HTML text and a double-quoted
// attribute value. The `"` escape is what keeps an interpolated href (or any
// other `attr="${esc(x)}"`) from being broken out of its quotes.
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// GitHub-style heading anchor, so the Contents index and the printable HTML can
// link straight to a section: lowercase, drop punctuation, spaces to hyphens.
const slug = (s: string) => s.toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");

function mdTable(out: string[], rs: ReportRow[]): void {
  out.push("", "| Field | Value |", "| --- | --- |");
  for (const r of rs) out.push(`| ${mdCell(r.label)} | ${mdCell(r.value)} |`);
}

export function reportToMarkdown(m: ReportModel): string {
  // As with the text renderer, headings register themselves in `toc` as they are
  // written, so the Contents index links only to sections that exist.
  const body: string[] = [];
  const toc: string[] = [];
  const h2 = (title: string) => { toc.push(title); body.push("", `## ${title}`); };

  if (m.summary?.length) {
    h2("Executive summary");
    mdTable(body, m.summary);
  }

  const a = m.assessment;
  if (a) {
    h2("Risk assessment");
    body.push("", `- Score: ${a.score}/100 (${a.band}), confidence ${a.confidence}`, `- ${mdCell(a.rationale)}`);
    if (a.factors.length) {
      body.push("", "**Contributing factors**");
      for (const f of a.factors) body.push(`- ${mdCell(f.label)} (${Math.round(f.share * 100)}%): ${mdCell(f.evidence)}`);
    }
    if (a.anomalies.length) {
      body.push("", "**Flagged patterns**");
      for (const an of a.anomalies) body.push(`- ${mdCell(an.title)} (${an.severity}): ${mdCell(an.detail)}`);
    }
  }

  for (const s of m.sections) {
    h2(s.heading);
    if (s.rows?.length) mdTable(body, s.rows);
    for (const item of s.list ?? []) body.push(`- ${mdCell(item)}`);
  }

  if (m.sources.length) {
    h2("Data sources");
    for (const s of m.sources) body.push(`- ${s.ok ? "✅" : "❌"} ${s.source}${s.ms != null ? ` (${s.ms}ms)` : ""}`);
  }

  if (m.pivots.length) {
    h2("Investigative pivots");
    for (const p of m.pivots) body.push(`- [${mdCell(p.label)}](${p.url})`);
  }

  if (a?.narrative.length) {
    h2("Analyst narrative");
    body.push("", "_Grounded, computed locally; nothing invented._", "");
    for (const line of a.narrative) body.push(`- ${mdCell(line)}`);
  }

  h2("Methodology & caveats");
  body.push("");
  for (const line of METHODOLOGY) body.push(`- ${mdCell(line)}`);

  if (m.observables.length) {
    h2("Appendix: observables (STIX)");
    body.push("");
    for (const o of m.observables) body.push(`- \`${o.type}\`: ${mdCell(o.value)}`);
  }

  const out: string[] = [
    `# HEAVEN-GeoIntel: ${m.kind} intelligence report: ${m.subject}`,
    "",
    `> ${BRAND.tagline} · ${CLASSIFICATION}`,
    "",
    `- Generated: ${m.generatedAt}`,
    ...(m.headline ? [`- ${m.headline.label}: ${mdCell(m.headline.value)}`] : []),
    "",
    "## Contents",
    "",
    ...toc.map((t) => `- [${t}](#${slug(t)})`),
  ];
  out.push(...body);
  return out.join("\n");
}

// ── HTML renderer (print-optimised → Save as PDF) ──────────────────────────────

// Risk-band accent, so the printed report carries the same colour language as
// the live panel.
const BAND_HEX: Record<string, string> = {
  minimal: "#0a7a33", low: "#3f7d10", elevated: "#b26a00", high: "#c2410c", critical: "#b00020",
};

function htmlSection(s: ReportSection): string {
  const parts = [`<h2 id="${slug(s.heading)}">${esc(s.heading)}</h2>`];
  if (s.rows?.length) {
    parts.push("<table>", ...s.rows.map((r) => `<tr><th>${esc(r.label)}</th><td>${esc(r.value)}</td></tr>`), "</table>");
  }
  if (s.list?.length) parts.push("<ul>", ...s.list.map((i) => `<li>${esc(i)}</li>`), "</ul>");
  return parts.join("\n");
}

export function reportToHtml(m: ReportModel): string {
  const a = m.assessment;
  const accent = a ? (BAND_HEX[a.band] ?? "#0a7a33") : "#0a7a33";
  const head: string[] = [];
  const body: string[] = [];
  const toc: string[] = [];
  // Emit a section heading and register it in the Contents index in one step, so
  // the id an index link points at and the heading it lands on can never drift.
  const h2 = (title: string) => { toc.push(title); return `<h2 id="${slug(title)}">${esc(title)}</h2>`; };

  head.push(
    `<header class="cover">`,
    logoSvg({ size: 56, idPrefix: "rpt", title: BRAND.name }),
    `<div><h1>${esc(BRAND.name)}</h1><p class="tag">${esc(reportTitle(m))}</p></div>`,
    `</header>`,
    `<p class="meta"><strong>Subject:</strong> ${esc(m.subject)} &nbsp;·&nbsp; <strong>Generated:</strong> ${esc(m.generatedAt)}</p>`,
    `<p class="class">${esc(CLASSIFICATION)}</p>`,
  );

  // Executive summary card.
  body.push(`<section class="summary">${h2("Executive summary")}`);
  if (m.headline) body.push(`<p class="verdict">${esc(m.headline.label)}: <strong>${esc(m.headline.value)}</strong></p>`);
  if (m.summary?.length) {
    body.push("<table>", ...m.summary.map((r) => `<tr><th>${esc(r.label)}</th><td>${esc(r.value)}</td></tr>`), "</table>");
  }
  body.push(`</section>`);

  // Risk assessment with a decomposed meter.
  if (a) {
    body.push(
      `<section class="risk">${h2("Risk assessment")}`,
      `<div class="meter"><div class="fill" style="width:${a.score}%;background:${accent}"></div></div>`,
      `<p class="score"><strong style="color:${accent}">${a.score}/100</strong> ${esc(a.band)} · confidence ${esc(a.confidence)}</p>`,
      `<p>${esc(a.rationale)}</p>`,
    );
    if (a.factors.length) {
      body.push(`<h3>Contributing factors</h3><ul>`,
        ...a.factors.map((f) => `<li><strong>${esc(f.label)}</strong> (${Math.round(f.share * 100)}%): ${esc(f.evidence)}</li>`),
        `</ul>`);
    }
    if (a.anomalies.length) {
      body.push(`<h3>Flagged patterns</h3><ul>`,
        ...a.anomalies.map((an) => `<li><strong>${esc(an.title)}</strong> (${esc(an.severity)}): ${esc(an.detail)}</li>`),
        `</ul>`);
    }
    body.push(`</section>`);
  }

  for (const s of m.sections) { toc.push(s.heading); body.push(htmlSection(s)); }

  if (m.sources.length) {
    body.push(`${h2("Data sources")}<ul class="sources">`,
      ...m.sources.map((s) => `<li>${s.ok ? "✅" : "❌"} ${esc(s.source)}${s.ms != null ? ` <span class="ms">${s.ms}ms</span>` : ""}</li>`),
      "</ul>");
  }

  if (m.pivots.length) {
    body.push(`${h2("Investigative pivots")}<ul>`,
      ...m.pivots.map((p) => `<li><a href="${esc(p.url)}">${esc(p.label)}</a></li>`),
      "</ul>");
  }

  if (a?.narrative.length) {
    body.push(h2("Analyst narrative"), `<p class="note">Grounded, computed locally; nothing invented.</p>`, "<ul>",
      ...a.narrative.map((l) => `<li>${esc(l)}</li>`), "</ul>");
  }

  body.push(`${h2("Methodology & caveats")}<ul>`, ...METHODOLOGY.map((l) => `<li>${esc(l)}</li>`), "</ul>");

  if (m.observables.length) {
    body.push(`${h2("Appendix: observables (STIX)")}<table>`,
      ...m.observables.map((o) => `<tr><th>${esc(o.type)}</th><td>${esc(o.value)}</td></tr>`),
      "</table>");
  }

  // Contents index. Always non-empty (Executive summary + Methodology always
  // render), so it is emitted unconditionally.
  const nav = [
    `<nav class="toc"><h2 class="toc-h">Contents</h2><ol>`,
    ...toc.map((t) => `<li><a href="#${slug(t)}">${esc(t)}</a></li>`),
    `</ol></nav>`,
  ];
  const doc = [...head, ...nav, ...body].join("\n");

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(BRAND.name)} Report: ${esc(m.subject)}</title>
<style>
  :root { --accent: ${accent}; }
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; max-width: 900px; margin: 0 auto; padding: 40px 28px; color: #10151f; background: #fff; line-height: 1.5; }
  .cover { display: flex; align-items: center; gap: 16px; padding-bottom: 16px; border-bottom: 3px solid var(--accent); }
  .cover h1 { font-size: 20px; margin: 0; letter-spacing: .04em; }
  .cover .tag { margin: 2px 0 0; font-size: 12px; text-transform: uppercase; letter-spacing: .16em; color: #556; }
  .meta { font-size: 13px; margin: 14px 0 2px; color: #333; }
  .class { font-size: 11px; text-transform: uppercase; letter-spacing: .12em; color: #7a5; margin: 0 0 8px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .12em; color: var(--accent); border-bottom: 1px solid #e3e8ef; padding-bottom: 5px; margin: 26px 0 10px; }
  h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .1em; color: #445; margin: 14px 0 4px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; margin: 4px 0; }
  th { text-align: left; width: 210px; color: #556; font-weight: 600; padding: 4px 10px 4px 0; vertical-align: top; }
  td { padding: 4px 0; word-break: break-word; }
  ul { font-size: 13px; margin: 6px 0; padding-left: 20px; } li { margin: 3px 0; word-break: break-word; }
  .summary, .risk { background: #f7f9fc; border: 1px solid #e3e8ef; border-radius: 8px; padding: 8px 16px 16px; margin-top: 18px; }
  .summary h2, .risk h2 { margin-top: 12px; }
  .verdict { font-size: 15px; margin: 6px 0; }
  .meter { height: 8px; background: #e3e8ef; border-radius: 6px; overflow: hidden; margin: 8px 0; }
  .meter .fill { height: 100%; border-radius: 6px; }
  .score { font-size: 14px; margin: 4px 0; text-transform: capitalize; }
  .sources .ms { color: #889; }
  .note { font-size: 11px; color: #778; font-style: italic; margin: 2px 0 6px; }
  a { color: #0366d6; word-break: break-all; }
  .toc { background: #f7f9fc; border: 1px solid #e3e8ef; border-radius: 8px; padding: 6px 18px 14px; margin: 18px 0; page-break-inside: avoid; }
  .toc .toc-h { border: 0; margin: 10px 0 4px; padding: 0; }
  .toc ol { margin: 4px 0 0; padding-left: 26px; font-size: 13px; columns: 2; column-gap: 28px; }
  .toc li { margin: 2px 0; break-inside: avoid; }
  .toc a { color: var(--accent); text-decoration: none; word-break: normal; }
  footer { margin-top: 34px; padding-top: 12px; border-top: 1px solid #e3e8ef; color: #889; font-size: 11px; }
  @page { margin: 16mm; }
  @media print {
    body { padding: 0; max-width: none; }
    .summary, .risk, .toc { background: #fff; }
    h2, h3 { page-break-after: avoid; }
    .summary, .risk, .toc, table, ul { page-break-inside: avoid; }
    a { color: #10151f; }
  }
</style></head><body>
${doc}
<footer>Generated by ${esc(BRAND.name)}: for authorized use only. Verify before acting.</footer>
</body></html>`;
}

// ── STIX 2.1 bundle ────────────────────────────────────────────────────────────

/** Deterministic UUID-shaped id from a seed, so the same subject yields stable ids. */
export function detUuid(seed: string): string {
  let h = 5381 >>> 0;
  for (let i = 0; i < seed.length; i++) h = (((h << 5) + h) + seed.charCodeAt(i)) >>> 0;
  let x = h;
  let s = "";
  for (let i = 0; i < 32; i++) { x = (x * 1103515245 + 12345) >>> 0; s += ((x >>> 8) & 0xf).toString(16); }
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-8${s.slice(17, 20)}-${s.slice(20, 32)}`;
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
    id: `${o.type}--${detUuid(`${o.type}:${o.value}`)}`,
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
