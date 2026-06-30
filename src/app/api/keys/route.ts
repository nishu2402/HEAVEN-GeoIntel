import { NextRequest, NextResponse } from "next/server";
import { configuredMap, setKey, clearKey, clearAllKeys, KEY_NAMES } from "@/lib/keyStore";

// Manage optional provider API keys from the web UI. The store keeps values in
// .data/keys.json (0600, git-ignored); this endpoint ONLY ever returns a
// configured/source map — never a key value. Names are allow-listed.

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ keys: await configuredMap(), names: KEY_NAMES }, { headers: noStore });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { name?: unknown; value?: unknown };
  try { body = (await req.json()) as typeof body; }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: noStore }); }

  if (typeof body.name !== "string" || typeof body.value !== "string") {
    return NextResponse.json({ error: "Expected { name, value }" }, { status: 400, headers: noStore });
  }
  const ok = await setKey(body.name, body.value);
  if (!ok) return NextResponse.json({ error: "Unknown key name or empty value" }, { status: 400, headers: noStore });
  return NextResponse.json({ ok: true, keys: await configuredMap() }, { headers: noStore });
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  if (req.nextUrl.searchParams.get("all") === "1") {
    await clearAllKeys();
    return NextResponse.json({ ok: true, keys: await configuredMap() }, { headers: noStore });
  }
  const name = req.nextUrl.searchParams.get("name");
  if (!name) return NextResponse.json({ error: "Missing ?name= or ?all=1" }, { status: 400, headers: noStore });
  const ok = await clearKey(name);
  if (!ok) return NextResponse.json({ error: "Unknown key name" }, { status: 400, headers: noStore });
  return NextResponse.json({ ok: true, keys: await configuredMap() }, { headers: noStore });
}
