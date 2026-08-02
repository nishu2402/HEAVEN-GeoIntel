import { NextResponse } from "next/server";
import { buildOpenApiSpec } from "@/lib/api/openapi";

// ── OpenAPI 3.1 spec served at /api/docs ────────────────────────────────────
// Curl: curl -s http://localhost:3000/api/docs | jq .
// Import this URL into Postman / Insomnia / Swagger UI to get an interactive
// playground without us bundling a heavyweight UI library.
//
// The document is GENERATED from src/lib/api/endpoints.ts (and the source
// manifest) on every request, so it always describes the routes this build
// actually exposes — and it reflects the live rate limits rather than numbers
// baked in when the spec was written.

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(buildOpenApiSpec(), {
    headers: {
      // Generated per request and limit-dependent, so it must not be cached by
      // an intermediary the way the old static document could be.
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
