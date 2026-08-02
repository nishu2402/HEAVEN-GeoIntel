import { NextRequest, NextResponse } from "next/server";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { getCached, setCached } from "@/lib/server/cache";
import { guardRateLimit } from "@/lib/server/rateLimit";
import { settleSources } from "@/lib/server/sourceHealth";
import { ensureDatasets } from "@/lib/server/datasets";
import { audit } from "@/lib/server/auditLog";
import { parseBody, phoneBody } from "@/lib/server/validation";
import { analyzePhoneNumber } from "@/lib/analysis/phoneAnalysis";
import { getCountryIntel } from "@/lib/data/countryIntel";
import { deriveOfflineReputation } from "@/lib/analysis/freePhoneIntel";
import { lookupMccMnc } from "@/lib/data/mccMnc";
import { resolveKey } from "@/lib/server/keyStore";
import { describeError } from "@/lib/server/fetchSafe";
import { USER_AGENT } from "@/lib/version";
import { hudsonRockFor } from "@/lib/server/hudsonRock";
import { fetchLeakCheck } from "@/lib/server/leakCheck";
import type { CountryIntel } from "@/lib/data/countryIntel";
import type {
  LookupResponse,
  NumVerifyData,
  IpqsData,
  AbstractData,
  TwilioData,
  SourceResult,
  AggregatedResult,
  PhoneInputData,
  BreachDirectoryData,
  FullContactData,
  HudsonRockData,
  LeakCheckData,
} from "@/lib/types";
import type { PhoneAnalysis } from "@/lib/analysis/phoneAnalysis";

async function fetchNumVerify(e164: string): Promise<SourceResult<NumVerifyData>> {
  const key = await resolveKey("NUMVERIFY_API_KEY");
  if (!key) return { ok: false, error: "NOT_CONFIGURED" };
  try {
    const number = e164.replace("+", "");
    // NOTE: apilayer/NumVerify only serves HTTPS on PAID plans — the free tier is
    // HTTP-only, so on the free tier this request (with the access_key in the
    // query string) travels in cleartext. Documented as a known limitation in
    // SECURITY.md; for sensitive work use a paid HTTPS plan or omit NumVerify.
    const res = await fetch(
      `http://apilayer.net/api/validate?access_key=${key}&number=${number}&format=1`,
      { signal: AbortSignal.timeout(8000), next: { revalidate: 0 } }
    );
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = (await res.json()) as NumVerifyData & { error?: { info: string } };
    if ("error" in data && data.error) return { ok: false, error: (data.error as { info: string }).info };
    return { ok: true, data: data as NumVerifyData };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

async function fetchIpqs(e164: string): Promise<SourceResult<IpqsData>> {
  const key = await resolveKey("IPQS_API_KEY");
  if (!key) return { ok: false, error: "NOT_CONFIGURED" };
  try {
    const encoded = encodeURIComponent(e164);
    const res = await fetch(
      `https://www.ipqualityscore.com/api/json/phone/${key}/${encoded}?strictness=1&allow_prepaid=true`,
      { signal: AbortSignal.timeout(8000), next: { revalidate: 0 } }
    );
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = (await res.json()) as IpqsData;
    if (!data.success) return { ok: false, error: data.message ?? "IPQS error" };
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

async function fetchAbstract(e164: string): Promise<SourceResult<AbstractData>> {
  const key = await resolveKey("ABSTRACT_API_KEY");
  if (!key) return { ok: false, error: "NOT_CONFIGURED" };
  try {
    const res = await fetch(
      `https://phonevalidation.abstractapi.com/v1/?api_key=${key}&phone=${encodeURIComponent(e164)}`,
      { signal: AbortSignal.timeout(8000), next: { revalidate: 0 } }
    );
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = (await res.json()) as AbstractData & { error?: { message: string } };
    if ("error" in data && data.error) return { ok: false, error: (data.error as { message: string }).message };
    return { ok: true, data: data as AbstractData };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

// ── BreachDirectory — credential hash lookup for phone numbers (RapidAPI) ──
// The same endpoint that searches email also accepts phone numbers via func=auto.
async function fetchBreachDirectoryPhone(e164: string): Promise<SourceResult<BreachDirectoryData>> {
  const key = await resolveKey("RAPIDAPI_KEY");
  if (!key) return { ok: false, error: "NOT_CONFIGURED" };
  try {
    // Use the digit-only form (+ stripped) — BreachDirectory matches phone records by digits
    const term = e164.replace(/^\+/, "");
    const res = await fetch(
      `https://breachdirectory.p.rapidapi.com/?func=auto&term=${encodeURIComponent(term)}`,
      {
        headers: {
          "x-rapidapi-host": "breachdirectory.p.rapidapi.com",
          "x-rapidapi-key": key,
          "Accept": "application/json",
        },
        signal: AbortSignal.timeout(8000), next: { revalidate: 0 },
      }
    );

    if (res.status === 404) return { ok: true, data: { found: 0, fields: [], sources: [], results: [] } };
    if (res.status === 429) return { ok: false, error: "RATE_LIMITED" };
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };

    type BDRaw = {
      found?: number;
      fields?: string[];
      sources?: string[];
      result?: { password?: string; sha1?: string; hash?: string; sources?: string[] }[];
    };
    const raw = (await res.json()) as BDRaw;
    if (!raw.found || raw.found === 0) {
      return { ok: true, data: { found: 0, fields: [], sources: [], results: [] } };
    }
    return {
      ok: true,
      data: {
        found: typeof raw.found === "number" ? raw.found : 0,
        fields: raw.fields ?? [],
        sources: raw.sources ?? [],
        results: (raw.result ?? []).map((r) => ({
          password: r.password ?? "",
          sha1: r.sha1 ?? "",
          hash: r.hash ?? "",
          sources: r.sources ?? [],
        })),
      },
    };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

// ── FullContact — person enrichment from phone number ──
// person.enrich accepts a phone field; returns name, employer, social profiles.
async function fetchFullContactPhone(e164: string): Promise<SourceResult<FullContactData>> {
  const key = await resolveKey("FULLCONTACT_API_KEY");
  if (!key) return { ok: false, error: "NOT_CONFIGURED" };
  try {
    const res = await fetch("https://api.fullcontact.com/v3/person.enrich", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify({ phone: e164 }),
      signal: AbortSignal.timeout(8000), next: { revalidate: 0 },
    });

    if (res.status === 404 || res.status === 422) return { ok: false, error: "NOT_FOUND" };
    if (res.status === 429) return { ok: false, error: "RATE_LIMITED" };
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };

    type FCProfile = { url?: string; username?: string };
    type FCEmployment = { name?: string; title?: string; current?: boolean };
    type FCRaw = {
      fullName?: string;
      age?: number;
      gender?: string;
      location?: string;
      title?: string;
      organization?: string;
      bio?: string;
      avatar?: string;
      details?: {
        profiles?: Record<string, FCProfile>;
        emails?: { value?: string }[];
        phones?: { value?: string }[];
        employment?: FCEmployment[];
      };
      message?: string;
    };

    const raw = (await res.json()) as FCRaw;
    if (raw.message === "Unable to process request") return { ok: false, error: "NOT_FOUND" };

    const profiles = Object.entries(raw.details?.profiles ?? {})
      .filter(([, p]) => p.url)
      .map(([platform, p]) => ({
        platform: platform.charAt(0).toUpperCase() + platform.slice(1),
        url: p.url!,
        username: p.username ?? "",
      }));

    return {
      ok: true,
      data: {
        fullName: raw.fullName ?? null,
        age: raw.age ?? null,
        gender: raw.gender ?? null,
        location: raw.location ?? null,
        title: raw.title ?? null,
        organization: raw.organization ?? null,
        bio: raw.bio ?? null,
        avatar: raw.avatar ?? null,
        profiles,
        otherEmails: (raw.details?.emails ?? [])
          .map((e) => e.value ?? "")
          .filter(Boolean),
        phones: (raw.details?.phones ?? [])
          .map((p) => p.value ?? "")
          .filter((p) => p && p !== e164),
        employment: (raw.details?.employment ?? [])
          .filter((e) => e.name)
          .map((e) => ({ name: e.name!, title: e.title ?? null, current: e.current ?? false })),
      },
    };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

async function fetchTwilio(e164: string): Promise<SourceResult<TwilioData>> {
  const sid = await resolveKey("TWILIO_ACCOUNT_SID");
  const token = await resolveKey("TWILIO_AUTH_TOKEN");
  if (!sid || !token) return { ok: false, error: "NOT_CONFIGURED" };
  try {
    const encoded = encodeURIComponent(e164);
    const res = await fetch(
      `https://lookups.twilio.com/v2/PhoneNumbers/${encoded}?Fields=line_type_intelligence,caller_name`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        },
        signal: AbortSignal.timeout(8000), next: { revalidate: 0 },
      }
    );
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({})) as { message?: string };
      return { ok: false, error: errBody.message ?? `HTTP ${res.status}` };
    }
    const data = (await res.json()) as TwilioData;
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

function pickFirst<T>(candidates: (T | null | undefined)[]): T | null {
  return candidates.find((v) => v != null && v !== "") ?? null;
}

function buildAggregated(
  analysis: PhoneAnalysis,
  countryIntel: CountryIntel | null,
  numverify: SourceResult<NumVerifyData>,
  ipqs: SourceResult<IpqsData>,
  abstract: SourceResult<AbstractData>,
  twilio: SourceResult<TwilioData>
): AggregatedResult {
  const carrier = pickFirst<string>([
    ipqs.ok ? ipqs.data?.carrier : null,
    numverify.ok ? numverify.data?.carrier : null,
    abstract.ok ? abstract.data?.carrier : null,
    twilio.ok ? twilio.data?.line_type_intelligence?.carrier_name : null,
  ]);

  const lineType = pickFirst<string>([
    ipqs.ok ? ipqs.data?.line_type : null,
    twilio.ok ? twilio.data?.line_type_intelligence?.type : null,
    numverify.ok ? numverify.data?.line_type : null,
    abstract.ok ? abstract.data?.type : null,
    analysis.type,
  ]);

  const region = pickFirst<string>([
    ipqs.ok ? ipqs.data?.region : null,
    numverify.ok ? numverify.data?.location : null,
  ]);

  const timezoneRaw = ipqs.ok && ipqs.data?.timezone ? ipqs.data.timezone : null;
  const timezone =
    timezoneRaw
      ? [timezoneRaw]
      : analysis.timezones.length > 0
      ? analysis.timezones
      /* v8 ignore start -- every number libphonenumber can parse yields at least
         one timezone, so the country-dataset fallback is a safety net only. */
      : countryIntel?.timezones && countryIntel.timezones.length > 0
      ? [countryIntel.timezones[0]]
      : null;
  /* v8 ignore stop */

  // Only real UTC offsets — never fall back to an IANA timezone name,
  // which is not an offset and would render as wrong data.
  const utcOffsets = analysis.utcOffsets.length > 0 ? analysis.utcOffsets : null;

  // Only accept a real number. A success response that omits fraud_score (or
  // sends a string) would otherwise flow into the threat maths as NaN and
  // serialise to `threatScore: null` — a broken bar in the UI instead of an
  // honest "not supplied".
  const rawFraud = ipqs.ok && ipqs.data ? ipqs.data.fraud_score : null;
  const fraudScore = typeof rawFraud === "number" && Number.isFinite(rawFraud) ? rawFraud : null;

  // VOIP: only claim true if explicitly confirmed — never claim false without data
  const isVoipConfirmed: boolean | null =
    ipqs.ok && ipqs.data
      ? ipqs.data.VOIP
      : analysis.isVoip
      ? true
      : null;

  const isRisky = ipqs.ok && ipqs.data ? ipqs.data.risky : null;
  const recentAbuse = ipqs.ok && ipqs.data ? ipqs.data.recent_abuse : null;

  // Caller identity
  const twilioCallerName = twilio.ok ? (twilio.data?.caller_name?.caller_name ?? null) : null;
  const ipqsName = ipqs.ok && ipqs.data?.name ? ipqs.data.name : null;
  const callerName = pickFirst<string>([twilioCallerName, ipqsName]);
  const callerType = twilio.ok ? (twilio.data?.caller_name?.caller_type ?? null) : null;

  // SIM intelligence
  const prepaid = ipqs.ok && ipqs.data ? (ipqs.data.prepaid ?? null) : null;
  const active = ipqs.ok && ipqs.data ? (ipqs.data.active ?? null) : null;
  const activeStatus = ipqs.ok && ipqs.data?.active_status ? ipqs.data.active_status : null;
  const userActivity = ipqs.ok && ipqs.data?.user_activity ? ipqs.data.user_activity : null;
  const city = ipqs.ok && ipqs.data?.city ? ipqs.data.city : null;
  const mobileCountryCode = twilio.ok
    ? (twilio.data?.line_type_intelligence?.mobile_country_code ?? null)
    : null;
  const mobileNetworkCode = twilio.ok
    ? (twilio.data?.line_type_intelligence?.mobile_network_code ?? null)
    : null;
  const rawEmails = ipqs.ok ? ipqs.data?.associated_email_addresses?.emails : undefined;
  const associatedEmails = rawEmails && rawEmails.length > 0 ? rawEmails : null;

  // Offline PLMN → operator resolution: if no API gave us a carrier name but
  // Twilio returned MCC/MNC, resolve the operator from the bundled database.
  const plmnCarrier = lookupMccMnc(mobileCountryCode, mobileNetworkCode);
  const resolvedCarrier = carrier ?? plmnCarrier?.operator ?? null;

  return {
    carrier: resolvedCarrier,
    lineType: lineType ?? analysis.typeDescription,
    typeDescription: analysis.typeDescription,
    country: analysis.country ?? "Unknown",
    countryName: analysis.countryName,
    region,
    timezone,
    utcOffsets,
    isValid: analysis.isValid,
    fraudScore,
    isVoip: isVoipConfirmed,
    isMobile: analysis.isMobile ? true : null,
    isFixedLine: analysis.isFixedLine ? true : null,
    isAmbiguousType: analysis.isAmbiguousType,
    isTollFree: analysis.isTollFree ? true : null,
    isPremiumRate: analysis.isPremiumRate ? true : null,
    isDisposable: null,
    isRisky,
    recentAbuse,
    carrierPrefix: analysis.carrierPrefix,
    areaCode: analysis.areaCode,
    numberLength: analysis.numberLength,
    formatE164: analysis.formatE164,
    formatInternational: analysis.formatInternational,
    formatNational: analysis.formatNational,
    formatRfc3966: analysis.formatRfc3966,
    callerName,
    callerType,
    prepaid,
    active,
    activeStatus,
    userActivity,
    mobileCountryCode,
    mobileNetworkCode,
    associatedEmails,
    city,
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rl = guardRateLimit(req);
  if (rl.limited) return rl.limited;
  const rlHeaders = rl.headers;
  const client = rl.client;

  await ensureDatasets();

  const body = await parseBody(req, phoneBody);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const raw = body.number.trim();
  if (!raw) return NextResponse.json({ error: "Missing phone number" }, { status: 400 });

  const parsed = parsePhoneNumberFromString(raw);
  if (!parsed || !parsed.isPossible()) {
    return NextResponse.json({ error: "Invalid or unparseable phone number" }, { status: 400 });
  }

  const e164 = parsed.format("E.164");
  void audit("phone", e164, client, 200);

  const cached = getCached(e164);
  if (cached) return NextResponse.json(cached, { headers: rlHeaders });

  // Deep analysis — offline, zero APIs
  const analysis = analyzePhoneNumber(e164);
  /* v8 ignore next 3 -- unreachable: libphonenumber has already parsed the
     number above, so analyzePhoneNumber cannot return null here. Kept so a
     future change to the parser can't produce a 500 instead of a 400. */
  if (!analysis) {
    return NextResponse.json({ error: "Failed to analyze number" }, { status: 400 });
  }

  const countryIntel = analysis.country ? getCountryIntel(analysis.country) : null;

  const input: PhoneInputData = {
    raw,
    e164,
    national: parsed.formatNational(),
    country: parsed.country ?? "Unknown",
    countryCallingCode: `+${parsed.countryCallingCode}`,
    region: null,
    isValid: parsed.isValid(),
    isPossible: parsed.isPossible(),
    type: parsed.getType() ?? null,
  };

  // Optional enrichment — fan-out to APIs if keys are configured.
  // Hudson Rock and LeakCheck are always called (no key required). settleSources
  // times each call and turns a rejection into a failed envelope, so one dead
  // source can never fail the lookup.
  const { results: sources, health } = await settleSources({
    numverify: fetchNumVerify(e164),
    ipqs: fetchIpqs(e164),
    abstract: fetchAbstract(e164),
    twilio: fetchTwilio(e164),
    breachDirectory: fetchBreachDirectoryPhone(e164),
    fullContact: fetchFullContactPhone(e164),
    hudsonRock: hudsonRockFor(e164, "identifier"),
    leakCheck: fetchLeakCheck(e164, "phone"),
  });

  const aggregated = buildAggregated(
    analysis,
    countryIntel,
    sources.numverify,
    sources.ipqs,
    sources.abstract,
    sources.twilio
  );

  const { score: threatScore, label: threatLabel } = computeThreatScore(
    aggregated,
    sources.breachDirectory,
    sources.hudsonRock,
    sources.leakCheck
  );

  const offline = deriveOfflineReputation(analysis);

  const response: LookupResponse = {
    input, analysis, countryIntel, offline, sources, sourceHealth: health,
    aggregated, threatScore, threatLabel,
  };
  setCached(e164, response);

  return NextResponse.json(response, { headers: rlHeaders });
}

// ── Unified threat score (0-100) ─────────────────────────────────────────────
// Combines fraud score, breach hits, abuse flags, VOIP, prepaid into one number.
// Matches the email Threat Score model so the UI can render the same bar.
function computeThreatScore(
  agg: AggregatedResult,
  bd: SourceResult<BreachDirectoryData>,
  hr: SourceResult<HudsonRockData>,
  lc: SourceResult<LeakCheckData>
): { score: number; label: string } {
  let score = 0;

  // IPQS fraud score — already 0-100, weight 60%
  if (agg.fraudScore !== null) {
    score = Math.max(score, Math.round(agg.fraudScore * 0.6));
  }
  // Recent abuse / risky flags
  if (agg.recentAbuse === true) score = Math.max(score, 50);
  if (agg.isRisky === true)     score = Math.max(score, 55);
  // Confirmed VOIP raises baseline — VOIP is overused for fraud
  if (agg.isVoip === true)      score = Math.max(score, 25);
  // Inactive line is suspicious for active fraud claims
  if (agg.active === false)     score = Math.max(score, 30);
  // Prepaid is a small bump — common in burner setups
  if (agg.prepaid === true)     score += 5;
  // Premium-rate is inherently risky
  if (agg.isPremiumRate === true) score = Math.max(score, 60);

  // Breach hits — same model as email
  if (bd.ok && bd.data && bd.data.found > 0) {
    score += Math.min(bd.data.found * 8, 30);
  }

  // Infostealer infections — each captured device is high signal
  if (hr.ok && hr.data && hr.data.total > 0) {
    score = Math.max(score, 60);
    score += Math.min(hr.data.total * 10, 30);
  }

  // Public breach index. Weighted below BreachDirectory on purpose: LeakCheck's
  // free tier reports that records EXIST, not what they contain, so appearing in
  // it is exposure evidence rather than a confirmed credential compromise.
  if (lc.ok && lc.data && lc.data.found > 0) {
    score += Math.min(lc.data.found * 3, 20);
  }

  score = Math.max(0, Math.min(score, 100));

  const label =
    score >= 70 ? "CRITICAL" :
    score >= 40 ? "HIGH RISK" :
    score >= 20 ? "MODERATE" :
    score > 0   ? "LOW RISK" :
                  "CLEAN";

  return { score, label };
}
