import { NextRequest, NextResponse } from "next/server";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { getCached } from "@/lib/server/cache";
import { guardRateLimit } from "@/lib/server/rateLimit";
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
  const rl = guardRateLimit(req);
  if (rl.limited) return rl.limited;
  const rlHeaders = rl.headers;
  const client = rl.client;

  const body = await parseBody(req, bulkBody);
  if (!body) {
    return NextResponse.json(
      { error: `Body must include a non-empty \`numbers\` array (max ${MAX_BULK} phone strings).` },
      { status: 400, headers: rlHeaders }
    );
  }

  void audit("bulk", `${body.numbers.length} numbers`, client, 200);

  const rows: BulkRow[] = body.numbers.map((raw, idx) => {
    /* v8 ignore next 3 -- unreachable via the API: the zod schema already
       enforces string[] and rejects anything else with a 400. Kept as a
       belt-and-braces guard for any future non-HTTP caller. */
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
    /* v8 ignore next -- unreachable: isPossible() has already passed above, so
       the analyser always returns a result. Defensive only. */
    if (!analysis) return { input: cleaned, ok: false, error: "Analysis failed" };

    return {
      input:       cleaned,
      ok:          true,
      e164,
      country:     analysis.country,
      countryName: analysis.countryName,
      type:        analysis.type,
      carrier:     null,
      /* v8 ignore next -- every parseable number yields at least one zone. */
      timezone:    analysis.timezones[0] ?? null,
      /* v8 ignore next -- ...and at least one UTC offset. */
      utcOffset:   analysis.utcOffsets[0] ?? null,
      npaState:    analysis.npaInfo?.state ?? null,
      npaRegion:   analysis.npaInfo?.region ?? null,
      cached:      false,
    };
  });

  return NextResponse.json({ count: rows.length, rows }, { headers: rlHeaders });
}
