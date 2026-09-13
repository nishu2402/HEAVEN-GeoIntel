import { NextRequest, NextResponse } from "next/server";
import { guardRateLimit } from "@/lib/server/rateLimit";
import { audit } from "@/lib/server/auditLog";
import { parseBody, bulkBody } from "@/lib/server/validation";
import { detectMode } from "@/lib/client/modes";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { isPlausibleUsername } from "@/lib/data/usernameSites";
import { isValidIp } from "@/lib/server/validation";
import { toAsciiHost, normalizeEmail } from "@/lib/analysis/idn";
import { detectChain } from "@/lib/analysis/wallet";
import { detectHashKind } from "@/lib/analysis/hash";
import {
  startJob, getJob, cancelJob, jobCsv, BULK_MODES, MAX_BULK_ROWS,
  type BulkMode,
} from "@/lib/server/bulkJobs";

// ── Bulk lookup ──────────────────────────────────────────────────────────────
//
// POST { items: ["…", …], mode?: "auto" | <mode> }  → start a job, get its id
// POST { numbers: [...] }                           → the original phone-only
//                                                     form, still accepted
// GET  ?id=…                                        → progress + rows so far
// GET  ?id=…&format=csv                             → rows as CSV
// DELETE ?id=…                                      → stop a running job
//
// This endpoint used to run offline phone analysis over at most 25 numbers and
// nothing else, so triaging a list of 200 domains meant 200 manual lookups. It
// now queues a job that runs the REAL lookup for each row — every mode, the
// same validation, the same sources, the same provenance — and the client polls
// it. See lib/server/bulkJobs.ts for why that is safe for the upstream quotas.

/** Rows whose mode could not be determined are reported, never guessed at. */
interface Prepared {
  rows: { mode: BulkMode; value: string }[];
  skipped: { input: string; reason: string }[];
}

/**
 * Is this value plausibly a target for that mode?
 *
 * Checked before the row is queued, using the same validators the single-target
 * routes use. A row that cannot possibly be looked up should not spend a slot
 * in the job and come back as a 400 two minutes later — it should be reported
 * as skipped, with the reason, straight away.
 */
export function plausible(mode: BulkMode, value: string): boolean {
  switch (mode) {
    case "phone": return parsePhoneNumberFromString(value)?.isPossible() === true;
    case "email": return normalizeEmail(value) !== null;
    case "username": return isPlausibleUsername(value.replace(/^@/, ""));
    case "ip": return isValidIp(value);
    case "domain": return toAsciiHost(value) !== null;
    case "wallet": return detectChain(value) !== null;
    /* v8 ignore next -- the switch is exhaustive over BulkMode. */
    default: return detectHashKind(value) !== null;
  }
}

export function prepareRows(items: string[], mode: string | undefined): Prepared {
  const rows: Prepared["rows"] = [];
  const skipped: Prepared["skipped"] = [];
  const seen = new Set<string>();

  for (const raw of items) {
    const value = raw.trim();
    if (!value) continue;
    // `auto` classifies each row on its own, so one paste can mix domains and
    // emails — which is what a spreadsheet column usually holds.
    const resolved = mode && mode !== "auto" ? mode : detectMode(value);
    if (!BULK_MODES.includes(resolved as BulkMode)) {
      skipped.push({ input: value, reason: `no bulk lookup for mode "${resolved}"` });
      continue;
    }
    if (!plausible(resolved as BulkMode, value)) {
      skipped.push({ input: value, reason: `not a valid ${resolved}` });
      continue;
    }
    const key = `${resolved}:${value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ mode: resolved as BulkMode, value });
  }
  return { rows, skipped };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rl = guardRateLimit(req);
  if (rl.limited) return rl.limited;
  const rlHeaders = rl.headers;
  const client = rl.client;

  const parsed = await parseBody(req, bulkBody);
  if (!parsed.ok) return NextResponse.json(parsed.problem, { status: 400, headers: rlHeaders });
  const body = parsed.data;

  // `numbers` is the pre-3.2 phone-only field. Kept so an existing script or a
  // saved CSV workflow does not break on upgrade.
  const items = body.items ?? body.numbers ?? [];
  const mode = body.items ? body.mode : "phone";
  if (items.length === 0) {
    return NextResponse.json(
      { error: "Send `items` (any identifiers) or `numbers` (phone numbers)", field: "items" },
      { status: 400, headers: rlHeaders },
    );
  }

  const { rows, skipped } = prepareRows(items, mode);
  if (rows.length === 0) {
    return NextResponse.json(
      { error: "None of the supplied values could be looked up. See `skipped` for why.", skipped },
      { status: 400, headers: rlHeaders },
    );
  }

  const job = startJob({ rows: rows.slice(0, MAX_BULK_ROWS) });
  void audit("bulk", `${rows.length} rows`, client, 200);

  return NextResponse.json(
    {
      id: job.id,
      total: job.total,
      state: job.state,
      skipped,
      ...(rows.length > MAX_BULK_ROWS ? { truncated: rows.length - MAX_BULK_ROWS } : {}),
    },
    { headers: rlHeaders },
  );
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const job = getJob(id);
  if (!job) return NextResponse.json({ error: "No such job" }, { status: 404 });

  if (new URL(req.url).searchParams.get("format") === "csv") {
    return new NextResponse(jobCsv(job), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="bulk-${job.id.slice(0, 8)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json(
    {
      id: job.id,
      state: job.state,
      total: job.total,
      done: job.done,
      rows: job.rows,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  return cancelJob(id)
    ? NextResponse.json({ id, state: "cancelled" })
    : NextResponse.json({ error: "No running job with that id" }, { status: 404 });
}
