import { NextRequest, NextResponse } from "next/server";
import { guardRateLimit } from "@/lib/server/rateLimit";
import { timedValue } from "@/lib/server/sourceHealth";
import { audit } from "@/lib/server/auditLog";
import { withUserAgent } from "@/lib/server/fetchSafe";
import { DOH_URL, dohFailure } from "@/lib/server/doh";
import { fetchWhois } from "@/lib/server/rdap";
import { isProbeTarget, probeHttp, followRedirects, readPrefix } from "@/lib/server/httpProbe";
import { breachesForDomain } from "@/lib/data/breachCatalog";
import { bodyProvesUnclaimed, classifyTakeover } from "@/lib/analysis/subdomainTakeover";
import { parseBody, domainBody } from "@/lib/server/validation";
import { toAsciiHost, toUnicodeHost, isIdnHost } from "@/lib/analysis/idn";
import { mapLimit } from "@/lib/server/concurrency";
import { fanoutConcurrency } from "@/lib/server/config";
import { fetchHostExposure, SHODAN_SOURCE, GREYNOISE_SOURCE } from "@/lib/server/hostExposure";
import { fetchPassiveDns, fetchReverseIp, PDNS_SOURCE, REVERSE_IP_SOURCE } from "@/lib/server/passiveDns";
import { fetchLei, GLEIF_SOURCE } from "@/lib/server/gleif";
import type {
  DomainLookupResponse, DnsRecord, DnsQueryKind, TakeoverCandidate,
  SubdomainCoverage, SubdomainHost, HostExposureRecord, SourceProvenance,
} from "@/lib/types";

// ── Domain OSINT — all free, no API key ──────────────────────────────────────
//   DNS records  : Cloudflare DNS-over-HTTPS (application/dns-json)
//   WHOIS        : RDAP — broker (rdap.org) then the IANA-bootstrapped registry
//   Subdomains   : Certspotter + crt.sh certificate transparency, plus reverse IP
//   Passive DNS  : Mnemonic PDNS — what the name used to resolve to
//   Host exposure: Shodan InternetDB + GreyNoise on the apex's own addresses
//   Corporate    : GLEIF LEI register, keyed off the registrant org or OV cert
//   Email posture: SPF (TXT) + DMARC (_dmarc TXT) parsing
//   HTTP + TLS   : the target itself — security headers, tech stack, certificate

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
/** Record-type codes for every type DNS_QUERIES and the takeover scan ask for. */
const DNS_TYPE_NUMBERS: Record<string, number> = {
  A: 1, NS: 2, CNAME: 5, MX: 15, TXT: 16, AAAA: 28, DNSKEY: 48,
};

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
    // An answer section carries the whole resolution chain, not just the record
    // type asked for: query A on a CNAME'd host and the CNAME comes back in the
    // same array. Labelling every answer with the REQUESTED type turned those
    // into A records holding a hostname — which is how the takeover verifier
    // came to treat "github.github.io" as an IP address and gave up on every
    // candidate. Keep only the answers that really are the type requested.
    return json.Answer.filter((a) => a.type === DNS_TYPE_NUMBERS[type]).map((a) => {
      // MX data is "10 mail.example.com." — split priority
      if (type === "MX") {
        const [prio, ...host] = a.data.split(" ");
        const exchange = host.join(" ");
        // `Number`, not `parseInt`: the rdata's preference is a bare integer, and
        // this keeps the index access branch-free where `parseInt(prio ?? "")`
        // would add one that nothing can reach (split always yields index 0).
        const preference = Number(prio);
        return {
          type,
          // RFC 7505: one MX of preference 0 whose exchange is the root label
          // means "this domain accepts no mail". Stripping the trailing dot the
          // way every other record type needs left it as an empty string, so the
          // panel drew a blank row, the report dropped the field entirely, and
          // `hasMx` below counted it as a mail server. Kept as the wire form.
          value: exchange === "." ? "." : exchange.replace(/\.$/, ""),
          ttl: a.TTL,
          // A preference of 0 is ordinary, and mandatory for a null MX. The old
          // `|| undefined` threw it away, because 0 is falsy.
          ...(Number.isInteger(preference) ? { priority: preference } : {}),
        };
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
//
// Hard ceiling on the crt.sh query. crt.sh is a public Postgres front end and
// routinely takes 6-20 s on a busy domain; the whole domain fanout used to
// inherit that via an 8 s timeout (measured 8.16 s worst case for example.com).
const CRTSH_BUDGET_MS = 2500;
/** Cap on the reported subdomain list. Raised from 100: see fetchCtSubdomains. */
const SUBDOMAIN_LIMIT = 250;
/** How many discovered hosts get their A records resolved (bounded fanout). */
const SUBDOMAIN_RESOLVE_LIMIT = 40;
/** Apex addresses enriched with Shodan/GreyNoise. Three covers a round-robin A set. */
const APEX_EXPOSURE_LIMIT = 3;
/** Cap on the co-hosted hostname list reported for the apex's own address. */
const REVERSE_IP_LIMIT = 200;

function collectCtHosts(names: string[], domain: string, into: Set<string>): void {
  for (const n of names) {
    const host = n.trim().toLowerCase().replace(/^\*\./, "");
    if (host.endsWith(domain) && host !== domain) into.add(host);
  }
}

// Certspotter's free issuances API — fast, keyless, but only the ~100 most-recent
// issuances, so a busy domain comes back with a recent slice rather than its
// history.
async function certspotterHosts(domain: string): Promise<Set<string> | null> {
  const into = new Set<string>();
  try {
    const res = await fetch(
      `https://api.certspotter.com/v1/issuances?domain=${encodeURIComponent(domain)}&include_subdomains=true&expand=dns_names`,
      withUserAgent({ headers: { Accept: "application/json" }, signal: AbortSignal.timeout(7000), next: { revalidate: 0 } }),
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as { dns_names?: string[] }[];
    for (const row of rows) collectCtHosts(row.dns_names ?? [], domain, into);
    return into;
  } catch {
    return null; // a failure contributes nothing, and says so
  }
}

// crt.sh — the complete CT history, but slow (can exceed 25 s on busy domains),
// so it runs on a short budget and in parallel with Certspotter.
async function crtShHosts(domain: string, budgetMs: number): Promise<Set<string> | null> {
  const into = new Set<string>();
  try {
    const res = await fetch(`https://crt.sh/?q=${encodeURIComponent("%." + domain)}&output=json`, withUserAgent({
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(budgetMs),
      next: { revalidate: 0 },
    }));
    if (!res.ok) return null;
    const rows = (await res.json()) as { name_value?: string }[];
    for (const row of rows) collectCtHosts((row.name_value ?? "").split("\n"), domain, into);
    return into;
  } catch {
    return null;
  }
}

/**
 * Both CT sources, concurrently, and then say what each one contributed.
 *
 * This used to consult crt.sh only when Certspotter returned fewer than five
 * hosts, on the reasoning that one fast source is usually enough and crt.sh is a
 * free service worth sparing. Measured on wordpress.org, that cost real coverage:
 * Certspotter's recent-issuance window returned 9 hosts, so the threshold was
 * never crossed, while crt.sh held 25. The tool reported 9 as though that were
 * the answer.
 *
 * Under-reporting silently is the worse failure. Both sources now run on every
 * lookup — in parallel, so the wall time is the slower of the two rather than
 * their sum, and crt.sh keeps its 2.5 s budget so a slow day there costs the
 * lookup nothing. The response carries per-source counts, so a sparse list can
 * be read as "this is what CT holds" rather than guessed at.
 */
async function fetchCtSubdomains(domain: string): Promise<{ hosts: Set<string>; sources: SubdomainCoverage["sources"] }> {
  const [cs, crt] = await Promise.all([
    certspotterHosts(domain),
    crtShHosts(domain, CRTSH_BUDGET_MS),
  ]);
  const hosts = new Set<string>([...(cs ?? []), ...(crt ?? [])]);
  return {
    hosts,
    sources: [
      { source: "Certspotter", ok: cs !== null, found: cs?.size ?? 0 },
      { source: "crt.sh", ok: crt !== null, found: crt?.size ?? 0 },
    ],
  };
}

// Internet Archive: oldest capture. Anchoring the query to 1996 — the archive's
// own start — makes the archive resolve to the oldest snapshot on record.
//
// This used to call the `available` JSON endpoint and treat anything short of a
// snapshot as "never archived". Measured on 2026-09-12, that endpoint answered
// HTTP 429 to most requests and, when it did answer 200, returned an empty
// `archived_snapshots` for github.com and example.com — both archived thousands
// of times over. Every one of those became a stated fact that the domain had no
// history at all.
//
// The replay endpoint is the honest and faster source. Asked for a 1996
// timestamp it 302s to the canonical URL of the closest capture, with the exact
// timestamp in the Location header (0.5-1.6s in the same measurement, against
// 5.7-25s+ for the CDX index), and answers a clean 404 when there is genuinely
// nothing. Only that 404 may be reported as "never archived"; a rate-limit, a
// server error or a timeout leaves `wayback` null, which the UI renders as not
// checked rather than as an absence of history.
const WAYBACK_REPLAY = "https://web.archive.org/web/19960101000000/";
/** The 14-digit capture stamp inside a replay URL: /web/YYYYMMDDhhmmss/… */
const WAYBACK_STAMP = /\/web\/(\d{4})(\d{2})(\d{2})\d{6}\//;

async function fetchWayback(domain: string): Promise<DomainLookupResponse["wayback"]> {
  try {
    const res = await fetch(`${WAYBACK_REPLAY}${encodeURIComponent(domain)}`, withUserAgent({
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
      next: { revalidate: 0 },
    }));
    // Nothing here needs the body, and on a 404 it is a full HTML error page.
    void res.body?.cancel().catch(() => {});

    if (res.status === 404) return { available: false, firstSnapshot: null, snapshotUrl: null };

    const location = res.headers.get("location") ?? "";
    const m = WAYBACK_STAMP.exec(location);
    if (!m) return null; // 429, 5xx, or a redirect shape we do not recognise
    return {
      available: true,
      firstSnapshot: `${m[1]}-${m[2]}-${m[3]}`,
      snapshotUrl: location.replace(/^http:/, "https:"),
    };
  } catch {
    return null; // timeout / network — unknown, never "never archived"
  }
}

// Subdomain-takeover scan. Resolves the CNAME of each discovered subdomain
// (bounded) and matches the target against known takeover-prone services. The
// apex's own CNAMEs are already resolved, so they are classified for free. DoH
// is used, which is effectively unmetered — unlike the quota'd OSINT APIs — so a
// bounded fanout here is safe. Every hit is a CANDIDATE to verify, not a claim.
const TAKEOVER_SCAN_LIMIT = 24;
/** Body bytes read per verification probe — the marker is always near the top. */
const TAKEOVER_BODY_LIMIT = 8192;
const TAKEOVER_PROBE_TIMEOUT = 5000;

/**
 * Ask the subdomain itself whether anything is bound to it.
 *
 * A service match alone was producing pure noise: sweeping github.com on
 * 2026-09-12 matched twelve hosts, and every one served real content — seven
 * live GitHub Pages sites, an Azure app answering "Nothing to see here", a
 * Fastly-fronted bucket returning AccessDenied. None was takeable. So the
 * fingerprint the panel used to ask the analyst to check by hand is now checked
 * here, and only a host that actually serves it is reported.
 *
 * A host that answers nothing at all stays in the list as `unverified`: an
 * unresolvable CNAME target is itself part of the dangling pattern, and
 * dropping it would trade a false positive for a false negative.
 */
async function verifyTakeover(candidate: TakeoverCandidate): Promise<TakeoverCandidate> {
  // The CNAME target is attacker-influenced input, so the probe is held to the
  // same rules as the main HTTP probe: only globally-routable addresses, and
  // every redirect hop vetted before it is fetched. This used to follow
  // redirects blind, so a hostile subdomain could 302 the check straight at
  // 169.254.169.254. The body is read up to the limit and no further.
  const addresses = (await doh(candidate.name, "A")).map((r) => r.value);
  if (!isProbeTarget(addresses)) return { ...candidate, verification: "unverified" };
  const walked = await followRedirects(`https://${candidate.name}/`, { timeoutMs: TAKEOVER_PROBE_TIMEOUT });
  if (!walked) return { ...candidate, verification: "unverified" };
  const body = await readPrefix(walked.res, TAKEOVER_BODY_LIMIT);
  return { ...candidate, verification: bodyProvesUnclaimed(candidate, body) ? "unclaimed" : "claimed" };
}

async function findTakeovers(domain: string, apexCname: DnsRecord[], subdomains: string[]): Promise<TakeoverCandidate[]> {
  const out: TakeoverCandidate[] = [];
  const seen = new Set<string>();
  const add = (name: string, target: string) => {
    const sig = classifyTakeover(target);
    if (!sig) return;
    const key = `${name}|${sig.host}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name, ...sig, verification: "unverified" });
  };
  for (const r of apexCname) add(domain, r.value);
  const resolved = await mapLimit(
    subdomains.slice(0, TAKEOVER_SCAN_LIMIT),
    fanoutConcurrency(),
    async (name) => ({ name, recs: await doh(name, "CNAME") }),
  );
  for (const { name, recs } of resolved) for (const r of recs) add(name, r.value);

  // A claimed resource is not a lead, so it never reaches the response.
  const verified = await mapLimit(out, fanoutConcurrency(), verifyTakeover);
  return verified.filter((c) => c.verification !== "claimed");
}

/**
 * A records for the hosts CT just handed us.
 *
 * Domain mode used to discover subdomains and then ignore them: a list of names
 * with no addresses cannot tell an analyst which of them are live, which share a
 * host, or which point somewhere unexpected. DoH is effectively unmetered, so
 * this is a bounded fanout over the first SUBDOMAIN_RESOLVE_LIMIT names, run
 * through the same concurrency cap as everything else.
 *
 * `addresses: []` means the name resolved to nothing — a stale CT entry, which
 * is itself worth seeing. A name whose query got no answer is omitted rather
 * than reported as empty.
 */
async function resolveSubdomainHosts(hosts: string[]): Promise<SubdomainHost[]> {
  const resolved = await mapLimit(
    hosts.slice(0, SUBDOMAIN_RESOLVE_LIMIT),
    fanoutConcurrency(),
    async (host): Promise<SubdomainHost | null> => {
      const recs = await dohQuery(host, "A");
      if (recs === null) return null;
      return { host, addresses: recs.map((r) => r.value) };
    },
  );
  return resolved.filter((r): r is SubdomainHost => r !== null);
}

/**
 * Shodan + GreyNoise for the addresses the apex resolves to.
 *
 * The tool already knew how to ask "what is exposed on this host?" — it just
 * never asked it about the host it had resolved thirty lines earlier, so a
 * domain lookup could not tell you that its own web server has an open Redis
 * port. Bounded to APEX_EXPOSURE_LIMIT addresses so a round-robin A set cannot
 * turn one lookup into a dozen upstream calls.
 */
async function enrichApexAddresses(
  addresses: string[],
): Promise<{ records: HostExposureRecord[]; provenance: SourceProvenance[] }> {
  const targets = addresses.slice(0, APEX_EXPOSURE_LIMIT);
  if (targets.length === 0) {
    // Nothing to ask about. Reported as skipped rather than omitted, so the
    // response and the exported report both say "not applicable" instead of
    // leaving a source the manifest promises silently absent.
    const skipped = (source: string): SourceProvenance => ({
      source, ok: false, ms: 0, fetchedAt: Date.now(), skipped: true, error: "NO_INPUT",
    });
    return { records: [], provenance: [skipped(SHODAN_SOURCE), skipped(GREYNOISE_SOURCE)] };
  }
  const out = await mapLimit(targets, fanoutConcurrency(), async (ip) => {
    const { exposure, provenance } = await fetchHostExposure(ip);
    return { record: { ip, ...exposure }, provenance };
  });
  return {
    records: out.map((o) => o.record),
    // One row per source per address would fill the strip with duplicates, so
    // only the first address's provenance is reported — the sources are the
    // same for every address in the batch.
    /* v8 ignore next -- `targets` is non-empty here, so mapLimit always yields
       at least one result; the fallback keeps a future refactor honest. */
    provenance: out[0]?.provenance ?? [],
  };
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

  const parsed = await parseBody(req, domainBody);
  if (!parsed.ok) return NextResponse.json(parsed.problem, { status: parsed.status ?? 400, headers: rlHeaders });
  const body = parsed.data;

  // Accept bare domains, full URLs, punycode and Unicode/IDN names alike.
  // `toAsciiHost` strips the scheme, path, port and root dot and applies the
  // platform's UTS-46 conversion, so `münchen.de` and `wordpress.org.` are both
  // looked up instead of being rejected as invalid by an ASCII-only regex.
  const ascii = toAsciiHost(body.domain);
  if (!ascii) {
    return NextResponse.json({ error: "Not a valid domain name", field: "domain" }, { status: 400, headers: rlHeaders });
  }
  const domain = ascii.replace(/^www\./, "");
  void audit("domain", domain, client, 200);

  // Nine logical jobs: DoH, RDAP, the HTTP/TLS probe, certificate transparency
  // (Certspotter and crt.sh together), Wayback, passive DNS, reverse IP, host
  // exposure on the resolved addresses, and the LEI lookup. Each is timed
  // independently so the response reports which one was slow — this fanout is
  // the tool's longest, and "which source cost the 6 seconds?" was previously
  // unanswerable.
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
  const ctJob = timedValue(
    "subdomains",
    fetchCtSubdomains(domain),
    (r) => r.sources.some((s) => s.ok),
    (r) => `no answer from ${r.sources.filter((s) => !s.ok).map((s) => s.source).join(", ")}`,
  );
  const waybackJob = timedValue("wayback", fetchWayback(domain), (w) => w !== null);
  const pdnsJob = fetchPassiveDns(domain);

  // Reverse IP runs against the apex's first A record, so it chains off the DNS
  // fanout. Two findings come out of it: hostnames under this domain that CT
  // never issued a certificate for, and third-party names sharing the address.
  const reverseJob: Promise<{ ip: string | null; hosts: string[] | null; provenance: SourceProvenance }> =
    dnsJob.then(({ value: [a4] }) => {
      const first = a4?.[0]?.value;
      if (!first) {
        return {
          ip: null,
          hosts: null,
          provenance: {
            source: REVERSE_IP_SOURCE, ok: false, ms: 0, fetchedAt: Date.now(),
            skipped: true, error: "NO_INPUT",
          },
        };
      }
      return fetchReverseIp(first).then((r) => ({ ip: first, hosts: r.hosts, provenance: r.provenance }));
    });

  // Exposure for the apex's own addresses, chained off the same DNS fanout.
  const exposureJob = dnsJob.then(({ value: [a4, a6] }) =>
    enrichApexAddresses([...(a4 ?? []), ...(a6 ?? [])].map((r) => r.value)),
  );

  // The legal-entity lookup needs an organisation name, and there are two places
  // to get one: the RDAP registrant org, and the organisation a CA verified when
  // it issued an OV/EV certificate. The second matters because post-GDPR RDAP
  // redacts the first for most gTLDs — paypal.com publishes no registrant org
  // but its certificate says "PayPal, Inc." Nothing to query is reported as
  // skipped, never as "no company exists".
  const leiJob = Promise.all([whoisJob, httpJob]).then(([{ value: w }, { value: h }]) => {
    const registrant = w?.registrantOrg?.trim();
    const org = registrant || (h?.tls?.subjectOrg ?? "").trim();
    return org
      ? fetchLei(org, registrant ? "registrant" : "certificate")
      : Promise.resolve({
          outcome: null,
          provenance: {
            source: GLEIF_SOURCE, ok: false, ms: 0, fetchedAt: Date.now(),
            skipped: true, error: "NO_INPUT",
          } satisfies SourceProvenance,
        });
  });

  const [dnsOut, whoisOut, ctOut, waybackOut, httpOut, pdnsOut, reverseOut, exposureOut, leiOut] =
    await Promise.all([
      dnsJob, whoisJob, ctJob, waybackJob, httpJob, pdnsJob, reverseJob, exposureJob, leiJob,
    ]);

  const [a, aaaa, mx, txt, ns, cname, dmarcTxt, dnskey] = dnsOut.value;
  const whois = whoisOut.value;
  const wayback = waybackOut.value;

  // Merge every subdomain source. Reverse IP contributes the names under this
  // apex that share its address; the rest of what it found is reported
  // separately as co-hosting, because a third-party domain on the same server is
  // a different finding from a subdomain of this one.
  const apexSuffix = `.${domain}`;
  const reverseUnderApex = (reverseOut.hosts ?? []).filter((h) => h.endsWith(apexSuffix));
  // Passive DNS answers for the apex AND for names beneath it, so it is a third
  // subdomain source for free: on wordpress.org, 194 of 200 returned rows were
  // for a subdomain rather than the apex.
  const pdnsUnderApex = [
    ...new Set(
      (pdnsOut.result?.records ?? [])
        .map((r) => r.query.toLowerCase())
        .filter((h) => h.endsWith(apexSuffix)),
    ),
  ];
  const allHosts = new Set<string>([...ctOut.value.hosts, ...reverseUnderApex, ...pdnsUnderApex]);
  const subdomains = [...allHosts].sort().slice(0, SUBDOMAIN_LIMIT);
  const coverage: SubdomainCoverage = {
    sources: [
      ...ctOut.value.sources,
      { source: REVERSE_IP_SOURCE, ok: reverseOut.hosts !== null, found: reverseUnderApex.length },
      { source: PDNS_SOURCE, ok: pdnsOut.result !== null, found: pdnsUnderApex.length },
    ],
    distinct: allHosts.size,
    limit: SUBDOMAIN_LIMIT,
    capped: allHosts.size > SUBDOMAIN_LIMIT,
  };

  // Resolution and the takeover scan both run over the merged list, so a host
  // that only reverse IP knew about is scanned like any other.
  const [subdomainHosts, takeoverCandidates] = await Promise.all([
    resolveSubdomainHosts(subdomains),
    findTakeovers(domain, cname ?? [], subdomains),
  ]);

  const sourceHealth = [
    dnsOut.provenance, whoisOut.provenance, ctOut.provenance, waybackOut.provenance,
    httpOut.provenance, pdnsOut.provenance, reverseOut.provenance,
    ...exposureOut.provenance, leiOut.provenance,
  ];
  // Every posture flag below is null when its query got no answer: unknown,
  // never "missing".
  const dnssec = dnskey === null ? null : dnskey.length > 0;

  const spfRecord = txt?.find((r) => r.value.toLowerCase().startsWith("v=spf1"))?.value ?? null;
  const dmarcRecord = dmarcTxt?.find((r) => r.value.toLowerCase().startsWith("v=dmarc1"))?.value ?? null;
  const dmarcPolicy = dmarcRecord?.match(/\bp=([a-z]+)/i)?.[1]?.toLowerCase() ?? null;
  // RFC 7505 requires the null MX to be the ONLY MX record, so a set that also
  // names a real exchanger is a misconfiguration and mail still lands: only the
  // single-record form is read as a refusal.
  const nullMx = mx !== null && mx.length === 1 && mx[0]?.value === "." && mx[0]?.priority === 0;

  const response: DomainLookupResponse = {
    domain,
    // Only set for an internationalised name, so the panel shows the readable
    // spelling next to the one DNS was actually asked about.
    domainUnicode: isIdnHost(domain) ? toUnicodeHost(domain) : undefined,
    isValid: true,
    dns: { a: a ?? [], aaaa: aaaa ?? [], mx: mx ?? [], txt: txt ?? [], ns: ns ?? [], cname: cname ?? [] },
    whois,
    subdomains,
    subdomainCoverage: coverage,
    subdomainHosts,
    passiveDns: pdnsOut.result,
    hostExposure: exposureOut.records,
    lei: leiOut.outcome,
    reverseIp: reverseOut.ip && reverseOut.hosts
      ? { ip: reverseOut.ip, hosts: reverseOut.hosts.slice(0, REVERSE_IP_LIMIT), total: reverseOut.hosts.length }
      : null,
    emailSecurity: {
      hasSpf: txt === null ? null : spfRecord !== null,
      spf: spfRecord,
      hasDmarc: dmarcTxt === null ? null : dmarcRecord !== null,
      dmarcPolicy,
      hasMx: mx === null ? null : mx.length > 0 && !nullMx,
      nullMx: mx === null ? null : nullMx,
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
