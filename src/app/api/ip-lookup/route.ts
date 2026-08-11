import { NextRequest, NextResponse } from "next/server";
import { guardRateLimit } from "@/lib/server/rateLimit";
import { countryToFlagEmoji } from "@/lib/analysis/phoneAnalysis";
import { audit } from "@/lib/server/auditLog";
import { parseBody, ipBody, isValidIp, ipVersion } from "@/lib/server/validation";
import { classifyIp } from "@/lib/analysis/ipClassify";
import { markAll } from "@/lib/server/sourceHealth";
import { getCachedIp, setCachedIp } from "@/lib/server/cache";
import { fetchBudgeted } from "@/lib/server/upstreamBudget";
import type { IpLookupResponse, IpLookupData, SourceProvenance } from "@/lib/types";

// ── IP OSINT — free, no API key ──────────────────────────────────────────────
// Sources (all free, no key, fixed hosts — no SSRF surface):
//   • ip-api.com           geo · ASN · ISP · reverse DNS · proxy/hosting/mobile
//   • ipwho.is             standby geo · ASN · ISP, when ip-api is out of budget
//   • internetdb.shodan.io open ports · CVEs · hostnames · classifier tags
//   • GreyNoise Community  scanner classification (benign / malicious)
//
// Everything goes through fetchBudgeted: a hard timeout so a dead source can
// never hang the lookup, and quota tracking so a throttled one is skipped
// rather than hammered. Whatever answers is returned with per-source
// provenance; only a total blackout is an error.
//
// Geo is the one thing with a fallback, because it is the one thing whose
// absence makes the result feel broken. Exposure data has no second provider —
// if Shodan is down, those fields are honestly empty and the strip says so.

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

/** ipwho.is — the fallback geo provider. HTTPS, keyless, different rate pool. */
interface IpWhoResponse {
  success?: boolean;
  message?: string;
  type?: string;
  continent?: string;
  country?: string;
  country_code?: string;
  region?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  postal?: string;
  connection?: { asn?: number; org?: string; isp?: string; domain?: string };
  timezone?: { id?: string; utc?: string };
}

/**
 * The geo half of a result, normalised so the two providers are
 * interchangeable to everything downstream.
 *
 * Every field is nullable and no field defaults to `false`. ipwho.is publishes
 * no proxy/hosting/mobile flags, and "we did not learn this" must never render
 * as "we checked and it is not a proxy" — that is a false negative in a risk
 * signal, which is worse than an empty cell.
 */
type GeoFacts = Pick<
  IpLookupData,
  | "type" | "city" | "region" | "country" | "countryCode" | "continent"
  | "latitude" | "longitude" | "postal" | "timezone" | "utcOffset"
  | "asn" | "asnOrg" | "isp" | "org"
  | "isProxy" | "isVpn" | "isHosting" | "isMobile" | "reverse"
>;

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

// ── Geo resolution ───────────────────────────────────────────────────────────

const IP_API = "ip-api.com";
const IPWHO = "ipwho.is";

const IP_API_FIELDS =
  "status,message,continent,country,countryCode,region,regionName,city,zip,lat,lon,timezone,offset,isp,org,as,asname,reverse,mobile,proxy,hosting,query";

function fromIpApi(raw: IpApiResponse, target: string): GeoFacts {
  // "AS15169 Google LLC" → 15169 + "Google LLC"
  let asn: number | null = null;
  let asnOrg: string | null = null;
  if (raw.as) {
    const m = raw.as.match(/^AS(\d+)\s*(.*)$/);
    if (m) { asn = parseInt(m[1], 10); asnOrg = m[2] || raw.asname || null; }
    else asnOrg = raw.as;
  }

  const offsetHours = typeof raw.offset === "number" ? raw.offset / 3600 : null;

  return {
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
    utcOffset: offsetHours !== null ? `UTC${offsetHours >= 0 ? "+" : ""}${offsetHours}` : null,
    asn,
    asnOrg,
    isp: raw.isp ?? null,
    org: raw.org || null,
    isProxy: raw.proxy ?? null,
    isVpn: raw.proxy ?? null,       // ip-api groups VPN under proxy
    isHosting: raw.hosting ?? null,
    isMobile: raw.mobile ?? null,
    reverse: raw.reverse || null,
  };
}

function fromIpWho(raw: IpWhoResponse, target: string): GeoFacts {
  return {
    type: raw.type ?? (ipVersion(target) === 6 ? "IPv6" : "IPv4"),
    city: raw.city ?? null,
    region: raw.region ?? null,
    country: raw.country ?? null,
    countryCode: raw.country_code ?? null,
    continent: raw.continent ?? null,
    latitude: raw.latitude ?? null,
    longitude: raw.longitude ?? null,
    postal: raw.postal || null,
    timezone: raw.timezone?.id ?? null,
    // "-07:00" → "UTC-7", matching the format ip-api's numeric offset produces,
    // so the field means the same thing whichever provider answered.
    utcOffset: formatUtcOffset(raw.timezone?.utc),
    asn: raw.connection?.asn ?? null,
    asnOrg: raw.connection?.org ?? null,
    isp: raw.connection?.isp ?? null,
    org: raw.connection?.org ?? null,
    // Not published by this provider. Explicitly null, never false.
    isProxy: null, isVpn: null, isHosting: null, isMobile: null, reverse: null,
  };
}

function formatUtcOffset(utc: string | undefined): string | null {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(utc ?? "");
  if (!m) return null;
  const hours = parseInt(m[2], 10) + parseInt(m[3], 10) / 60;
  return `UTC${m[1] === "-" ? "-" : "+"}${hours}`;
}

/**
 * A union rather than `{ facts: GeoFacts | null; error?: string }` so "no facts"
 * and "no reason why" cannot coexist: an empty geo result that cannot say what
 * went wrong is the silent N/A this codebase keeps designing away.
 */
type GeoOutcome =
  | { facts: GeoFacts; sources: SourceProvenance[]; error?: undefined }
  | { facts: null; sources: SourceProvenance[]; error: string };

/**
 * Resolve geo from ip-api, falling back to ipwho.is.
 *
 * Through 2.0.1 this was ip-api alone, and any failure failed the whole
 * lookup. ip-api's free tier is 45 requests per minute per source IP, so a
 * short burst of IP lookups would leave every subsequent one showing "IP
 * LOOKUP FAILED" for a minute — and, because the natural response to a failing
 * button is to press it again, the sustained over-limit traffic could earn a
 * one-hour ban from the provider.
 *
 * Two changes stop that: the budget is respected rather than discovered (see
 * upstreamBudget), and a second provider on an unrelated quota answers when the
 * first cannot.
 */
async function resolveGeo(target: string): Promise<GeoOutcome> {
  const sources: SourceProvenance[] = [];
  const enc = encodeURIComponent(target);

  // 1. ip-api — richer (proxy/hosting/mobile flags, reverse DNS), so preferred.
  //    fetchBudgeted skips the call outright once the provider has told us its
  //    45-per-minute window is spent.
  const res = await fetchBudgeted<IpApiResponse>(
    `http://ip-api.com/json/${enc}?fields=${IP_API_FIELDS}`,
    { source: IP_API, timeoutMs: 8000, allowNon2xx: true },
  );
  // ip-api answers 200 with `status: "fail"` for its own errors, so a usable
  // response is narrower than a successful HTTP call.
  const usable = res.status === 200 && res.data?.status === "success";
  sources.push({
    source: IP_API, ok: usable, ms: res.ms, fetchedAt: res.fetchedAt,
    error: usable ? undefined : (res.data?.message ?? res.error ?? "lookup failed"),
  });
  if (usable) return { facts: fromIpApi(res.data!, target), sources };

  // 2. ipwho.is — HTTPS, keyless, a separate quota pool. Narrower (no risk
  //    flags), which is why it is the fallback rather than the primary.
  const who = await fetchBudgeted<IpWhoResponse>(`https://ipwho.is/${enc}`, {
    source: IPWHO, timeoutMs: 8000, allowNon2xx: true,
  });
  const ok = who.status === 200 && who.data?.success === true;
  sources.push({
    source: IPWHO, ok, ms: who.ms, fetchedAt: who.fetchedAt,
    error: ok ? undefined : (who.data?.message ?? who.error ?? "lookup failed"),
  });
  if (ok) return { facts: fromIpWho(who.data!, target), sources };

  return { facts: null, sources, error: "both geolocation providers were unreachable" };
}

function fail(target: string, error: string, rlHeaders: Record<string, string>, sources: SourceProvenance[]): NextResponse {
  return NextResponse.json(
    { input: target, ip: null, pivots: buildPivots(target), threatScore: 0, threatLabel: "UNKNOWN", sources, sourceHealth: sources, error } as IpLookupResponse,
    { headers: rlHeaders },
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rl = guardRateLimit(req);
  if (rl.limited) return rl.limited;
  const rlHeaders = rl.headers;
  const client = rl.client;

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
    void audit("ip", target, client, 200);
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

  const cached = getCachedIp(target);
  if (cached) {
    void audit("ip", target, client, 200);
    return NextResponse.json(cached, { headers: rlHeaders });
  }

  // Shodan and GreyNoise run alongside the geo lookup — they answer about
  // exposure rather than location, so neither depends on the other.
  const shodanJob = fetchBudgeted<ShodanIDB>(`https://internetdb.shodan.io/${encodeURIComponent(target)}`, {
    source: "Shodan InternetDB", timeoutMs: 6000, allowNon2xx: true,
  });
  const gnJob = fetchBudgeted<GreyNoiseCommunity>(`https://api.greynoise.io/v3/community/${encodeURIComponent(target)}`, {
    source: "GreyNoise Community", timeoutMs: 6000, allowNon2xx: true, // 404 = "not observed", still useful
  });

  const [geo, shodan, gn] = await Promise.all([resolveGeo(target), shodanJob, gnJob]);

  // `allowNon2xx` means a non-200 now arrives as ok:false with a reason rather
  // than as a bare failure, so success has to be stated explicitly.
  const shodanOk = shodan.status === 200;
  const gnOk = gn.status === 200 || gn.status === 404;
  const sources: SourceProvenance[] = markAll([
    ...geo.sources,
    { source: shodan.source, ok: shodanOk, ms: shodan.ms, fetchedAt: shodan.fetchedAt, error: shodanOk ? undefined : shodan.error },
    { source: gn.source, ok: gnOk, ms: gn.ms, fetchedAt: gn.fetchedAt, error: gnOk ? undefined : gn.error },
  ]);

  const data: IpLookupData = {
    ip: target,
    type: ipVersion(target) === 6 ? "IPv6" : "IPv4",
    city: null, region: null, country: null, countryCode: null, continent: null,
    latitude: null, longitude: null, postal: null, timezone: null, utcOffset: null,
    asn: null, asnOrg: null, isp: null, org: null,
    isProxy: null, isVpn: null, isTor: null, isHosting: null, isMobile: null,
    reverse: null,
    ...geo.facts,
    flagEmoji: geo.facts?.countryCode ? countryToFlagEmoji(geo.facts.countryCode) : null,
    ports: null, vulns: null, hostnames: null, tags: null,
    greyNoise: null,
  };

  // Merge Shodan exposure (only on a real 200 with content).
  if (shodanOk && shodan.data) {
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

  // Only a total blackout is a failure.
  //
  // Every other route in this app returns what it got and reports the rest as
  // unreachable; IP mode used to be the exception, discarding good exposure
  // data whenever the geo provider was busy. But "partial" has to mean we
  // actually learned something — `ip` and `type` are echoes of what the caller
  // typed, so a card containing only those is an empty result dressed up as a
  // success, which is worse than an error.
  const hasExposure =
    data.ports !== null || data.vulns !== null ||
    data.hostnames !== null || data.tags !== null ||
    data.greyNoise !== null;

  // Written as `geo.facts === null` rather than via a combined boolean so the
  // union narrows: in here, `geo.error` is a string by construction and there
  // is no "failed for no stated reason" branch to leave untested.
  if (geo.facts === null && !hasExposure) {
    void audit("ip", target, client, 502);
    return fail(target, geo.error, rlHeaders, sources);
  }

  const { score, label } = computeThreat(data);
  void audit("ip", target, client, 200);

  const response: IpLookupResponse = {
    input: target,
    ip: data,
    /* v8 ignore next -- classifyIp always returns a value for an address that
       passed isValidIp, so the undefined arm is unreachable. */
    classification: classification ?? undefined,
    pivots: buildPivots(target),
    threatScore: score,
    threatLabel: label,
    sources,
    // `sourceHealth` is the canonical field name across every lookup mode;
    // `sources` is kept as an alias so existing IP-dashboard consumers don't break.
    sourceHealth: sources,
    // Say so when location is missing, rather than rendering an empty map and
    // letting the analyst assume the IP has no known location.
    error: geo.facts ? undefined : "geolocation unavailable — exposure data only",
  };

  // Cache only a complete answer. A degraded one would pin "geolocation
  // unavailable" in front of the analyst for the whole TTL, long after the
  // provider's one-minute window reset.
  if (geo.facts) setCachedIp(target, response);

  return NextResponse.json(response, { headers: rlHeaders });
}
