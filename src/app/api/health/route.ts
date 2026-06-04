import { NextResponse } from "next/server";

// Liveness/readiness probe for Docker, uptime monitors, and load balancers.
// Left unauthenticated by the middleware matcher so probes work even when the
// optional AUTH_PASSWORD gate is enabled. No secrets, no third-party calls.

export const dynamic = "force-dynamic";

const startedAt = Date.now();

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    {
      status: "ok",
      name: "HEAVEN-GeoIntel",
      version: "1.3.0",
      node: process.version,
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      authGate: Boolean(process.env.AUTH_PASSWORD),
      time: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
