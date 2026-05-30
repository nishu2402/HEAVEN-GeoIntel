import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { countryToFlagEmoji } from "@/lib/phoneAnalysis";
import type { IpLookupResponse, IpLookupData } from "@/lib/types";

// ── IP OSINT — free, no API key ──────────────────────────────────────────────
// Primary source: ip-api.com (free, 45 req/min, no key). Server-side fetch over
// HTTP is fine — keys never involved. Returns geo, ASN, ISP, reverse DNS, and
// proxy / VPN / hosting / mobile risk flags.

const IPV4 = /^(25[0-5]|2[0-4]\d|[01]?\d?\d)(\.(25[0-5]|2[0-4]\d|[01]?\d?\d)){3}$/;
const IPV6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::1|::|([0-9a-fA-F]{1,4}:){1,7}:|:(:[0-9a-fA-F]{1,4}){1,7})$/;

function isValidIp(ip: string): boolean {
  return IPV4.test(ip) || IPV6.test(ip);
}

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
    { label: "Google sweep",  url: `https://www.google.com/search?q=%22${enc}%22`,            note: "All public web mentions" },
  ];
}

function computeThreat(d: IpLookupData): { score: number; label: string } {
  let score = 0;
  if (d.isTor === true)     score = Math.max(score, 80);
  if (d.isProxy === true)   score = Math.max(score, 55);
  if (d.isVpn === true)     score = Math.max(score, 45);
  if (d.isHosting === true) score = Math.max(score, 35); // datacenter, not residential
  score = Math.min(score, 100);
  const label =
    score >= 70 ? "HIGH RISK" :
    score >= 40 ? "MODERATE" :
    score >= 20 ? "LOW RISK" :
                  "CLEAN";
  return { score, label };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getClientIp(req);
  const { allowed, remaining } = checkRateLimit(ip);
  const rlHeaders = { "X-RateLimit-Limit": "10", "X-RateLimit-Remaining": String(remaining) };
  if (!allowed) {
    return NextResponse.json({ error: "Rate limit exceeded. Max 10/min." }, { status: 429, headers: { ...rlHeaders, "Retry-After": "60" } });
  }

  let body: { ip?: string };
  try { body = (await req.json()) as { ip?: string }; }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const target = (body.ip ?? "").trim();
  if (!target) return NextResponse.json({ error: "Missing IP address" }, { status: 400 });
  if (!isValidIp(target)) return NextResponse.json({ error: "Not a valid IPv4 / IPv6 address" }, { status: 400 });

  const fields = "status,message,continent,country,countryCode,region,regionName,city,zip,lat,lon,timezone,offset,isp,org,as,asname,reverse,mobile,proxy,hosting,query";

  try {
    const res = await fetch(`http://ip-api.com/json/${encodeURIComponent(target)}?fields=${fields}`, {
      signal: AbortSignal.timeout(8000), next: { revalidate: 0 },
    });
    if (!res.ok) {
      return NextResponse.json({ input: target, ip: null, pivots: buildPivots(target), threatScore: 0, threatLabel: "UNKNOWN", error: `HTTP ${res.status}` } as IpLookupResponse, { headers: rlHeaders });
    }
    const raw = (await res.json()) as IpApiResponse;
    if (raw.status !== "success") {
      return NextResponse.json({ input: target, ip: null, pivots: buildPivots(target), threatScore: 0, threatLabel: "UNKNOWN", error: raw.message ?? "Lookup failed" } as IpLookupResponse, { headers: rlHeaders });
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
    const utcOffset = offsetHours !== null
      ? `UTC${offsetHours >= 0 ? "+" : ""}${offsetHours}`
      : null;

    const data: IpLookupData = {
      ip: raw.query ?? target,
      type: IPV6.test(target) ? "IPv6" : "IPv4",
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
      isTor: null,                    // not provided by ip-api free tier
      isHosting: raw.hosting ?? null,
      isMobile: raw.mobile ?? null,
      flagEmoji: raw.countryCode ? countryToFlagEmoji(raw.countryCode) : null,
      reverse: raw.reverse || null,
    };

    const { score, label } = computeThreat(data);

    const response: IpLookupResponse = {
      input: target,
      ip: data,
      pivots: buildPivots(target),
      threatScore: score,
      threatLabel: label,
    };
    return NextResponse.json(response, { headers: rlHeaders });
  } catch (err) {
    return NextResponse.json(
      { input: target, ip: null, pivots: buildPivots(target), threatScore: 0, threatLabel: "UNKNOWN", error: String(err) } as IpLookupResponse,
      { headers: rlHeaders }
    );
  }
}
