import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { analyzeEmail } from "@/lib/emailAnalysis";
import { checkRateLimit } from "@/lib/rateLimit";
import type {
  EmailLookupResponse,
  GravatarProfile,
  EmailRepData,
  HunterData,
  AbstractEmailData,
  SourceResult,
} from "@/lib/types";

function getIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "127.0.0.1"
  );
}

function md5(str: string): string {
  return createHash("md5").update(str).digest("hex");
}

// In-memory cache (shared with phone cache module style — simple Map)
const emailCache = new Map<string, { data: EmailLookupResponse; expiresAt: number }>();
const EMAIL_TTL = 24 * 60 * 60 * 1000;
const EMAIL_CACHE_MAX = 500;

function getCachedEmail(email: string): EmailLookupResponse | null {
  const entry = emailCache.get(email);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { emailCache.delete(email); return null; }
  return entry.data;
}

function setCachedEmail(email: string, data: EmailLookupResponse): void {
  if (emailCache.size >= EMAIL_CACHE_MAX && !emailCache.has(email)) {
    const oldest = emailCache.keys().next().value;
    if (oldest !== undefined) emailCache.delete(oldest);
  }
  emailCache.set(email, { data: { ...data, cachedAt: Date.now() }, expiresAt: Date.now() + EMAIL_TTL });
}

// ── Gravatar ──────────────────────────────────────────────────────────────────
async function fetchGravatar(email: string): Promise<GravatarProfile> {
  const hash = md5(email.toLowerCase().trim());
  const empty: GravatarProfile = {
    found: false, displayName: null, preferredUsername: null,
    aboutMe: null, currentLocation: null, profileUrl: null,
    thumbnailUrl: null, accounts: [], verifiedAccounts: [],
  };
  try {
    const res = await fetch(`https://gravatar.com/${hash}.json`, {
      headers: { "User-Agent": "HEAVEN-GeoIntel/2.0" },
      next: { revalidate: 0 },
    });
    if (!res.ok) return empty;

    type GravatarEntry = {
      displayName?: string;
      preferredUsername?: string;
      aboutMe?: string;
      currentLocation?: string;
      profileUrl?: string;
      thumbnailUrl?: string;
      accounts?: { shortname?: string; username?: string; url?: string }[];
      ims?: { type?: string; value?: string }[];
    };
    type GravatarResponse = { entry?: GravatarEntry[] };

    const json = (await res.json()) as GravatarResponse;
    const entry = json.entry?.[0];
    if (!entry) return empty;

    return {
      found: true,
      displayName: entry.displayName ?? null,
      preferredUsername: entry.preferredUsername ?? null,
      aboutMe: entry.aboutMe ?? null,
      currentLocation: entry.currentLocation ?? null,
      profileUrl: entry.profileUrl ?? null,
      thumbnailUrl: entry.thumbnailUrl
        ? `${entry.thumbnailUrl}?s=200`
        : `https://gravatar.com/avatar/${hash}?s=200&d=404`,
      accounts: (entry.accounts ?? []).map((a) => ({
        shortname: a.shortname ?? "",
        username: a.username ?? "",
        url: a.url ?? "",
      })),
      verifiedAccounts: [], // v1 API doesn't return this separately
    };
  } catch {
    return empty;
  }
}

// ── EmailRep.io ───────────────────────────────────────────────────────────────
async function fetchEmailRep(email: string): Promise<SourceResult<EmailRepData>> {
  try {
    const res = await fetch(`https://emailrep.io/${encodeURIComponent(email)}`, {
      headers: {
        "User-Agent": "HEAVEN-GeoIntel/2.0",
        "Key": process.env.EMAILREP_API_KEY ?? "",
      },
      next: { revalidate: 0 },
    });
    if (res.status === 429) return { ok: false, error: "RATE_LIMITED" };
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };

    type EmailRepRaw = {
      email?: string;
      reputation?: string;
      suspicious?: boolean;
      references?: number;
      details?: {
        blacklisted?: boolean;
        malicious_activity?: boolean;
        credentials_leaked?: boolean;
        data_breach?: boolean;
        first_seen?: string;
        last_seen?: string;
        domain_exists?: boolean;
        new_domain?: boolean;
        free_provider?: boolean;
        disposable?: boolean;
        deliverable?: boolean;
        valid_mx?: boolean;
        primary_mx?: string;
        spam?: boolean;
        spoofable?: boolean;
        spf_strict?: boolean;
        dmarc_enforced?: boolean;
        profiles?: string[];
      };
    };

    const raw = (await res.json()) as EmailRepRaw;
    const d = raw.details ?? {};
    return {
      ok: true,
      data: {
        email: raw.email ?? email,
        reputation: raw.reputation ?? "none",
        suspicious: raw.suspicious ?? false,
        references: raw.references ?? 0,
        blacklisted: d.blacklisted ?? false,
        maliciousActivity: d.malicious_activity ?? false,
        credentialsLeaked: d.credentials_leaked ?? false,
        dataBreach: d.data_breach ?? false,
        firstSeen: d.first_seen ?? null,
        lastSeen: d.last_seen ?? null,
        domainExists: d.domain_exists ?? false,
        newDomain: d.new_domain ?? false,
        freeProvider: d.free_provider ?? false,
        disposable: d.disposable ?? false,
        deliverable: d.deliverable ?? false,
        validMx: d.valid_mx ?? false,
        primaryMx: d.primary_mx ?? null,
        spam: d.spam ?? false,
        spoofable: d.spoofable ?? false,
        spfStrict: d.spf_strict ?? false,
        dmarc: d.dmarc_enforced ?? false,
        profiles: d.profiles ?? [],
      },
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ── Abstract API — email validation ──────────────────────────────────────────
async function fetchAbstractEmail(email: string): Promise<SourceResult<AbstractEmailData>> {
  const key = process.env.ABSTRACT_API_KEY;
  if (!key) return { ok: false, error: "NOT_CONFIGURED" };
  try {
    const res = await fetch(
      `https://emailvalidation.abstractapi.com/v1/?api_key=${key}&email=${encodeURIComponent(email)}`,
      { next: { revalidate: 0 } }
    );
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };

    type AbstractRaw = {
      email?: string;
      autocorrect?: string;
      deliverability?: string;
      quality_score?: number;
      is_valid_format?: { value?: boolean };
      is_free_email?: { value?: boolean };
      is_disposable_email?: { value?: boolean };
      is_role_email?: { value?: boolean };
      is_catchall_email?: { value?: boolean };
      is_mx_found?: { value?: boolean };
      is_smtp_valid?: { value?: boolean };
    };

    const raw = (await res.json()) as AbstractRaw & { error?: { message: string } };
    if ("error" in raw && raw.error) return { ok: false, error: (raw.error as { message: string }).message };
    return {
      ok: true,
      data: {
        email: raw.email ?? email,
        autocorrect: raw.autocorrect ?? "",
        deliverability: raw.deliverability ?? "UNKNOWN",
        qualityScore: raw.quality_score ?? 0,
        isValidFormat: raw.is_valid_format?.value ?? false,
        isFreeEmail: raw.is_free_email?.value ?? false,
        isDisposableEmail: raw.is_disposable_email?.value ?? false,
        isRoleEmail: raw.is_role_email?.value ?? false,
        isCatchallEmail: raw.is_catchall_email?.value ?? false,
        isMxFound: raw.is_mx_found?.value ?? false,
        isSmtpValid: raw.is_smtp_valid?.value ?? false,
      },
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ── Hunter.io — email verification ──────────────────────────────────────────
async function fetchHunter(email: string): Promise<SourceResult<HunterData>> {
  const key = process.env.HUNTER_API_KEY;
  if (!key) return { ok: false, error: "NOT_CONFIGURED" };
  try {
    const res = await fetch(
      `https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(email)}&api_key=${key}`,
      { next: { revalidate: 0 } }
    );
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };

    type HunterRaw = {
      data?: {
        result?: string;
        score?: number;
        regexp?: boolean;
        gibberish?: boolean;
        disposable?: boolean;
        webmail?: boolean;
        mx_records?: boolean;
        smtp_server?: boolean;
        smtp_check?: boolean;
        accept_all?: boolean;
        block?: boolean;
      };
      errors?: { id: string; details: string }[];
    };

    const raw = (await res.json()) as HunterRaw;
    if (raw.errors?.length) return { ok: false, error: raw.errors[0].details };
    const d = raw.data ?? {};
    return {
      ok: true,
      data: {
        result: d.result ?? "unknown",
        score: d.score ?? 0,
        regexp: d.regexp ?? false,
        gibberish: d.gibberish ?? false,
        disposable: d.disposable ?? false,
        webmail: d.webmail ?? false,
        mxRecords: d.mx_records ?? false,
        smtpServer: d.smtp_server ?? false,
        smtpCheck: d.smtp_check ?? false,
        acceptAll: d.accept_all ?? false,
        block: d.block ?? false,
      },
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ── POST handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getIp(req);
  const { allowed, remaining } = checkRateLimit(ip);
  const rlHeaders = {
    "X-RateLimit-Limit": "10",
    "X-RateLimit-Remaining": String(remaining),
    "X-RateLimit-Window": "60s",
  };
  if (!allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Max 10 requests per minute." },
      { status: 429, headers: { ...rlHeaders, "Retry-After": "60" } }
    );
  }

  let body: { email?: string };
  try { body = (await req.json()) as { email?: string }; }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const raw = body.email?.trim() ?? "";
  if (!raw) return NextResponse.json({ error: "Missing email address" }, { status: 400, headers: rlHeaders });

  const analysis = analyzeEmail(raw);
  if (!analysis.isValidFormat) {
    return NextResponse.json({ error: "Invalid email address format" }, { status: 400, headers: rlHeaders });
  }

  const email = analysis.email; // normalized lowercase

  const cached = getCachedEmail(email);
  if (cached) return NextResponse.json(cached, { headers: rlHeaders });

  const [gravatarResult, emailrepResult, abstractResult, hunterResult] = await Promise.allSettled([
    fetchGravatar(email),
    fetchEmailRep(email),
    fetchAbstractEmail(email),
    fetchHunter(email),
  ]);

  const response: EmailLookupResponse = {
    email,
    analysis,
    gravatar: gravatarResult.status === "fulfilled" ? gravatarResult.value : {
      found: false, displayName: null, preferredUsername: null,
      aboutMe: null, currentLocation: null, profileUrl: null,
      thumbnailUrl: null, accounts: [], verifiedAccounts: [],
    },
    emailrep: emailrepResult.status === "fulfilled"
      ? emailrepResult.value
      : { ok: false, error: String((emailrepResult as PromiseRejectedResult).reason) },
    abstract: abstractResult.status === "fulfilled"
      ? abstractResult.value
      : { ok: false, error: String((abstractResult as PromiseRejectedResult).reason) },
    hunter: hunterResult.status === "fulfilled"
      ? hunterResult.value
      : { ok: false, error: String((hunterResult as PromiseRejectedResult).reason) },
  };

  setCachedEmail(email, response);
  return NextResponse.json(response, { headers: rlHeaders });
}
