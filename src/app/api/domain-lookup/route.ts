import { NextRequest, NextResponse } from "next/server";
import { guardRateLimit } from "@/lib/server/rateLimit";
import { timedValue } from "@/lib/server/sourceHealth";
import { audit } from "@/lib/server/auditLog";
import { fetchJson } from "@/lib/server/fetchSafe";
import { parseBody, domainBody } from "@/lib/server/validation";
import type {
  DomainLookupResponse, DnsRecord, DomainWhois,
} from "@/lib/types";

// ── Domain OSINT — all free, no API key ──────────────────────────────────────
//   DNS records  : Cloudflare DNS-over-HTTPS (application/dns-json)
//   WHOIS        : RDAP (rdap.org) — structured, free, no key
//   Subdomains   : Certspotter certificate-transparency issuances (fast, no key)
//   Email posture: SPF (TXT) + DMARC (_dmarc TXT) parsing

const DOMAIN_RE = /^(?!-)[a-zA-Z0-9-]{1,63}(?<!-)(\.[a-zA-Z0-9-]{1,63})+$/;

const DOH = "https://cloudflare-dns.com/dns-query";

async function doh(name: string, type: string): Promise<DnsRecord[]> {
  try {
    const res = await fetch(`${DOH}?name=${encodeURIComponent(name)}&type=${type}`, {
      headers: { Accept: "application/dns-json" },
      signal: AbortSignal.timeout(6000), next: { revalidate: 0 },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { Answer?: { name: string; type: number; TTL: number; data: string }[] };
    if (!json.Answer) return [];
    return json.Answer.map((a) => {
      // MX data is "10 mail.example.com." — split priority
      if (type === "MX") {
        const [prio, ...host] = a.data.split(" ");
        return { type, value: host.join(" ").replace(/\.$/, ""), ttl: a.TTL, priority: parseInt(prio, 10) || undefined };
      }
      return { type, value: a.data.replace(/^"|"$/g, "").replace(/\.$/, ""), ttl: a.TTL };
    });
  } catch {
    return [];
  }
}

async function fetchWhois(domain: string): Promise<DomainWhois | null> {
  try {
    const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      headers: { Accept: "application/rdap+json" },
      signal: AbortSignal.timeout(7000), next: { revalidate: 0 },
    });
    if (!res.ok) return null;
    type RdapEvent = { eventAction: string; eventDate: string };
    type RdapEntity = { roles?: string[]; vcardArray?: unknown; handle?: string };
    type Rdap = {
      events?: RdapEvent[];
      entities?: RdapEntity[];
      nameservers?: { ldhName?: string }[];
      status?: string[];
    };
    const r = (await res.json()) as Rdap;

    const eventDate = (action: string) =>
      r.events?.find((e) => e.eventAction === action)?.eventDate ?? null;

    // Registrar is the entity whose role includes "registrar"
    let registrar: string | null = null;
    let registrantOrg: string | null = null;
    const registrantCountry: string | null = null;
    for (const ent of r.entities ?? []) {
      const roles = ent.roles ?? [];
      const vcard = Array.isArray(ent.vcardArray) ? (ent.vcardArray[1] as unknown[]) : null;
      const fn = Array.isArray(vcard)
        ? (vcard.find((f) => Array.isArray(f) && (f as unknown[])[0] === "fn") as unknown[] | undefined)
        : undefined;
      const name = fn && Array.isArray(fn) ? String(fn[3] ?? "") : "";
      if (roles.includes("registrar") && !registrar) registrar = name || ent.handle || null;
      if (roles.includes("registrant")) {
        if (!registrantOrg && name) registrantOrg = name;
      }
    }

    return {
      registrar,
      createdDate: eventDate("registration"),
      updatedDate: eventDate("last changed") ?? eventDate("last update of RDAP database"),
      expiresDate: eventDate("expiration"),
      nameservers: (r.nameservers ?? []).map((n) => (n.ldhName ?? "").toLowerCase()).filter(Boolean),
      statuses: r.status ?? [],
      registrantOrg,
      registrantCountry,
    };
  } catch {
    return null;
  }
}

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
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(7000), next: { revalidate: 0 } },
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
    const res = await fetch(`https://crt.sh/?q=${encodeURIComponent("%." + domain)}&output=json`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(budgetMs),
      next: { revalidate: 0 },
    });
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
  ];
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rl = guardRateLimit(req);
  if (rl.limited) return rl.limited;
  const rlHeaders = rl.headers;
  const client = rl.client;

  const body = await parseBody(req, domainBody);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  // Accept bare domains or full URLs; strip scheme/path/port.
  let domain = body.domain.trim().toLowerCase();
  domain = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:.*$/, "").replace(/^www\./, "");
  if (!domain) return NextResponse.json({ error: "Missing domain" }, { status: 400 });
  if (!DOMAIN_RE.test(domain)) return NextResponse.json({ error: "Not a valid domain name" }, { status: 400 });
  void audit("domain", domain, client, 200);

  // Three logical upstreams (DoH, RDAP, Certspotter) plus the Wayback probe.
  // Each is timed independently so the response reports which one was slow —
  // this fanout is the tool's longest, and "which source cost the 6 seconds?"
  // was previously unanswerable.
  const dnsJob = timedValue(
    "dns",
    Promise.all([
      doh(domain, "A"),
      doh(domain, "AAAA"),
      doh(domain, "MX"),
      doh(domain, "TXT"),
      doh(domain, "NS"),
      doh(domain, "CNAME"),
      doh(`_dmarc.${domain}`, "TXT"),
      doh(domain, "DNSKEY"),
    ]),
    (recs) => recs.some((r) => r.length > 0)
  );
  const whoisJob = timedValue("whois", fetchWhois(domain), (w) => w !== null);
  const subdomainJob = timedValue("subdomains", fetchSubdomains(domain), () => true);
  const waybackJob = timedValue("wayback", fetchWayback(domain), (w) => w !== null);

  const [dnsOut, whoisOut, subdomainOut, waybackOut] = await Promise.all([
    dnsJob, whoisJob, subdomainJob, waybackJob,
  ]);
  const [a, aaaa, mx, txt, ns, cname, dmarcTxt, dnskey] = dnsOut.value;
  const whois = whoisOut.value;
  const subdomains = subdomainOut.value;
  const wayback = waybackOut.value;
  const sourceHealth = [
    dnsOut.provenance, whoisOut.provenance, subdomainOut.provenance, waybackOut.provenance,
  ];
  const dnssec = dnskey.length > 0;

  const spfRecord = txt.find((r) => r.value.toLowerCase().startsWith("v=spf1"))?.value ?? null;
  const dmarcRecord = dmarcTxt.find((r) => r.value.toLowerCase().startsWith("v=dmarc1"))?.value ?? null;
  const dmarcPolicy = dmarcRecord?.match(/\bp=([a-z]+)/i)?.[1]?.toLowerCase() ?? null;

  const response: DomainLookupResponse = {
    domain,
    isValid: true,
    dns: { a, aaaa, mx, txt, ns, cname },
    whois,
    subdomains,
    emailSecurity: {
      hasSpf: !!spfRecord,
      spf: spfRecord,
      hasDmarc: !!dmarcRecord,
      dmarcPolicy,
      hasMx: mx.length > 0,
    },
    dnssec,
    wayback,
    pivots: buildPivots(domain),
    sourceHealth,
  };

  return NextResponse.json(response, { headers: rlHeaders });
}
