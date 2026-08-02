import { NextRequest, NextResponse } from "next/server";
import {
  listCases, createCase, deleteCase, deleteAllCases, renameCase, setCaseNotes,
  addEntity, removeEntity, importCase, mergeCases, addEdges, recordSnapshot,
} from "@/lib/server/caseStore";
import { clearAudit } from "@/lib/server/auditLog";
import {
  CASE_TOKEN_COOKIE, casePassword, issueToken, passwordMatches, verifyToken,
} from "@/lib/server/caseLock";
import type { EntityKind, InvestigationCase } from "@/lib/types";

// ── Investigation cases API (persistent, file-backed) ───────────────────────
// GET                          → list all cases
// POST { action, ... }         → unlock | create | rename | notes | addEntity |
//                                removeEntity | import | merge | addEdges | snapshot
// DELETE ?id=...               → delete a case
// DELETE ?all=1                → wipe ALL cases + audit log (delete my data)
//
// When CASE_PASSWORD is set, every route below except the `unlock` action
// requires a valid unlock cookie (see lib/server/caseLock). Unset — the default
// — leaves behaviour exactly as it was.

const KINDS: EntityKind[] = ["phone", "email", "username", "ip", "domain"];

/** 401 body the client uses to decide whether to show the unlock form. */
function locked(): NextResponse {
  return NextResponse.json({ error: "Case store locked", locked: true }, { status: 401 });
}

/**
 * Null when the request may proceed; a 401 response when it may not. Returning
 * the response (rather than a boolean) keeps the decision and its body in one
 * place, so a new handler cannot accidentally allow an unlocked request through.
 */
function guardLock(req: NextRequest): NextResponse | null {
  const secret = casePassword();
  if (!secret) return null; // lock disabled
  const token = req.cookies.get(CASE_TOKEN_COOKIE)?.value;
  return verifyToken(token, secret) ? null : locked();
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const denied = guardLock(req);
  if (denied) return denied;
  const cases = await listCases();
  return NextResponse.json({ cases }, { headers: { "Cache-Control": "no-store" } });
}

interface EdgeInput {
  from?: { kind?: unknown; value?: unknown };
  to?: { kind?: unknown; value?: unknown };
  reason?: unknown;
}

interface CaseAction {
  action:
    | "create" | "rename" | "notes" | "addEntity" | "removeEntity"
    | "import" | "merge" | "addEdges" | "snapshot" | "unlock";
  id?: string;
  name?: string;
  notes?: string;
  kind?: EntityKind;
  value?: string;
  note?: string;
  /** For action "import": a previously exported case payload. */
  case?: Partial<InvestigationCase>;
  /** For action "merge": the case folded into `id` and then deleted. */
  sourceId?: string;
  /** For action "addEdges": derived relationships from the auto-pivot engine. */
  edges?: EdgeInput[];
  /** For action "snapshot": the comparable fact bag for one lookup. */
  facts?: unknown;
  /** For action "snapshot": whether the lookup behind it was served from cache. */
  fromCache?: boolean;
  /** For action "unlock". */
  password?: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: CaseAction;
  try { body = (await req.json()) as CaseAction; }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  // `unlock` is the one action that must work while locked — it is how you stop
  // being locked. Everything else goes through the guard.
  if (body.action === "unlock") {
    const secret = casePassword();
    if (!secret) return NextResponse.json({ ok: true, locked: false });
    if (!passwordMatches(body.password, secret)) {
      return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
    }
    const { token, maxAgeSeconds } = issueToken(secret);
    const res = NextResponse.json({ ok: true, locked: false });
    res.cookies.set(CASE_TOKEN_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: maxAgeSeconds,
      secure: process.env.FORCE_HTTPS === "1",
    });
    return res;
  }

  const denied = guardLock(req);
  if (denied) return denied;

  try {
    switch (body.action) {
      case "create": {
        const c = await createCase(body.name ?? "");
        return NextResponse.json({ case: c });
      }
      case "rename": {
        if (!body.id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
        const c = await renameCase(body.id, body.name ?? "");
        return c ? NextResponse.json({ case: c }) : NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      case "notes": {
        if (!body.id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
        const c = await setCaseNotes(body.id, body.notes ?? "");
        return c ? NextResponse.json({ case: c }) : NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      case "addEntity": {
        if (!body.id || !body.kind || !body.value) return NextResponse.json({ error: "Missing id/kind/value" }, { status: 400 });
        if (!KINDS.includes(body.kind)) return NextResponse.json({ error: "Bad kind" }, { status: 400 });
        const c = await addEntity(body.id, body.kind, body.value, body.note);
        return c ? NextResponse.json({ case: c }) : NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      case "removeEntity": {
        if (!body.id || !body.kind || !body.value) return NextResponse.json({ error: "Missing id/kind/value" }, { status: 400 });
        const c = await removeEntity(body.id, body.kind, body.value);
        return c ? NextResponse.json({ case: c }) : NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      case "addEdges": {
        if (!body.id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
        if (!Array.isArray(body.edges)) return NextResponse.json({ error: "Missing edges" }, { status: 400 });
        const c = await addEdges(body.id, body.edges);
        return c ? NextResponse.json({ case: c }) : NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      case "snapshot": {
        if (!body.id || !body.kind || !body.value) return NextResponse.json({ error: "Missing id/kind/value" }, { status: 400 });
        if (!KINDS.includes(body.kind)) return NextResponse.json({ error: "Bad kind" }, { status: 400 });
        const out = await recordSnapshot(body.id, body.kind, body.value, body.facts, body.fromCache === true);
        return out
          ? NextResponse.json({ case: out.case, diff: out.diff })
          : NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      case "import": {
        if (!body.case || typeof body.case !== "object") return NextResponse.json({ error: "Missing case payload" }, { status: 400 });
        const c = await importCase({
          name: body.case.name,
          notes: body.case.notes,
          entities: body.case.entities,
          edges: body.case.edges,
          snapshots: body.case.snapshots,
        });
        return NextResponse.json({ case: c });
      }
      case "merge": {
        if (!body.id || !body.sourceId) return NextResponse.json({ error: "Missing id/sourceId" }, { status: 400 });
        const c = await mergeCases(body.id, body.sourceId);
        return c ? NextResponse.json({ case: c }) : NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    // Log server-side; return a generic message so internal details (paths,
    // stack) never reach the client.
    console.error("[cases] request failed:", err);
    return NextResponse.json({ error: "Request failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const denied = guardLock(req);
  if (denied) return denied;

  // Wipe everything: all cases + the audit log ("delete my data").
  if (req.nextUrl.searchParams.get("all") === "1") {
    await deleteAllCases();
    await clearAudit();
    return NextResponse.json({ ok: true, wiped: "all" });
  }
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id or all=1" }, { status: 400 });
  const ok = await deleteCase(id);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
