import { NextResponse } from "next/server";

// ── OpenAPI 3.1 spec served at /api/docs ────────────────────────────────────
// Curl: curl -s http://localhost:3000/api/docs | jq .
// Import this URL into Postman / Insomnia / Swagger UI to get an interactive
// playground without us bundling a heavyweight UI library.

const OPENAPI = {
  openapi: "3.1.0",
  info: {
    title: "HEAVEN-GeoIntel API",
    description:
      "Phone + Email OSINT intelligence platform. Returns publicly-derivable metadata only — never real-time location or device tracking.",
    version: "1.3.0",
    contact: {
      name: "HEAVEN-GeoIntel maintainers",
      url:  "https://github.com/nishu2402/HEAVEN-GeoIntel",
    },
    license: {
      name: "MIT (with OSINT acceptable-use policy)",
      url:  "https://github.com/nishu2402/HEAVEN-GeoIntel/blob/main/LICENSE",
    },
    // ReDoc/Scalar render this in the spec's masthead; ignored by tools that
    // don't know the extension, so it costs nothing where it isn't supported.
    "x-logo": {
      url: "/brand/mark.png",
      altText: "HEAVEN-GeoIntel",
      backgroundColor: "#05060d",
    },
  },
  servers: [
    { url: "/", description: "Same host as the running instance" },
  ],
  paths: {
    "/api/lookup": {
      post: {
        summary: "Phone-number OSINT lookup",
        description:
          "Parses the phone number, runs offline analysis (libphonenumber, NPA, country dataset, Hudson Rock infostealer search), and fans out to configured paid APIs in parallel. Always returns 200 with partial data on third-party failure.",
        tags: ["lookup"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["number"],
                properties: {
                  number: {
                    type: "string",
                    description: "Phone number in any libphonenumber-parseable format (E.164 preferred).",
                    example: "+14155552671",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Lookup succeeded (possibly with some sources unavailable)",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/LookupResponse" },
              },
            },
          },
          "400": { description: "Invalid or missing phone number" },
          "429": {
            description: "Rate-limit exceeded",
            headers: {
              "Retry-After": { schema: { type: "integer" } },
            },
          },
        },
      },
    },
    "/api/email-lookup": {
      post: {
        summary: "Email-address OSINT lookup",
        description:
          "Offline email analysis (disposable detection, provider classification, name inference) plus parallel calls to Gravatar, XposedOrNot, EmailRep, and any configured paid sources.",
        tags: ["lookup"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email"],
                properties: {
                  email: { type: "string", format: "email", example: "test@example.com" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Lookup succeeded" },
          "400": { description: "Invalid email" },
          "429": { description: "Rate-limit exceeded" },
        },
      },
    },
    "/api/docs": {
      get: {
        summary: "This OpenAPI document",
        tags: ["meta"],
        responses: {
          "200": {
            description: "Returns this OpenAPI 3.1 spec as JSON",
            content: { "application/json": {} },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      LookupResponse: {
        type: "object",
        description: "Top-level response returned by /api/lookup.",
        properties: {
          input: {
            type: "object",
            properties: {
              raw:                 { type: "string", example: "+14155552671" },
              e164:                { type: "string", example: "+14155552671" },
              national:            { type: "string", example: "(415) 555-2671" },
              country:             { type: "string", example: "US" },
              countryCallingCode:  { type: "string", example: "+1" },
              isValid:             { type: "boolean" },
              isPossible:          { type: "boolean" },
              type:                { type: "string", nullable: true, example: "FIXED_LINE_OR_MOBILE" },
            },
          },
          threatScore: { type: "integer", minimum: 0, maximum: 100, example: 25 },
          threatLabel: { type: "string", enum: ["CLEAN", "LOW RISK", "MODERATE", "HIGH RISK", "CRITICAL"] },
          aggregated: {
            type: "object",
            description: "Best-pick merged view across all sources. Nullable fields stay null when no source confirmed the value.",
          },
          offline: {
            type: "object",
            description: "Offline reputation derived from number structure — no API.",
            properties: {
              confidence:      { type: "string", enum: ["high", "medium", "low"] },
              inferredCarrier: { type: "string", nullable: true },
              signals:         { type: "array", items: { type: "string" } },
            },
          },
          sources: {
            type: "object",
            description: "Per-source raw responses. Each is `{ ok: boolean, data?, error? }`. error=\"NOT_CONFIGURED\" means the env var for that source is missing.",
            properties: {
              numverify:       { $ref: "#/components/schemas/SourceResult" },
              ipqs:            { $ref: "#/components/schemas/SourceResult" },
              abstract:        { $ref: "#/components/schemas/SourceResult" },
              twilio:          { $ref: "#/components/schemas/SourceResult" },
              breachDirectory: { $ref: "#/components/schemas/SourceResult" },
              fullContact:     { $ref: "#/components/schemas/SourceResult" },
              hudsonRock:      { $ref: "#/components/schemas/SourceResult" },
            },
          },
          cachedAt: { type: "integer", nullable: true, description: "Epoch ms if served from cache" },
        },
      },
      SourceResult: {
        type: "object",
        properties: {
          ok:    { type: "boolean" },
          data:  { description: "Source-specific payload, present when ok=true" },
          error: { type: "string", nullable: true, description: "Reason string; common: NOT_CONFIGURED, RATE_LIMITED, NOT_FOUND" },
        },
      },
    },
  },
  tags: [
    { name: "lookup", description: "OSINT lookup endpoints" },
    { name: "meta",   description: "API metadata" },
  ],
};

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(OPENAPI, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
