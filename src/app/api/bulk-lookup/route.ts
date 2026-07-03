import { NextRequest, NextResponse } from "next/server";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { getCached } from "@/lib/server/cache";
import { checkRateLimit, getClientIp } from "@/lib/server/rateLimit";
import { audit } from "@/lib/server/auditLog";
import { parseBody, bulkBody } from "@/lib/server/validation";
import { analyzePhoneNumber } from "@/lib/analysis/phoneAnalysis";

// ── Bulk-lookup endpoint ──────────────────────────────────────────────────────
// Accepts up to MAX_BULK numbers in one POST and returns a flat array suitable
// for CSV export.  Intentionally uses ONLY offline analysis + cached results —
// it does NOT fan out to paid APIs for every entry, because:
//   1. Most free APIs have per-day quotas of 100-250 calls.  A 25-row bulk
//      lookup would burn an entire day's budget.
//   2. The expected workflow is: run bulk to triage, then drill into the
//      interesting rows via /api/lookup for the full enrichment.
// This makes the endpoint safe to expose without rate-limit accounting per
// inner number.

const MAX_BULK = 25;

interface BulkRow {
  input: string;
  ok: boolean;
  error?: string;
  e164?: string;
  country?: string | null;
  countryName?: string;
  type?: string | null;
  carrier?: string | null;
  timezone?: string | null;
  utcOffset?: string | null;
  npaState?: string | null;
  npaRegion?: string | null;
  cached?: boolean;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getClientIp(req);
  const { allowed, remaining } = checkRateLimit(ip);
  if (!allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Max 10 requests per minute." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  const body = await parseBody(req, bulkBody);
  if (!body) {
    return NextResponse.json(
      { error: `Body must include a non-empty \`numbers\` array (max ${MAX_BULK} phone strings).` },
      { status: 400 }
    );
  }

  void audit("bulk", `${body.numbers.length} numbers`, ip, 200);

  const rows: BulkRow[] = body.numbers.map((raw, idx) => {
    if (typeof raw !== "string") {
      return { input: `row-${idx}`, ok: false, error: "Not a string" };
    }
    const cleaned = raw.trim();
    if (!cleaned) {
      return { input: cleaned, ok: false, error: "Empty input" };
    }

    const parsed = parsePhoneNumberFromString(cleaned);
    if (!parsed || !parsed.isPossible()) {
      return { input: cleaned, ok: false, error: "Unparseable" };
    }

    const e164 = parsed.format("E.164");
    const cached = getCached(e164);

    if (cached) {
      return {
        input:       cleaned,
        ok:          true,
        e164,
        country:     cached.aggregated.country ?? null,
        countryName: cached.aggregated.countryName,
        type:        cached.aggregated.lineType ?? cached.analysis.type ?? null,
        carrier:     cached.aggregated.carrier,
        timezone:    cached.aggregated.timezone?.[0] ?? null,
        utcOffset:   cached.aggregated.utcOffsets?.[0] ?? null,
        npaState:    cached.analysis.npaInfo?.state ?? null,
        npaRegion:   cached.analysis.npaInfo?.region ?? null,
        cached:      true,
      };
    }

    const analysis = analyzePhoneNumber(e164);
    if (!analysis) return { input: cleaned, ok: false, error: "Analysis failed" };

    return {
      input:       cleaned,
      ok:          true,
      e164,
      country:     analysis.country,
      countryName: analysis.countryName,
      type:        analysis.type,
      carrier:     null,
      timezone:    analysis.timezones[0] ?? null,
      utcOffset:   analysis.utcOffsets[0] ?? null,
      npaState:    analysis.npaInfo?.state ?? null,
      npaRegion:   analysis.npaInfo?.region ?? null,
      cached:      false,
    };
  });

  return NextResponse.json(
    { count: rows.length, rows },
    {
      headers: {
        "X-RateLimit-Limit": "10",
        "X-RateLimit-Remaining": String(remaining),
      },
    }
  );
}
