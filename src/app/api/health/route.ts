import { NextResponse } from "next/server";
import { APP_VERSION } from "@/lib/version";

// Liveness/readiness probe for Docker, uptime monitors, and load balancers.
// Left unauthenticated by the proxy matcher so probes work even when the
// optional AUTH_PASSWORD gate is enabled. No secrets, no third-party calls.
// Deliberately does NOT expose the Node runtime version: this endpoint is
// reachable by anyone (even with the auth gate on), and the exact interpreter
// version only helps an attacker match the host to known runtime CVEs.

export const dynamic = "force-dynamic";

const startedAt = Date.now();

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    {
      status: "ok",
      name: "HEAVEN-GeoIntel",
      version: APP_VERSION,
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      authGate: Boolean(process.env.AUTH_PASSWORD),
      time: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
