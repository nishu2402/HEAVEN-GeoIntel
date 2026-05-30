import { NextRequest, NextResponse } from "next/server";
import {
  listCases, createCase, deleteCase, renameCase, setCaseNotes, addEntity, removeEntity,
} from "@/lib/caseStore";
import type { EntityKind } from "@/lib/types";

// ── Investigation cases API (persistent, file-backed) ───────────────────────
// GET                          → list all cases
// POST { action, ... }         → create | rename | notes | addEntity | removeEntity
// DELETE ?id=...               → delete a case

const KINDS: EntityKind[] = ["phone", "email", "username", "ip", "domain"];

export async function GET(): Promise<NextResponse> {
  const cases = await listCases();
  return NextResponse.json({ cases }, { headers: { "Cache-Control": "no-store" } });
}

interface CaseAction {
  action: "create" | "rename" | "notes" | "addEntity" | "removeEntity";
  id?: string;
  name?: string;
  notes?: string;
  kind?: EntityKind;
  value?: string;
  note?: string;
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
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const ok = await deleteCase(id);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
