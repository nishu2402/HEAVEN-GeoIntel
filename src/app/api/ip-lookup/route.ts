import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "@/lib/server/rateLimit";
import { countryToFlagEmoji } from "@/lib/analysis/phoneAnalysis";
import { fetchJson } from "@/lib/server/fetchSafe";
import { audit } from "@/lib/server/auditLog";
import { parseBody, ipBody, isValidIp, ipVersion } from "@/lib/server/validation";
import { classifyIp } from "@/lib/analysis/ipClassify";
import type { IpLookupResponse, IpLookupData, SourceProvenance } from "@/lib/types";

// ── IP OSINT — free, no API key ──────────────────────────────────────────────
// Sources (both free, no key, fixed hosts — no SSRF surface):
//   • ip-api.com           geo · ASN · ISP · reverse DNS · proxy/hosting/mobile
//   • internetdb.shodan.io open ports · CVEs · hostnames · classifier tags
// Both run in parallel through fetchJson (hard timeout); a dead source can never
// hang the lookup and we report exactly which source answered.

interface IpApiResponse {
  status: string;
  message?: string;
  country?: string;
  countryCode?: string;
  region?: string;
  regionName?: string;
  city?: string;
  zip?: string;
  lat?: number;
  lon?: number;
  timezone?: string;
  offset?: number;        // seconds from UTC
  isp?: string;
  org?: string;
  as?: string;            // "AS15169 Google LLC"
  asname?: string;
  reverse?: string;
  mobile?: boolean;
  proxy?: boolean;
  hosting?: boolean;
  continent?: string;
  query?: string;
}

interface ShodanIDB {
  ip?: string;
  ports?: number[];
  vulns?: string[];
  hostnames?: string[];
  tags?: string[];
  cpes?: string[];
}

interface GreyNoiseCommunity {
  ip?: string;
  noise?: boolean;
  riot?: boolean;
  classification?: string;
  name?: string;
  last_seen?: string;
  message?: string;
}

function buildPivots(ip: string): IpLookupResponse["pivots"] {
  const enc = encodeURIComponent(ip);
  return [
    { label: "Shodan",        url: `https://www.shodan.io/host/${enc}`,                       note: "Open ports, banners, exposed services" },
    { label: "Censys",        url: `https://search.censys.io/hosts/${enc}`,                   note: "Host fingerprint + certificates" },
    { label: "AbuseIPDB",     url: `https://www.abuseipdb.com/check/${enc}`,                  note: "Abuse reports + confidence score" },
    { label: "VirusTotal",    url: `https://www.virustotal.com/gui/ip-address/${enc}`,        note: "Reputation across 90+ engines" },
    { label: "GreyNoise",     url: `https://viz.greynoise.io/ip/${enc}`,                      note: "Internet background-noise classification" },
    { label: "IPinfo",        url: `https://ipinfo.io/${enc}`,                                note: "ASN, company, privacy detection" },
    { label: "Spur",          url: `https://spur.us/context/${enc}`,                          note: "VPN / proxy / anonymity context" },
    { label: "BGP.he.net",    url: `https://bgp.he.net/ip/${enc}`,                            note: "BGP routing + ASN peering" },
    { label: "Google sweep",  url: `https://www.google.com/search?q=${enc}`,                  note: "All public web mentions" },
  ];
}

function computeThreat(d: IpLookupData): { score: number; label: string } {
  let score = 0;
  const tags = (d.tags ?? []).map((t) => t.toLowerCase());
  if (d.isTor === true || tags.includes("tor"))                                    score = Math.max(score, 80);
  if (tags.includes("compromised") || tags.includes("malware") || tags.includes("honeypot")) score = Math.max(score, 85);
  if (d.isProxy === true || tags.includes("proxy"))                                score = Math.max(score, 55);
  if (d.isVpn === true || tags.includes("vpn"))                                    score = Math.max(score, 45);
  if (d.isHosting === true)                                                        score = Math.max(score, 35); // datacenter, not residential
  if (d.greyNoise?.classification === "malicious")                                 score = Math.max(score, 85);
  // Known CVEs on exposed services are a strong, concrete risk signal.
  const vc = d.vulns?.length ?? 0;
  if (vc > 0) score = Math.max(score, Math.min(60 + vc * 5, 95));
  score = Math.min(score, 100);
  const label =
    score >= 70 ? "HIGH RISK" :
    score >= 40 ? "MODERATE" :
    score >= 20 ? "LOW RISK" :
                  "CLEAN";
  return { score, label };
}

function fail(target: string, error: string, rlHeaders: Record<string, string>, sources: SourceProvenance[]): NextResponse {
  return NextResponse.json(
    { input: target, ip: null, pivots: buildPivots(target), threatScore: 0, threatLabel: "UNKNOWN", sources, error } as IpLookupResponse,
    { headers: rlHeaders },
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const clientIp = getClientIp(req);
  const { allowed, remaining } = checkRateLimit(clientIp);
  const rlHeaders = { "X-RateLimit-Limit": "10", "X-RateLimit-Remaining": String(remaining) };
  if (!allowed) {
    return NextResponse.json({ error: "Rate limit exceeded. Max 10/min." }, { status: 429, headers: { ...rlHeaders, "Retry-After": "60" } });
  }

  const body = await parseBody(req, ipBody);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const target = body.ip.trim();
  if (!target) return NextResponse.json({ error: "Missing IP address" }, { status: 400 });
  if (!isValidIp(target)) return NextResponse.json({ error: "Not a valid IPv4 / IPv6 address" }, { status: 400 });

  // Offline IANA scope classification. A non-routable address (private, loopback,
  // CGNAT, documentation, …) can never be geolocated, so short-circuit here with a
  // precise answer instead of firing three upstreams that would only fail.
  const classification = classifyIp(target);
  if (classification && !classification.isGloballyRoutable) {
    void audit("ip", target, clientIp, 200);
    return NextResponse.json(
      {
        input: target,
        ip: null,
        classification,
        pivots: buildPivots(target),
        threatScore: 0,
        threatLabel: "NOT ROUTABLE",
        sources: [],
      } as IpLookupResponse,
      { headers: rlHeaders },
    );
  }

  // Kick off Shodan InternetDB + GreyNoise so they run alongside ip-api.
  const shodanJob = fetchJson<ShodanIDB>(`https://internetdb.shodan.io/${encodeURIComponent(target)}`, {
    source: "Shodan InternetDB", timeoutMs: 6000,
  });
  const gnJob = fetchJson<GreyNoiseCommunity>(`https://api.greynoise.io/v3/community/${encodeURIComponent(target)}`, {
    source: "GreyNoise Community", timeoutMs: 6000, allowNon2xx: true, // 404 = "not observed", still useful
  });

  const fields = "status,message,continent,country,countryCode,region,regionName,city,zip,lat,lon,timezone,offset,isp,org,as,asname,reverse,mobile,proxy,hosting,query";
  const ipApi = await fetchJson<IpApiResponse>(`http://ip-api.com/json/${encodeURIComponent(target)}?fields=${fields}`, {
    source: "ip-api.com", timeoutMs: 8000,
  });

  const [shodan, gn] = await Promise.all([shodanJob, gnJob]);
  const sources: SourceProvenance[] = [
    { source: ipApi.source, ok: ipApi.ok && ipApi.data?.status === "success", ms: ipApi.ms, fetchedAt: ipApi.fetchedAt, error: ipApi.ok ? (ipApi.data?.status === "success" ? undefined : (ipApi.data?.message ?? "lookup failed")) : ipApi.error },
    { source: shodan.source, ok: shodan.ok, ms: shodan.ms, fetchedAt: shodan.fetchedAt, error: shodan.ok ? undefined : shodan.error },
    { source: gn.source, ok: gn.status === 200 || gn.status === 404, ms: gn.ms, fetchedAt: gn.fetchedAt, error: (gn.status === 200 || gn.status === 404) ? undefined : gn.error },
  ];

  if (!ipApi.ok || !ipApi.data) {
    void audit("ip", target, clientIp, 502);
    return fail(target, ipApi.error ?? "geo source unreachable", rlHeaders, sources);
  }
  const raw = ipApi.data;
  if (raw.status !== "success") {
    void audit("ip", target, clientIp, 200);
    return fail(target, raw.message ?? "Lookup failed", rlHeaders, sources);
  }

  // Parse "AS15169 Google LLC" → asn + org
  let asn: number | null = null;
  let asnOrg: string | null = null;
  if (raw.as) {
    const m = raw.as.match(/^AS(\d+)\s*(.*)$/);
    if (m) { asn = parseInt(m[1], 10); asnOrg = m[2] || raw.asname || null; }
    else asnOrg = raw.as;
  }

  const offsetHours = typeof raw.offset === "number" ? raw.offset / 3600 : null;
  const utcOffset = offsetHours !== null ? `UTC${offsetHours >= 0 ? "+" : ""}${offsetHours}` : null;

  const data: IpLookupData = {
    ip: raw.query ?? target,
    type: ipVersion(target) === 6 ? "IPv6" : "IPv4",
    city: raw.city ?? null,
    region: raw.regionName ?? null,
    country: raw.country ?? null,
    countryCode: raw.countryCode ?? null,
    continent: raw.continent ?? null,
    latitude: raw.lat ?? null,
    longitude: raw.lon ?? null,
    postal: raw.zip || null,
    timezone: raw.timezone ?? null,
    utcOffset,
    asn,
    asnOrg,
    isp: raw.isp ?? null,
    org: raw.org || null,
    isProxy: raw.proxy ?? null,
    isVpn: raw.proxy ?? null,       // ip-api groups VPN under proxy
    isTor: null,
    isHosting: raw.hosting ?? null,
    isMobile: raw.mobile ?? null,
    flagEmoji: raw.countryCode ? countryToFlagEmoji(raw.countryCode) : null,
    reverse: raw.reverse || null,
    ports: null, vulns: null, hostnames: null, tags: null,
    greyNoise: null,
  };

  // Merge Shodan exposure (only on a real 200 with content).
  if (shodan.ok && shodan.data) {
    const s = shodan.data;
    data.ports     = s.ports?.length ? s.ports : null;
    data.vulns     = s.vulns?.length ? s.vulns : null;
    data.hostnames = s.hostnames?.length ? s.hostnames : null;
    data.tags      = s.tags?.length ? s.tags : null;
    const tags = (data.tags ?? []).map((t) => t.toLowerCase());
    if (tags.includes("tor"))   data.isTor = true;
    if (tags.includes("vpn"))   data.isVpn = true;
    if (tags.includes("proxy")) data.isProxy = true;
  }

  // Merge GreyNoise community classification (200 with a classification field).
  if (gn.data && gn.status === 200 && gn.data.classification) {
    data.greyNoise = {
      classification: gn.data.classification,
      noise: Boolean(gn.data.noise),
      riot: Boolean(gn.data.riot),
      name: gn.data.name ?? null,
      lastSeen: gn.data.last_seen ?? null,
    };
  }

  const { score, label } = computeThreat(data);
  void audit("ip", target, clientIp, 200);

  const response: IpLookupResponse = {
    input: target,
    ip: data,
    classification: classification ?? undefined,
    pivots: buildPivots(target),
    threatScore: score,
    threatLabel: label,
    sources,
  };
  return NextResponse.json(response, { headers: rlHeaders });
}
