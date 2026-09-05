import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { analyzeEmail } from "@/lib/analysis/emailAnalysis";
import { guardRateLimit } from "@/lib/server/rateLimit";
import { getCachedEmail, setCachedEmail } from "@/lib/server/cache";
import { settleSources } from "@/lib/server/sourceHealth";
import { ensureDatasets } from "@/lib/server/datasets";
import { audit } from "@/lib/server/auditLog";
import { parseBody, emailBody } from "@/lib/server/validation";
import { resolveKey } from "@/lib/server/keyStore";
import { describeError } from "@/lib/server/fetchSafe";
import { hudsonRockFor } from "@/lib/server/hudsonRock";
import { fetchLeakCheck } from "@/lib/server/leakCheck";
import { fetchComb } from "@/lib/server/proxyNova";
import { fetchHibp } from "@/lib/server/hibp";
import { aggregateBreaches } from "@/lib/analysis/breachAggregate";
import { assessCredentialExposure, stealerCredentialSummary } from "@/lib/analysis/credentialExposure";
import { breachCatalog } from "@/lib/data/breachCatalog";
import { USER_AGENT } from "@/lib/version";
import type {
  EmailLookupResponse,
  GravatarProfile,
  EmailRepData,
  HunterData,
  AbstractEmailData,
  XposedOrNotData,
  BreachDirectoryData,
  FullContactData,
  SourceResult,
} from "@/lib/types";

// Gravatar identifies an account by a hash of its lowercased, trimmed email.
// The API accepts SHA-256 (its recommended, current form) as well as legacy MD5
// for both the profile JSON and the avatar endpoint — we use SHA-256.
function gravatarHash(email: string): string {
  return createHash("sha256").update(email).digest("hex");
}

// ── Gravatar ──────────────────────────────────────────────────────────────────
// Returns a SourceResult like every other source so its health is reported the
// same way. "No Gravatar for this address" is a successful lookup with
// `found: false` — distinct from "gravatar.com did not answer".
export const EMPTY_GRAVATAR: GravatarProfile = {
  found: false, displayName: null, preferredUsername: null,
  aboutMe: null, currentLocation: null, profileUrl: null,
  thumbnailUrl: null, accounts: [], verifiedAccounts: [],
};

async function fetchGravatar(email: string): Promise<SourceResult<GravatarProfile>> {
  const hash = gravatarHash(email.toLowerCase().trim());
  const empty = EMPTY_GRAVATAR;
  try {
    const res = await fetch(`https://gravatar.com/${hash}.json`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(8000), next: { revalidate: 0 },
    });
    if (!res.ok) {
      // 404 is Gravatar's "no profile for this hash" — a real answer, not a fault.
      if (res.status === 404) return { ok: true, data: empty };
      return { ok: false, error: `HTTP ${res.status}` };
    }

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
    if (!entry) return { ok: true, data: empty };

    return {
      ok: true,
      data: {
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
      },
    };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

// ── EmailRep.io ───────────────────────────────────────────────────────────────
async function fetchEmailRep(email: string): Promise<SourceResult<EmailRepData>> {
  try {
    // EmailRep's keyless tier is throttled to a near-instant 429 for server-side
    // callers, so a request without a key only ever produces a misleading "rate
    // limited" error on every lookup. Treat "no key" exactly like the other keyed
    // sources (Abstract, Hunter, …): report NOT_CONFIGURED and skip the doomed
    // request entirely, rather than surfacing a permanent error row.
    const emailRepKey = await resolveKey("EMAILREP_API_KEY");
    if (!emailRepKey) return { ok: false, error: "NOT_CONFIGURED" };
    const headers: Record<string, string> = { "User-Agent": USER_AGENT, Key: emailRepKey };

    const res = await fetch(`https://emailrep.io/${encodeURIComponent(email)}`, {
      headers,
      signal: AbortSignal.timeout(8000), next: { revalidate: 0 },
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
    return { ok: false, error: describeError(err) };
  }
}

// ── Abstract API — email validation ──────────────────────────────────────────
async function fetchAbstractEmail(email: string): Promise<SourceResult<AbstractEmailData>> {
  const key = await resolveKey("ABSTRACT_API_KEY");
  if (!key) return { ok: false, error: "NOT_CONFIGURED" };
  try {
    const res = await fetch(
      `https://emailvalidation.abstractapi.com/v1/?api_key=${encodeURIComponent(key)}&email=${encodeURIComponent(email)}`,
      { signal: AbortSignal.timeout(8000), next: { revalidate: 0 } }
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
    return { ok: false, error: describeError(err) };
  }
}

// ── Hunter.io — email verification ──────────────────────────────────────────
async function fetchHunter(email: string): Promise<SourceResult<HunterData>> {
  const key = await resolveKey("HUNTER_API_KEY");
  if (!key) return { ok: false, error: "NOT_CONFIGURED" };
  try {
    const res = await fetch(
      `https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(email)}&api_key=${encodeURIComponent(key)}`,
      { signal: AbortSignal.timeout(8000), next: { revalidate: 0 } }
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
    return { ok: false, error: describeError(err) };
  }
}

// ── XposedOrNot — free breach database, no API key ───────────────────────────

function normalizePasswordRisk(raw: string | undefined): string {
  switch ((raw ?? "").toLowerCase()) {
    case "plaintext":    return "ClearText";
    case "easytocrack":  return "EasyToCrack";
    case "hardtocrack":  return "StrongHash";
    default:             return "Unknown";
  }
}

// XON returns xposed_data as a nested category tree — flatten to leaf names.
// The top-level can be either an array of categories OR a single root object.
function flattenXonDataTypes(xposedData: unknown): string[] {
  const results: string[] = [];
  const MAX_DEPTH = 20; // guard against hostile/cyclic JSON from the external API
  function walk(node: unknown, depth: number): void {
    if (depth > MAX_DEPTH || !node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    // Leaf node: name starting with "data_"
    if (typeof obj.name === "string" && obj.name.startsWith("data_")) {
      results.push(obj.name.slice(5).trim()); // strip "data_" prefix
    }
    if (Array.isArray(obj.children)) obj.children.forEach((c) => walk(c, depth + 1));
    // Also walk any nested object values (handles plain-object category trees)
    for (const val of Object.values(obj)) {
      if (val && typeof val === "object" && !Array.isArray(val)) {
        walk(val, depth + 1);
      }
    }
  }
  if (Array.isArray(xposedData)) {
    xposedData.forEach((n) => walk(n, 0));
  } else if (xposedData && typeof xposedData === "object") {
    walk(xposedData, 0); // single root object
  }
  return Array.from(new Set(results)); // deduplicate
}

async function fetchXposedOrNot(email: string): Promise<SourceResult<XposedOrNotData>> {
  const EMPTY: XposedOrNotData = { breachCount: 0, breaches: [], xposedDataTypes: [], yearwiseDetails: {} };
  try {
    const res = await fetch(
      `https://api.xposedornot.com/v1/breach-analytics?email=${encodeURIComponent(email)}`,
      {
        headers: { "User-Agent": USER_AGENT, "Accept": "application/json" },
        signal: AbortSignal.timeout(8000), next: { revalidate: 0 },
      }
    );

    if (res.status === 404) return { ok: true, data: EMPTY };
    if (res.status === 429) return { ok: false, error: "RATE_LIMITED" };
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };

    type XonBreachRaw = {
      breach?: string;
      xposed_data?: string;
      xposed_date?: string;
      xposed_records?: number;
      domain?: string;
      password_risk?: string;
      verified?: number | boolean;
    };
    type XonRaw = {
      Error?: string;
      BreachMetrics?: {
        count?: number;
        xposed_data?: unknown; // nested tree in v2
        yearwise_details?: Record<string, number>[];
      };
      ExposedBreaches?: {
        breaches_details?: XonBreachRaw[];
      };
    };

    const raw = (await res.json()) as XonRaw;

    if (raw.Error || !raw.ExposedBreaches?.breaches_details?.length) {
      return { ok: true, data: EMPTY };
    }

    const yearwiseDetails: Record<string, number> = {};
    for (const yw of raw.BreachMetrics?.yearwise_details ?? []) {
      Object.assign(yearwiseDetails, yw);
    }

    const breachDetails = raw.ExposedBreaches.breaches_details;

    const parsedBreaches = breachDetails.map((b) => ({
      breach: b.breach ?? "Unknown",
      xposedData: (b.xposed_data ?? "").split(";").map((s) => s.trim()).filter(Boolean),
      xposedDate: b.xposed_date ?? "Unknown",
      xposedRecords: b.xposed_records ?? 0,
      domain: b.domain ?? "",
      passwordRisk: normalizePasswordRisk(b.password_risk),
      verified: b.verified === 1 || b.verified === true,
    }));

    // Try tree-walking BreachMetrics first; fall back to collecting from per-breach data
    let xposedDataTypes = flattenXonDataTypes(raw.BreachMetrics?.xposed_data);
    if (xposedDataTypes.length === 0) {
      xposedDataTypes = Array.from(
        new Set(parsedBreaches.flatMap((b) => b.xposedData))
      );
    }

    return {
      ok: true,
      data: {
        breachCount: raw.BreachMetrics?.count ?? breachDetails.length,
        breaches: parsedBreaches,
        xposedDataTypes,
        yearwiseDetails,
      },
    };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

// ── FullContact — real name, employer, social profiles (optional) ─────────────
async function fetchFullContact(email: string): Promise<SourceResult<FullContactData>> {
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
      body: JSON.stringify({ email }),
      signal: AbortSignal.timeout(8000), next: { revalidate: 0 },
    });

    if (res.status === 404) return { ok: false, error: "NOT_FOUND" };
    if (res.status === 422) return { ok: false, error: "NOT_FOUND" };
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
    };

    const raw = (await res.json()) as FCRaw & { message?: string };
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
          .filter((e) => e && e !== email),
        phones: (raw.details?.phones ?? []).map((p) => p.value ?? "").filter(Boolean),
        employment: (raw.details?.employment ?? [])
          .filter((e) => e.name)
          .map((e) => ({ name: e.name!, title: e.title ?? null, current: e.current ?? false })),
      },
    };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

// ── BreachDirectory — credential hash lookup (RapidAPI, optional) ─────────────
async function fetchBreachDirectory(email: string): Promise<SourceResult<BreachDirectoryData>> {
  const key = await resolveKey("RAPIDAPI_KEY");
  if (!key) return { ok: false, error: "NOT_CONFIGURED" };

  try {
    const res = await fetch(
      `https://breachdirectory.p.rapidapi.com/?func=auto&term=${encodeURIComponent(email)}`,
      {
        headers: {
          "x-rapidapi-host": "breachdirectory.p.rapidapi.com",
          "x-rapidapi-key": key,
          "Accept": "application/json",
        },
        signal: AbortSignal.timeout(8000), next: { revalidate: 0 },
      }
    );

    if (res.status === 404) {
      return { ok: true, data: { found: 0, fields: [], sources: [], results: [] } };
    }
    if (res.status === 429) return { ok: false, error: "RATE_LIMITED" };
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };

    type BDRaw = {
      found?: number;
      fields?: string[];
      sources?: string[];
      result?: {
        password?: string;
        sha1?: string;
        hash?: string;
        sources?: string[];
      }[];
    };

    const raw = (await res.json()) as BDRaw;

    // API returns found:false (bool) when nothing found
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

// ── POST handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest): Promise<NextResponse> {
  const rl = guardRateLimit(req);
  if (rl.limited) return rl.limited;
  const rlHeaders = rl.headers;
  const client = rl.client;

  await ensureDatasets();

  const body = await parseBody(req, emailBody);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400, headers: rlHeaders });

  const raw = body.email.trim();
  if (!raw) return NextResponse.json({ error: "Missing email address" }, { status: 400, headers: rlHeaders });

  const analysis = analyzeEmail(raw);
  if (!analysis.isValidFormat) {
    return NextResponse.json({ error: "Invalid email address format" }, { status: 400, headers: rlHeaders });
  }

  const email = analysis.email; // normalized lowercase
  void audit("email", email, client, 200);

  const cached = getCachedEmail(email);
  if (cached) return NextResponse.json(cached, { headers: rlHeaders });

  const { results, health } = await settleSources({
    gravatar: fetchGravatar(email),
    emailrep: fetchEmailRep(email),
    abstract: fetchAbstractEmail(email),
    hunter: fetchHunter(email),
    xon: fetchXposedOrNot(email),
    breachDirectory: fetchBreachDirectory(email),
    fullContact: fetchFullContact(email),
    // Both keyless. Cavalier needs the search-by-EMAIL endpoint here — the
    // search-by-username one the phone route uses rejects an address with 400.
    hudsonRock: hudsonRockFor(email, "email"),
    leakCheck: fetchLeakCheck(email, "email"),
    // ProxyNova COMB — keyless credential-pair exposure, email only. The module
    // keeps exact-login matches only and masks every password server-side.
    comb: fetchComb(email),
    // Have I Been Pwned — per-account breaches, optional key. NOT_CONFIGURED
    // without one, so the free union is unaffected; with a key its breaches join
    // the union below and the headline can match HIBP's own count.
    hibp: fetchHibp(email),
  });

  // The union is computed HERE, on the server, so it can be enriched from the
  // vendored HIBP catalog (which never reaches the browser bundle) and so the
  // report and the panel show one number. The client recomputes it only when an
  // old cached response lacks this field.
  const breachAggregate = aggregateBreaches(
    { xon: results.xon, leakCheck: results.leakCheck, breachDirectory: results.breachDirectory, hibp: results.hibp },
    breachCatalog(),
  );
  // A failed COMB call has no data, so `?? null` degrades it to "no COMB
  // evidence" — assessCredentialExposure then rests on the breach password
  // count and Hudson Rock's captured credentials, never reading a failure as a
  // clean result. Cavalier's search-by-email captures are exact-match, so they
  // enrich the exposure view without COMB's substring risk.
  const credentialExposure = assessCredentialExposure(
    results.comb.data ?? null,
    breachAggregate.withPassword,
    stealerCredentialSummary(results.hudsonRock.data),
  );

  const response: EmailLookupResponse = {
    email,
    analysis,
    // Gravatar is reported as a bare profile for backwards compatibility with
    // the dashboard; its health lives in `sourceHealth` like every other source.
    gravatar: results.gravatar.data ?? EMPTY_GRAVATAR,
    emailrep: results.emailrep,
    abstract: results.abstract,
    hunter: results.hunter,
    xon: results.xon,
    breachDirectory: results.breachDirectory,
    fullContact: results.fullContact,
    hudsonRock: results.hudsonRock,
    leakCheck: results.leakCheck,
    comb: results.comb,
    hibp: results.hibp,
    breachAggregate,
    credentialExposure,
    sourceHealth: health,
  };

  setCachedEmail(email, response);
  return NextResponse.json(response, { headers: rlHeaders });
}
