import { NextRequest, NextResponse } from "next/server";
import {
  listCases, createCase, deleteCase, deleteAllCases, renameCase, setCaseNotes,
  addEntity, removeEntity, importCase,
} from "@/lib/caseStore";
import { clearAudit } from "@/lib/auditLog";
import type { EntityKind, InvestigationCase } from "@/lib/types";

// ── Investigation cases API (persistent, file-backed) ───────────────────────
// GET                          → list all cases
// POST { action, ... }         → create | rename | notes | addEntity | removeEntity | import
// DELETE ?id=...               → delete a case
// DELETE ?all=1                → wipe ALL cases + audit log (delete my data)

const KINDS: EntityKind[] = ["phone", "email", "username", "ip", "domain"];

export async function GET(): Promise<NextResponse> {
  const cases = await listCases();
  return NextResponse.json({ cases }, { headers: { "Cache-Control": "no-store" } });
}

interface CaseAction {
  action: "create" | "rename" | "notes" | "addEntity" | "removeEntity" | "import";
  id?: string;
  name?: string;
  notes?: string;
  kind?: EntityKind;
  value?: string;
  note?: string;
  /** For action "import": a previously exported case payload. */
  case?: Partial<InvestigationCase>;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: CaseAction;
  try { body = (await req.json()) as CaseAction; }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

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
      case "import": {
        if (!body.case || typeof body.case !== "object") return NextResponse.json({ error: "Missing case payload" }, { status: 400 });
        const c = await importCase({
          name: body.case.name,
          notes: body.case.notes,
          entities: body.case.entities,
        });
        return NextResponse.json({ case: c });
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
