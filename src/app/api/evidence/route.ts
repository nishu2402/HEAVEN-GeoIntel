import { NextRequest, NextResponse } from "next/server";
import { guardRateLimit } from "@/lib/server/rateLimit";
import { audit } from "@/lib/server/auditLog";
import { parseBody, evidenceBody } from "@/lib/server/validation";
import { CASE_TOKEN_COOKIE, casePassword, verifyToken } from "@/lib/server/caseLock";
import { captureEvidence, listEvidence, readEvidence, verifyCase } from "@/lib/server/evidenceStore";

// ── Evidence locker API ──────────────────────────────────────────────────────
// GET  ?caseId=…              → the case manifest
// GET  ?caseId=…&id=…         → one preserved artifact, verbatim
// POST { action: "capture" }  → preserve a lookup response
// POST { action: "verify" }   → recompute every hash in the manifest
//
// Behind the same lock as the case store: the locker holds the same
// investigation data, in more detail and for longer.

function locked(): NextResponse {
  return NextResponse.json({ error: "Case store locked", locked: true }, { status: 401 });
}

/**
 * The unlock cookie, read straight off the header rather than through
 * `NextRequest.cookies`, so a duck-typed request (a test, a self-call from the
 * bulk runner) is handled the same way the rate limiter handles one.
 */
function unlockToken(req: NextRequest): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === CASE_TOKEN_COOKIE) return part.slice(eq + 1).trim();
  }
  return undefined;
}

function guardLock(req: NextRequest): NextResponse | null {
  const secret = casePassword();
  if (!secret) return null;
  return verifyToken(unlockToken(req), secret) ? null : locked();
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const denied = guardLock(req);
  if (denied) return denied;

  const caseId = new URL(req.url).searchParams.get("caseId") ?? "";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(caseId)) {
    return NextResponse.json({ error: "A valid `caseId` is required", field: "caseId" }, { status: 400 });
  }

  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
      return NextResponse.json({ error: "A valid `id` is required", field: "id" }, { status: 400 });
    }
    const text = await readEvidence(caseId, id);
    if (text === null) return NextResponse.json({ error: "No such artifact" }, { status: 404 });
    // Served as the exact bytes that were hashed, so a caller can recompute the
    // digest themselves and get the same answer.
    return new NextResponse(text, {
      headers: { "content-type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const entries = await listEvidence(caseId);
  return NextResponse.json({ caseId, entries }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rl = guardRateLimit(req);
  if (rl.limited) return rl.limited;
  const denied = guardLock(req);
  if (denied) return denied;

  const parsed = await parseBody(req, evidenceBody);
  if (!parsed.ok) return NextResponse.json(parsed.problem, { status: 400, headers: rl.headers });
  const body = parsed.data;

  if (body.action === "verify") {
    const checks = await verifyCase(body.caseId);
    return NextResponse.json({
      caseId: body.caseId,
      checks,
      ok: checks.every((c) => c.state === "ok"),
      verifiedAt: Date.now(),
    }, { headers: rl.headers });
  }

  const result = await captureEvidence({
    caseId: body.caseId,
    mode: body.mode ?? "unknown",
    identifier: body.identifier ?? "",
    payload: body.payload,
    note: body.note,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 413, headers: rl.headers });

  void audit("evidence", `${body.mode ?? "unknown"}:${body.identifier ?? ""}`, rl.client, 200);
  return NextResponse.json({ entry: result.entry, duplicate: result.duplicate }, { headers: rl.headers });
}
