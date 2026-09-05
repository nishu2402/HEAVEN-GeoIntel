// ── Unified investigation report model + renderers (pure, no network) ────────
//
// Through 2.1 only phone and email could produce a report. This module gives
// every mode one: a normalised ReportModel, per-mode builders that fill it from
// a lookup response, and renderers to plain text, Markdown, a print-optimised
// HTML page (the browser's "Save as PDF" does the rest), and a STIX 2.1 bundle
// for machine handoff into another tool.
//
// It is pure derivation over data the response already holds — no new lookups,
// nothing invented. A field the lookup did not learn is simply omitted, so a
// report never pads itself with "N/A" walls.

import type {
  UsernameLookupResponse, IpLookupResponse, DomainLookupResponse, SourceProvenance,
} from "../types";

export interface ReportRow { label: string; value: string }
export interface ReportSection { heading: string; rows?: ReportRow[]; list?: string[] }

/** A STIX Cyber-observable to emit: a type plus its primary value. */
export interface StixObservable { type: "domain-name" | "ipv4-addr" | "ipv6-addr" | "user-account" | "email-addr" | "url"; value: string }

export interface ReportModel {
  kind: "username" | "ip" | "domain";
  subject: string;
  generatedAt: string;
  headline?: ReportRow;
  sections: ReportSection[];
  sources: { source: string; ok: boolean; ms?: number }[];
  pivots: { label: string; url: string }[];
  observables: StixObservable[];
}

const nowIso = () => new Date().toISOString();

function provRows(health: SourceProvenance[] | undefined): { source: string; ok: boolean; ms?: number }[] {
  return (health ?? []).map((h) => ({ source: h.source, ok: h.ok, ms: h.ms }));
}

// ── Builders ─────────────────────────────────────────────────────────────────

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

  const observables: StixObservable[] = [{ type: "user-account", value: data.username }];
  return {
    kind: "username", subject: data.username, generatedAt: nowIso(),
    headline: { label: "Confirmed accounts", value: `${data.found} of ${data.checked}` },
    sections, sources: provRows(data.sourceHealth), pivots: data.pivots, observables,
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

  const observables: StixObservable[] = [{ type: data.ip?.type === "IPv6" ? "ipv6-addr" : "ipv4-addr", value: data.input }];
  return {
    kind: "ip", subject: data.input, generatedAt: nowIso(),
    headline: { label: "Threat", value: `${data.threatScore}/100: ${data.threatLabel}` },
    sections, sources: provRows(data.sourceHealth ?? data.sources), pivots: data.pivots.map((p) => ({ label: p.label, url: p.url })),
    observables,
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

  const observables: StixObservable[] = [
    { type: "domain-name", value: data.domain },
    ...dns.a.map((r): StixObservable => ({ type: "ipv4-addr", value: r.value })),
  ];
  return {
    kind: "domain", subject: data.domain, generatedAt: nowIso(),
    headline: data.http ? { label: "HTTP headers", value: `grade ${data.http.security.grade}` } : undefined,
    sections, sources: provRows(data.sourceHealth ?? data.sources), pivots: data.pivots.map((p) => ({ label: p.label, url: p.url })),
    observables,
  };
}

function compact(pairs: [string, string | null | undefined][]): ReportRow[] {
  return pairs.filter(([, v]) => v != null && v !== "").map(([label, value]) => ({ label, value: value as string }));
}

function boolFlag(v: boolean | null | undefined): string | null {
  return v === true ? "Yes" : v === false ? "No" : null;
}

// ── Renderers ─────────────────────────────────────────────────────────────────

const BAR = "─".repeat(64);

export function reportToText(m: ReportModel): string {
  const out: string[] = [
    `HEAVEN-GeoIntel: ${m.kind.toUpperCase()} intelligence report`,
    `Subject   : ${m.subject}`,
    `Generated : ${m.generatedAt}`,
  ];
  if (m.headline) out.push(`${m.headline.label} : ${m.headline.value}`);
  for (const s of m.sections) {
    out.push("", s.heading.toUpperCase(), BAR);
    for (const r of s.rows ?? []) out.push(`  ${r.label.padEnd(18)}: ${r.value}`);
    for (const item of s.list ?? []) out.push(`  • ${item}`);
  }
  if (m.sources.length) {
    out.push("", "DATA SOURCES", BAR);
    for (const s of m.sources) out.push(`  ${s.ok ? "OK " : "ERR"} ${s.source}${s.ms != null ? ` · ${s.ms}ms` : ""}`);
  }
  if (m.pivots.length) {
    out.push("", "PIVOTS", BAR);
    for (const p of m.pivots) out.push(`  ${p.label}: ${p.url}`);
  }
  out.push("", BAR, "Generated by HEAVEN-GeoIntel: for authorized use only. Verify before acting.");
  return out.join("\n");
}

export function reportToMarkdown(m: ReportModel): string {
  const out: string[] = [
    `# HEAVEN-GeoIntel: ${m.kind} report: ${m.subject}`,
    "",
    `- Generated: ${m.generatedAt}`,
    ...(m.headline ? [`- ${m.headline.label}: ${m.headline.value}`] : []),
  ];
  for (const s of m.sections) {
    out.push("", `## ${s.heading}`);
    if (s.rows?.length) {
      out.push("", "| Field | Value |", "| --- | --- |");
      for (const r of s.rows) out.push(`| ${r.label} | ${mdCell(r.value)} |`);
    }
    for (const item of s.list ?? []) out.push(`- ${mdCell(item)}`);
  }
  if (m.sources.length) {
    out.push("", "## Data sources");
    for (const s of m.sources) out.push(`- ${s.ok ? "✅" : "❌"} ${s.source}${s.ms != null ? ` (${s.ms}ms)` : ""}`);
  }
  return out.join("\n");
}

// Escape the backslash FIRST, then the pipe. Escaping only the pipe would turn
// an input backslash-pipe into "\\|", where the doubled backslash is itself an
// escaped backslash and the pipe reopens as a live table delimiter.
const mdCell = (s: string) => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function reportToHtml(m: ReportModel): string {
  const body: string[] = [`<h1>${esc(m.subject)}</h1>`, `<p class="meta">${esc(m.kind)} report · ${esc(m.generatedAt)}${m.headline ? ` · ${esc(m.headline.label)}: ${esc(m.headline.value)}` : ""}</p>`];
  for (const s of m.sections) {
    body.push(`<h2>${esc(s.heading)}</h2>`);
    if (s.rows?.length) {
      body.push("<table>", ...s.rows.map((r) => `<tr><th>${esc(r.label)}</th><td>${esc(r.value)}</td></tr>`), "</table>");
    }
    if (s.list?.length) body.push("<ul>", ...s.list.map((i) => `<li>${esc(i)}</li>`), "</ul>");
  }
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>HEAVEN-GeoIntel Report: ${esc(m.subject)}</title>
<style>
  body { font-family: ui-monospace, Menlo, Consolas, monospace; max-width: 900px; margin: 0 auto; padding: 32px 24px; color: #10151f; background: #fff; }
  h1 { font-size: 20px; letter-spacing: .04em; margin: 0 0 4px; }
  .meta { color: #556; font-size: 12px; margin: 0 0 20px; text-transform: uppercase; letter-spacing: .12em; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .14em; color: #0a7; border-bottom: 1px solid #cde; padding-bottom: 4px; margin: 24px 0 8px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th { text-align: left; width: 200px; color: #556; font-weight: 600; padding: 3px 8px 3px 0; vertical-align: top; }
  td { padding: 3px 0; word-break: break-word; }
  ul { font-size: 13px; margin: 4px 0; padding-left: 20px; } li { margin: 2px 0; word-break: break-word; }
  @page { margin: 14mm; }
</style></head><body>
${body.join("\n")}
<footer style="margin-top:32px;color:#889;font-size:11px">Generated by HEAVEN-GeoIntel: for authorized use only. Verify before acting.</footer>
</body></html>`;
}

/** Deterministic UUID-shaped id from a seed, so the same subject yields stable ids. */
export function detUuid(seed: string): string {
  let h = 5381 >>> 0;
  for (let i = 0; i < seed.length; i++) h = (((h << 5) + h) + seed.charCodeAt(i)) >>> 0;
  let x = h;
  let s = "";
  for (let i = 0; i < 32; i++) { x = (x * 1103515245 + 12345) >>> 0; s += ((x >>> 8) & 0xf).toString(16); }
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-8${s.slice(17, 20)}-${s.slice(20, 32)}`;
}

/** STIX 2.1 bundle: an identity, the observables as SCOs, and a report SDO. */
export function reportToStixBundle(m: ReportModel): Record<string, unknown> {
  const created = m.generatedAt;
  const identityId = `identity--${detUuid("HEAVEN-GeoIntel")}`;
  const scos = m.observables.map((o) => ({
    type: o.type,
    spec_version: "2.1",
    id: `${o.type}--${detUuid(`${o.type}:${o.value}`)}`,
    ...(o.type === "user-account" ? { account_login: o.value } : { value: o.value }),
  }));
  const report = {
    type: "report", spec_version: "2.1",
    id: `report--${detUuid(`${m.kind}:${m.subject}`)}`,
    created, modified: created, name: `HEAVEN-GeoIntel ${m.kind} report: ${m.subject}`,
    published: created, report_types: ["osint"],
    created_by_ref: identityId,
    object_refs: scos.map((s) => s.id),
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
