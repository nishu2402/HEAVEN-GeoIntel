import { NextRequest, NextResponse } from "next/server";
import { configuredMap, setKey, clearKey, clearAllKeys, KEY_NAMES } from "@/lib/server/keyStore";
import { readJsonCapped } from "@/lib/server/validation";
import { DEFAULT_MAX_BODY_BYTES } from "@/lib/server/bodyLimits";

// Manage optional provider API keys from the web UI. The store keeps values in
// .data/keys.json (0600, git-ignored); this endpoint ONLY ever returns a
// configured/source map — never a key value. Names are allow-listed.

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ keys: await configuredMap(), names: KEY_NAMES }, { headers: noStore });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Counted on the bytes rather than on Content-Length, which a chunked request
  // does not send at all. See bodyLimits.ts.
  const read = await readJsonCapped(req, DEFAULT_MAX_BODY_BYTES);
  if (!read.ok) {
    return read.tooLarge
      ? NextResponse.json({ error: "Request body too large" }, { status: 413, headers: noStore })
      : NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: noStore });
  }
  const body = read.json as { name?: unknown; value?: unknown };

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
