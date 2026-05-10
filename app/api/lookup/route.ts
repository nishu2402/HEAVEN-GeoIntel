import { NextRequest, NextResponse } from "next/server";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { getCached, setCached } from "@/lib/cache";
import { checkRateLimit } from "@/lib/rateLimit";
import { analyzePhoneNumber } from "@/lib/phoneAnalysis";
import { getCountryIntel } from "@/lib/countryIntel";
import type { CountryIntel } from "@/lib/countryIntel";
import type {
  LookupResponse,
  NumVerifyData,
  IpqsData,
  AbstractData,
  TwilioData,
  SourceResult,
  AggregatedResult,
  PhoneInputData,
} from "@/lib/types";
import type { PhoneAnalysis } from "@/lib/phoneAnalysis";

function getIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "127.0.0.1"
  );
}

async function fetchNumVerify(e164: string): Promise<SourceResult<NumVerifyData>> {
  const key = process.env.NUMVERIFY_API_KEY;
  if (!key) return { ok: false, error: "NOT_CONFIGURED" };
  try {
    const number = e164.replace("+", "");
    const res = await fetch(
      `http://apilayer.net/api/validate?access_key=${key}&number=${number}&format=1`,
      { next: { revalidate: 0 } }
    );
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = (await res.json()) as NumVerifyData & { error?: { info: string } };
    if ("error" in data && data.error) return { ok: false, error: (data.error as { info: string }).info };
    return { ok: true, data: data as NumVerifyData };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function fetchIpqs(e164: string): Promise<SourceResult<IpqsData>> {
  const key = process.env.IPQS_API_KEY;
  if (!key) return { ok: false, error: "NOT_CONFIGURED" };
  try {
    const encoded = encodeURIComponent(e164);
    const res = await fetch(
      `https://www.ipqualityscore.com/api/json/phone/${key}/${encoded}?strictness=1&allow_prepaid=true`,
      { next: { revalidate: 0 } }
    );
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = (await res.json()) as IpqsData;
    if (!data.success) return { ok: false, error: data.message ?? "IPQS error" };
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function fetchAbstract(e164: string): Promise<SourceResult<AbstractData>> {
  const key = process.env.ABSTRACT_API_KEY;
  if (!key) return { ok: false, error: "NOT_CONFIGURED" };
  try {
    const res = await fetch(
      `https://phonevalidation.abstractapi.com/v1/?api_key=${key}&phone=${encodeURIComponent(e164)}`,
      { next: { revalidate: 0 } }
    );
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = (await res.json()) as AbstractData & { error?: { message: string } };
    if ("error" in data && data.error) return { ok: false, error: (data.error as { message: string }).message };
    return { ok: true, data: data as AbstractData };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function fetchTwilio(e164: string): Promise<SourceResult<TwilioData>> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return { ok: false, error: "NOT_CONFIGURED" };
  try {
    const encoded = encodeURIComponent(e164);
    const res = await fetch(
      `https://lookups.twilio.com/v2/PhoneNumbers/${encoded}?Fields=line_type_intelligence,caller_name`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        },
        next: { revalidate: 0 },
      }
    );
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({})) as { message?: string };
      return { ok: false, error: errBody.message ?? `HTTP ${res.status}` };
    }
    const data = (await res.json()) as TwilioData;
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: String(err) };
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
      : countryIntel?.timezones && countryIntel.timezones.length > 0
      ? [countryIntel.timezones[0]]
      : null;

  const utcOffsets =
    analysis.utcOffsets.length > 0
      ? analysis.utcOffsets
      : countryIntel?.timezones && countryIntel.timezones.length > 0
      ? [countryIntel.timezones[0]]
      : null;

  const fraudScore = ipqs.ok && ipqs.data ? ipqs.data.fraud_score : null;

  const isVoip = pickFirst<boolean>([
    ipqs.ok && ipqs.data ? ipqs.data.VOIP : null,
    analysis.isVoip ? true : null,
  ]);

  const isRisky = ipqs.ok && ipqs.data ? ipqs.data.risky : null;
  const recentAbuse = ipqs.ok && ipqs.data ? ipqs.data.recent_abuse : null;

  return {
    carrier,
    lineType: lineType ?? analysis.typeDescription,
    typeDescription: analysis.typeDescription,
    country: analysis.country ?? "Unknown",
    countryName: analysis.countryName,
    region,
    timezone,
    utcOffsets,
    isValid: analysis.isValid,
    fraudScore,
    isVoip: isVoip ?? analysis.isVoip,
    isMobile: analysis.isMobile,
    isFixedLine: analysis.isFixedLine,
    isTollFree: analysis.isTollFree,
    isPremiumRate: analysis.isPremiumRate,
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
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getIp(req);
  const { allowed } = checkRateLimit(ip);
  if (!allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Max 10 requests per minute." },
      { status: 429 }
    );
  }

  let body: { number?: string };
  try {
    body = (await req.json()) as { number?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const raw = body.number?.trim() ?? "";
  if (!raw) return NextResponse.json({ error: "Missing phone number" }, { status: 400 });

  const parsed = parsePhoneNumberFromString(raw);
  if (!parsed || !parsed.isPossible()) {
    return NextResponse.json({ error: "Invalid or unparseable phone number" }, { status: 400 });
  }

  const e164 = parsed.format("E.164");

  const cached = getCached(e164);
  if (cached) return NextResponse.json(cached);

  // Deep analysis — offline, zero APIs
  const analysis = analyzePhoneNumber(e164);
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

  // Optional enrichment — fan-out to APIs if keys are configured
  const [numverifyResult, ipqsResult, abstractResult, twilioResult] = await Promise.allSettled([
    fetchNumVerify(e164),
    fetchIpqs(e164),
    fetchAbstract(e164),
    fetchTwilio(e164),
  ]);

  const sources: LookupResponse["sources"] = {
    numverify:
      numverifyResult.status === "fulfilled"
        ? numverifyResult.value
        : { ok: false, error: numverifyResult.reason as string },
    ipqs:
      ipqsResult.status === "fulfilled"
        ? ipqsResult.value
        : { ok: false, error: ipqsResult.reason as string },
    abstract:
      abstractResult.status === "fulfilled"
        ? abstractResult.value
        : { ok: false, error: abstractResult.reason as string },
    twilio:
      twilioResult.status === "fulfilled"
        ? twilioResult.value
        : { ok: false, error: twilioResult.reason as string },
  };

  const aggregated = buildAggregated(
    analysis,
    countryIntel,
    sources.numverify,
    sources.ipqs,
    sources.abstract,
    sources.twilio
  );

  const response: LookupResponse = { input, analysis, countryIntel, sources, aggregated };
  setCached(e164, response);

  return NextResponse.json(response);
}
