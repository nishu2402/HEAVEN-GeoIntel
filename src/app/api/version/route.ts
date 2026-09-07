import { NextResponse } from "next/server";
import { getUpdateInfo } from "@/lib/server/updateCheck";

// ── Update check — is a newer release published? ─────────────────────────────
// Compares this build's version against the latest GitHub release and reports
// whether an update is available. The comparison and the one-hour cache live in
// updateCheck.ts; this route is the thin HTTP wrapper. `?force=1` bypasses the
// cache for the "Check for updates" button. Makes at most one third-party call
// an hour and never reports a false "update available".

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const force = new URL(req.url).searchParams.get("force") === "1";
  const info = await getUpdateInfo(force);
  return NextResponse.json(info, { headers: { "Cache-Control": "no-store" } });
}
