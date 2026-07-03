import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "@/lib/server/rateLimit";
import { audit } from "@/lib/server/auditLog";
import { fetchJson } from "@/lib/server/fetchSafe";
import { parseBody, domainBody } from "@/lib/server/validation";
import type {
  DomainLookupResponse, DnsRecord, DomainWhois,
} from "@/lib/types";

// ── Domain OSINT — all free, no API key ──────────────────────────────────────
//   DNS records  : Cloudflare DNS-over-HTTPS (application/dns-json)
//   WHOIS        : RDAP (rdap.org) — structured, free, no key
//   Subdomains   : crt.sh certificate-transparency JSON
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

async function fetchSubdomains(domain: string): Promise<string[]> {
  try {
    const res = await fetch(`https://crt.sh/?q=${encodeURIComponent("%." + domain)}&output=json`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000), next: { revalidate: 0 },
    });
    if (!res.ok) return [];
    const rows = (await res.json()) as { name_value?: string }[];
    const set = new Set<string>();
    for (const row of rows) {
      for (const n of (row.name_value ?? "").split("\n")) {
        const host = n.trim().toLowerCase().replace(/^\*\./, "");
        if (host.endsWith(domain) && host !== domain) set.add(host);
      }
    }
    return Array.from(set).sort().slice(0, 100);
  } catch {
    return [];
  }
}

// Internet Archive: oldest capture via the CDX API (free, no key).
function waybackTs(ts: string): string {
  const m = ts.match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : ts;
}
async function fetchWayback(domain: string): Promise<DomainLookupResponse["wayback"]> {
  const r = await fetchJson<string[][]>(
    `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(domain)}&output=json&fl=timestamp,original&limit=1`,
    { source: "Wayback Machine", timeoutMs: 9000 },
  );
  if (!r.ok || !Array.isArray(r.data)) return r.status === 0 ? null : { available: false, firstSnapshot: null, snapshotUrl: null };
  const rows = r.data.slice(1); // first row is the column header
  if (rows.length === 0 || !rows[0]?.[0]) return { available: false, firstSnapshot: null, snapshotUrl: null };
  const [ts, original] = rows[0];
  return {
    available: true,
    firstSnapshot: waybackTs(ts),
    snapshotUrl: `https://web.archive.org/web/${ts}/${original ?? domain}`,
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
  const ip = getClientIp(req);
  const { allowed, remaining } = checkRateLimit(ip);
  const rlHeaders = { "X-RateLimit-Limit": "10", "X-RateLimit-Remaining": String(remaining) };
  if (!allowed) {
    return NextResponse.json({ error: "Rate limit exceeded. Max 10/min." }, { status: 429, headers: { ...rlHeaders, "Retry-After": "60" } });
  }

  const body = await parseBody(req, domainBody);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  // Accept bare domains or full URLs; strip scheme/path/port.
  let domain = body.domain.trim().toLowerCase();
  domain = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:.*$/, "").replace(/^www\./, "");
  if (!domain) return NextResponse.json({ error: "Missing domain" }, { status: 400 });
  if (!DOMAIN_RE.test(domain)) return NextResponse.json({ error: "Not a valid domain name" }, { status: 400 });
  void audit("domain", domain, ip, 200);

  const waybackJob = fetchWayback(domain);
  const [a, aaaa, mx, txt, ns, cname, dmarcTxt, dnskey, whois, subdomains] = await Promise.all([
    doh(domain, "A"),
    doh(domain, "AAAA"),
    doh(domain, "MX"),
    doh(domain, "TXT"),
    doh(domain, "NS"),
    doh(domain, "CNAME"),
    doh(`_dmarc.${domain}`, "TXT"),
    doh(domain, "DNSKEY"),
    fetchWhois(domain),
    fetchSubdomains(domain),
  ]);
  const wayback = await waybackJob;
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
  };

  return NextResponse.json(response, { headers: rlHeaders });
}
