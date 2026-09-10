import { NextRequest, NextResponse } from "next/server";
import { guardRateLimit } from "@/lib/server/rateLimit";
import { timedValue } from "@/lib/server/sourceHealth";
import { audit } from "@/lib/server/auditLog";
import { fetchJson, withUserAgent } from "@/lib/server/fetchSafe";
import { DOH_URL, dohFailure } from "@/lib/server/doh";
import { fetchWhois } from "@/lib/server/rdap";
import { probeHttp } from "@/lib/server/httpProbe";
import { breachesForDomain } from "@/lib/data/breachCatalog";
import { classifyTakeover } from "@/lib/analysis/subdomainTakeover";
import { parseBody, domainBody } from "@/lib/server/validation";
import type {
  DomainLookupResponse, DnsRecord, DnsQueryKind, TakeoverCandidate,
} from "@/lib/types";

// ── Domain OSINT — all free, no API key ──────────────────────────────────────
//   DNS records  : Cloudflare DNS-over-HTTPS (application/dns-json)
//   WHOIS        : RDAP — broker (rdap.org) then the IANA-bootstrapped registry
//   Subdomains   : Certspotter certificate-transparency issuances (fast, no key)
//   Email posture: SPF (TXT) + DMARC (_dmarc TXT) parsing
//   HTTP + TLS   : the target itself — security headers, tech stack, certificate

const DOMAIN_RE = /^(?!-)[a-zA-Z0-9-]{1,63}(?<!-)(\.[a-zA-Z0-9-]{1,63})+$/;

/**
 * Reassemble a DNS-over-HTTPS TXT value.
 *
 * A single TXT record holds one or more character-strings, each capped at 255
 * bytes (RFC 1035 §3.3.14), and the wire format is their concatenation. DoH
 * renders that as several quoted runs: `"first 255 chars" "the rest"`. Anything
 * longer than 255 bytes — which is most real SPF records, and every long
 * verification token — arrives split.
 *
 * Stripping only the outer quotes left the internal `" "` embedded mid-value,
 * so github.com's SPF rendered `ip4:62.253.2" "27.114` for what is really
 * `ip4:62.253.227.114`. That is not a cosmetic bug: an analyst copying a
 * netblock out of the panel got an address that does not exist, and any SPF
 * parsing downstream saw a malformed mechanism.
 *
 * A value with no quoted runs at all is passed through unchanged, so a
 * resolver that returns a bare string still works.
 */
export function joinTxtChunks(data: string): string {
  const chunks = data.match(/"(?:[^"\\]|\\.)*"/g);
  if (!chunks) return data;
  return chunks.map((c) => c.slice(1, -1).replace(/\\(.)/g, "$1")).join("");
}

/**
 * One DoH query. Returns the records (an empty array when the name definitively
 * has none, NXDOMAIN included) or null when there was no answer: a timeout, a
 * network error, a non-2xx, or a failed RCODE such as SERVFAIL.
 *
 * The null is the point. This used to return [] for all of those, so one
 * timed-out TXT query rendered "No SPF: spoofable" on a real domain, fired the
 * AI spoofing anomaly, printed "missing" in the report and stored it in the
 * case snapshot, where the next re-run reported a change that never happened.
 */
async function dohQuery(name: string, type: string): Promise<DnsRecord[] | null> {
  try {
    const res = await fetch(`${DOH_URL}?name=${encodeURIComponent(name)}&type=${type}`, withUserAgent({
      headers: { Accept: "application/dns-json" },
      signal: AbortSignal.timeout(6000), next: { revalidate: 0 },
    }));
    if (!res.ok) return null;
    const json = (await res.json()) as { Status?: number; Answer?: { name: string; type: number; TTL: number; data: string }[] };
    if (dohFailure(json.Status)) return null;
    if (!json.Answer) return [];
    return json.Answer.map((a) => {
      // MX data is "10 mail.example.com." — split priority
      if (type === "MX") {
        const [prio, ...host] = a.data.split(" ");
        return { type, value: host.join(" ").replace(/\.$/, ""), ttl: a.TTL, priority: parseInt(prio, 10) || undefined };
      }
      // TXT is the multi-string case; the rest are single values whose only
      // quirk is the trailing root dot.
      if (type === "TXT") return { type, value: joinTxtChunks(a.data), ttl: a.TTL };
      return { type, value: a.data.replace(/^"|"$/g, "").replace(/\.$/, ""), ttl: a.TTL };
    });
  } catch {
    return null;
  }
}

/** For the takeover scan, where an unanswered CNAME simply yields no candidate. */
async function doh(name: string, type: string): Promise<DnsRecord[]> {
  return (await dohQuery(name, type)) ?? [];
}

/** The apex fanout, in the order the DNS job returns them. */
const DNS_QUERIES: { kind: DnsQueryKind; type: string; prefix?: string }[] = [
  { kind: "A", type: "A" },
  { kind: "AAAA", type: "AAAA" },
  { kind: "MX", type: "MX" },
  { kind: "TXT", type: "TXT" },
  { kind: "NS", type: "NS" },
  { kind: "CNAME", type: "CNAME" },
  { kind: "DMARC", type: "TXT", prefix: "_dmarc." },
  { kind: "DNSKEY", type: "DNSKEY" },
];

const unanswered = (recs: (DnsRecord[] | null)[]): DnsQueryKind[] =>
  DNS_QUERIES.filter((_, i) => recs[i] === null).map((q) => q.kind);

// Certificate-transparency subdomains. Keep only real hostnames under `domain`,
// stripping wildcards and dropping the apex itself.
const SUBDOMAIN_FALLBACK_THRESHOLD = 5;
// Hard ceiling on the crt.sh supplement. crt.sh is a public Postgres front end
// and routinely takes 6–20 s on a busy domain; the whole domain fanout used to
// inherit that via an 8 s timeout (measured 8.16 s worst case for example.com).
// Since crt.sh only ever ADDS to an already-usable Certspotter set, cutting it
// short costs at most some extra subdomains and is strictly better than an
// eight-second page.
const CRTSH_BUDGET_MS = 2500;

function collectCtHosts(names: string[], domain: string, into: Set<string>): void {
  for (const n of names) {
    const host = n.trim().toLowerCase().replace(/^\*\./, "");
    if (host.endsWith(domain) && host !== domain) into.add(host);
  }
}

// Certspotter's free issuances API — fast, keyless, but only the ~100 most-recent
// issuances, so a small/new domain can come back sparse.
async function certspotterHosts(domain: string, into: Set<string>): Promise<void> {
  try {
    const res = await fetch(
      `https://api.certspotter.com/v1/issuances?domain=${encodeURIComponent(domain)}&include_subdomains=true&expand=dns_names`,
      withUserAgent({ headers: { Accept: "application/json" }, signal: AbortSignal.timeout(7000), next: { revalidate: 0 } }),
    );
    if (!res.ok) return;
    const rows = (await res.json()) as { dns_names?: string[] }[];
    for (const row of rows) collectCtHosts(row.dns_names ?? [], domain, into);
  } catch {
    /* leave `into` untouched — a failure just contributes nothing */
  }
}

// crt.sh — complete CT history but slow (can exceed 25s on busy domains). Used
// only as a supplement when Certspotter is sparse; if it times out it simply adds
// nothing, leaving the Certspotter set intact.
async function crtShHosts(domain: string, into: Set<string>, budgetMs: number): Promise<void> {
  try {
    const res = await fetch(`https://crt.sh/?q=${encodeURIComponent("%." + domain)}&output=json`, withUserAgent({
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(budgetMs),
      next: { revalidate: 0 },
    }));
    if (!res.ok) return;
    const rows = (await res.json()) as { name_value?: string }[];
    for (const row of rows) collectCtHosts((row.name_value ?? "").split("\n"), domain, into);
  } catch {
    /* leave `into` untouched */
  }
}

/**
 * Certspotter first; crt.sh only when it came back sparse — and then on a short
 * budget.
 *
 * The 8.16 s worst case came from the SECOND call, not from the shape of the
 * fallback: crt.sh was given an 8 s timeout, and a slow crt.sh spent all of it.
 * Capping that at CRTSH_BUDGET_MS bounds the whole fanout at roughly
 * Certspotter + 2.5 s.
 *
 * I also tried firing both concurrently and aborting crt.sh once Certspotter
 * proved sufficient. That is faster on paper, but it sends a query to a free
 * public CT front end on EVERY domain lookup, and an abort only stops us
 * reading the response — crt.sh has already started the work. Staying
 * sequential keeps the common case at zero crt.sh requests, which is worth more
 * than the ~700 ms it costs when the fallback does run.
 */
async function fetchSubdomains(domain: string): Promise<string[]> {
  const hosts = new Set<string>();
  await certspotterHosts(domain, hosts);
  if (hosts.size < SUBDOMAIN_FALLBACK_THRESHOLD) await crtShHosts(domain, hosts, CRTSH_BUDGET_MS);
  return Array.from(hosts).sort().slice(0, 100);
}

// Internet Archive: oldest capture via the fast "available" endpoint (free, no
// key). Anchoring the query to 1996 — the archive's own start — makes "closest"
// resolve to the oldest snapshot on record. The CDX API returns the same first
// capture but routinely takes 15s+; this answers in well under a second.
function waybackTs(ts: string): string {
  const m = ts.match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : ts;
}
async function fetchWayback(domain: string): Promise<DomainLookupResponse["wayback"]> {
  const r = await fetchJson<{ archived_snapshots?: { closest?: { timestamp?: string; url?: string } } }>(
    `https://archive.org/wayback/available?url=${encodeURIComponent(domain)}&timestamp=19960101`,
    { source: "Wayback Machine", timeoutMs: 7000 },
  );
  if (!r.ok || !r.data) return r.status === 0 ? null : { available: false, firstSnapshot: null, snapshotUrl: null };
  const closest = r.data.archived_snapshots?.closest;
  if (!closest?.timestamp) return { available: false, firstSnapshot: null, snapshotUrl: null };
  return {
    available: true,
    firstSnapshot: waybackTs(closest.timestamp),
    snapshotUrl: (closest.url ?? `https://web.archive.org/web/${closest.timestamp}/${domain}`).replace(/^http:/, "https:"),
  };
}

// Subdomain-takeover scan. Resolves the CNAME of each discovered subdomain
// (bounded) and matches the target against known takeover-prone services. The
// apex's own CNAMEs are already resolved, so they are classified for free. DoH
// is used, which is effectively unmetered — unlike the quota'd OSINT APIs — so a
// bounded fanout here is safe. Every hit is a CANDIDATE to verify, not a claim.
const TAKEOVER_SCAN_LIMIT = 24;

async function findTakeovers(domain: string, apexCname: DnsRecord[], subdomains: string[]): Promise<TakeoverCandidate[]> {
  const out: TakeoverCandidate[] = [];
  const seen = new Set<string>();
  const add = (name: string, target: string) => {
    const sig = classifyTakeover(target);
    if (!sig) return;
    const key = `${name}|${sig.host}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name, ...sig });
  };
  for (const r of apexCname) add(domain, r.value);
  const resolved = await Promise.all(
    subdomains.slice(0, TAKEOVER_SCAN_LIMIT).map(async (name) => ({ name, recs: await doh(name, "CNAME") })),
  );
  for (const { name, recs } of resolved) for (const r of recs) add(name, r.value);
  return out;
}

function buildPivots(domain: string): DomainLookupResponse["pivots"] {
  const enc = encodeURIComponent(domain);
  return [
    { label: "crt.sh",         url: `https://crt.sh/?q=${enc}`,                                   note: "Full certificate-transparency history" },
    { label: "SecurityTrails", url: `https://securitytrails.com/domain/${enc}/dns`,               note: "Historical DNS + subdomains" },
    { label: "VirusTotal",     url: `https://www.virustotal.com/gui/domain/${enc}`,               note: "Reputation + passive DNS" },
    { label: "Shodan",         url: `https://www.shodan.io/search?query=hostname:${enc}`,         note: "Exposed services on the domain" },
    { label: "URLScan",        url: `https://urlscan.io/domain/${enc}`,                           note: "Page screenshots + request graph" },
    { label: "Wayback",        url: `https://web.archive.org/web/*/${enc}`,                       note: "Archived snapshots" },
    { label: "DNSDumpster",    url: `https://dnsdumpster.com/`,                                   note: "Free recon map (paste domain)" },
    { label: "MXToolbox",      url: `https://mxtoolbox.com/SuperTool.aspx?action=mx%3a${enc}`,    note: "MX / SPF / DMARC / blacklist" },
    { label: "SSL Labs",       url: `https://www.ssllabs.com/ssltest/analyze.html?d=${enc}`,      note: "Full TLS configuration grade" },
    { label: "Wappalyzer",     url: `https://www.wappalyzer.com/lookup/${enc}`,                   note: "Deeper technology profile" },
  ];
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rl = guardRateLimit(req);
  if (rl.limited) return rl.limited;
  const rlHeaders = rl.headers;
  const client = rl.client;

  const body = await parseBody(req, domainBody);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400, headers: rlHeaders });

  // Accept bare domains or full URLs; strip scheme/path/port.
  let domain = body.domain.trim().toLowerCase();
  domain = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:.*$/, "").replace(/^www\./, "");
  if (!domain) return NextResponse.json({ error: "Missing domain" }, { status: 400, headers: rlHeaders });
  if (!DOMAIN_RE.test(domain)) return NextResponse.json({ error: "Not a valid domain name" }, { status: 400, headers: rlHeaders });
  void audit("domain", domain, client, 200);

  // Three logical upstreams (DoH, RDAP, Certspotter) plus the Wayback probe.
  // Each is timed independently so the response reports which one was slow —
  // this fanout is the tool's longest, and "which source cost the 6 seconds?"
  // was previously unanswerable.
  //
  // The DNS source is healthy when every query got an answer. An NXDOMAIN is an
  // answer, so a domain that does not exist no longer reads as a DNS outage; a
  // query that timed out is named in the error instead of vanishing.
  const dnsJob = timedValue(
    "dns",
    Promise.all(DNS_QUERIES.map((q) => dohQuery(`${q.prefix ?? ""}${domain}`, q.type))),
    (recs) => recs.every((r) => r !== null),
    (recs) => `no answer for ${unanswered(recs).join(", ")}`,
  );
  const whoisJob = timedValue("whois", fetchWhois(domain), (w) => w !== null);
  // The only job that depends on another: the SSRF guard in probeHttp needs the
  // resolved addresses, and those come from the DNS fanout we are already
  // running. Chaining off dnsJob keeps that ordering explicit and still lets the
  // probe overlap WHOIS, subdomains and Wayback.
  const httpJob = timedValue(
    "http",
    dnsJob.then(({ value: [a4, a6] }) => probeHttp(domain, [...(a4 ?? []), ...(a6 ?? [])].map((r) => r.value))),
    (h) => h !== null,
  );
  const subdomainJob = timedValue("subdomains", fetchSubdomains(domain), () => true);
  const waybackJob = timedValue("wayback", fetchWayback(domain), (w) => w !== null);
  // Overlaps the other jobs: it needs the apex CNAMEs (dnsJob) and the subdomain
  // list (subdomainJob), and nothing else waits on it. Not source-health-tracked
  // because it reuses the DoH ("dns") source rather than a new upstream.
  const takeoverJob = Promise.all([dnsJob, subdomainJob]).then(
    ([d, s]) => findTakeovers(domain, d.value[5] ?? [], s.value),
  );

  const [dnsOut, whoisOut, subdomainOut, waybackOut, httpOut, takeoverCandidates] = await Promise.all([
    dnsJob, whoisJob, subdomainJob, waybackJob, httpJob, takeoverJob,
  ]);
  const [a, aaaa, mx, txt, ns, cname, dmarcTxt, dnskey] = dnsOut.value;
  const whois = whoisOut.value;
  const subdomains = subdomainOut.value;
  const wayback = waybackOut.value;
  const sourceHealth = [
    dnsOut.provenance, whoisOut.provenance, subdomainOut.provenance, waybackOut.provenance,
    httpOut.provenance,
  ];
  // Every posture flag below is null when its query got no answer: unknown,
  // never "missing".
  const dnssec = dnskey === null ? null : dnskey.length > 0;

  const spfRecord = txt?.find((r) => r.value.toLowerCase().startsWith("v=spf1"))?.value ?? null;
  const dmarcRecord = dmarcTxt?.find((r) => r.value.toLowerCase().startsWith("v=dmarc1"))?.value ?? null;
  const dmarcPolicy = dmarcRecord?.match(/\bp=([a-z]+)/i)?.[1]?.toLowerCase() ?? null;

  const response: DomainLookupResponse = {
    domain,
    isValid: true,
    dns: { a: a ?? [], aaaa: aaaa ?? [], mx: mx ?? [], txt: txt ?? [], ns: ns ?? [], cname: cname ?? [] },
    whois,
    subdomains,
    emailSecurity: {
      hasSpf: txt === null ? null : spfRecord !== null,
      spf: spfRecord,
      hasDmarc: dmarcTxt === null ? null : dmarcRecord !== null,
      dmarcPolicy,
      hasMx: mx === null ? null : mx.length > 0,
    },
    dnssec,
    dnsFailed: unanswered(dnsOut.value),
    wayback,
    http: httpOut.value,
    // Offline catalog lookup — no request, no key. Reports breaches publicly
    // recorded FOR this domain, not a claim about its current users.
    knownBreaches: breachesForDomain(domain),
    takeoverCandidates,
    pivots: buildPivots(domain),
    sourceHealth,
  };

  return NextResponse.json(response, { headers: rlHeaders });
}
