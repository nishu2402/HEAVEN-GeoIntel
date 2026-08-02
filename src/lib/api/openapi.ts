// ── OpenAPI 3.1 spec generator ───────────────────────────────────────────────
// Builds the document served at /api/docs from the endpoint registry plus the
// source manifest. Nothing here is hand-maintained per-route, so the spec
// cannot fall behind the routes.

import { ENDPOINTS, type EndpointDef, type JsonField } from "./endpoints";
import { SOURCES } from "../sources/manifest";
import { rateLimitConfig } from "../server/config";
import { APP_VERSION } from "../version";


const REPO = "https://github.com/nishu2402/HEAVEN-GeoIntel";

type Json = Record<string, unknown>;

function fieldSchema(f: JsonField): Json {
  const base: Json = { type: f.type, description: f.description };
  if (f.items) base.items = { type: f.items };
  if (f.enum) base.enum = f.enum;
  if (f.example !== undefined) base.example = f.example;
  return base;
}

function requestBody(fields: JsonField[]): Json {
  const properties: Json = {};
  const required: string[] = [];
  for (const f of fields) {
    properties[f.name] = fieldSchema(f);
    if (f.required) required.push(f.name);
  }
  return {
    required: required.length > 0,
    content: {
      "application/json": {
        /* v8 ignore next -- every registered body currently has at least one
           required field; the guard exists so an all-optional body would emit a
           valid schema rather than `required: []`. */
        schema: { type: "object", ...(required.length ? { required } : {}), properties },
      },
    },
  };
}

const RATE_LIMIT_HEADERS: Json = {
  "X-RateLimit-Limit": { schema: { type: "integer" }, description: "Requests allowed in the current window." },
  "X-RateLimit-Remaining": { schema: { type: "integer" }, description: "Requests left in the current window." },
  "X-RateLimit-Window": { schema: { type: "string" }, description: 'Window length, e.g. "60s".' },
  "X-RateLimit-Scope": {
    schema: { type: "string", enum: ["client", "global"] },
    description: "Which limit is binding — this client, or the server-wide ceiling.",
  },
};

function operation(e: EndpointDef): Json {
  const responses: Json = {
    "200": {
      description: e.responseDescription,
      ...(e.rateLimited ? { headers: RATE_LIMIT_HEADERS } : {}),
      content: {
        "application/json": {
          schema: e.responseSchema
            ? { $ref: `#/components/schemas/${e.responseSchema}` }
            : { type: "object" },
        },
      },
    },
  };

  for (const err of e.errors ?? []) {
    responses[String(err.status)] = {
      description: err.description,
      content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
    };
  }

  if (e.rateLimited) {
    responses["429"] = {
      description: "Rate limit exceeded. Retry after the window resets.",
      headers: {
        ...RATE_LIMIT_HEADERS,
        "Retry-After": { schema: { type: "integer" }, description: "Seconds until the window resets." },
      },
      content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
    };
  }

  return {
    summary: e.summary,
    description: e.description,
    tags: [e.tag],
    operationId: `${e.method}${e.path.replace(/[^a-zA-Z0-9]+(.)/g, (_, c: string) => c.toUpperCase())}`,
    ...(e.query
      ? {
          parameters: e.query.map((q) => ({
            name: q.name,
            in: "query",
            required: Boolean(q.required),
            description: q.description,
            /* v8 ignore next -- every registered query param supplies an
               example; the guard keeps the schema valid if one ever doesn't. */
            schema: { type: "string", ...(q.example ? { example: q.example } : {}) },
          })),
        }
      : {}),
    ...(e.body ? { requestBody: requestBody(e.body) } : {}),
    responses,
  };
}

const SCHEMAS: Json = {
  Error: {
    type: "object",
    properties: {
      error: { type: "string", description: "Human-readable failure reason." },
      retryAfter: { type: "integer", description: "Seconds to wait, on a 429." },
    },
  },
  SourceResult: {
    type: "object",
    description: "Raw payload from one source.",
    properties: {
      ok: { type: "boolean" },
      data: { description: "Source-specific payload, present when ok=true." },
      error: {
        type: "string",
        description: 'Reason string. Common values: NOT_CONFIGURED, RATE_LIMITED, NOT_FOUND, "timed out".',
      },
    },
  },
  SourceProvenance: {
    type: "object",
    description:
      "Uniform per-source outcome, emitted by every lookup mode under `sourceHealth` so one consumer can render source health for any mode.",
    properties: {
      source: { type: "string", description: "Source id, matching an id in /api/sources." },
      ok: { type: "boolean", description: "Did the source answer?" },
      ms: { type: "integer", description: "Round-trip time in milliseconds." },
      fetchedAt: { type: "integer", description: "Epoch ms when the call completed." },
      error: { type: "string", description: "Reason, when ok=false." },
      skipped: {
        type: "boolean",
        description: "True when the source was never called because its key isn't configured — not an outage.",
      },
    },
  },
  LookupResponse: {
    type: "object",
    description: "Phone lookup result.",
    properties: {
      input: { type: "object", description: "Normalised input: raw, e164, national, country, validity." },
      analysis: { type: "object", description: "Offline structural analysis (libphonenumber + NPA + carrier prefix)." },
      countryIntel: { type: "object", description: "Country dataset entry, or null." },
      offline: { type: "object", description: "Reputation derived purely from number structure — never an API." },
      sources: {
        type: "object",
        description: "Per-source raw responses, keyed by source id. Each is a SourceResult.",
        additionalProperties: { $ref: "#/components/schemas/SourceResult" },
      },
      sourceHealth: { type: "array", items: { $ref: "#/components/schemas/SourceProvenance" } },
      aggregated: { type: "object", description: "Best-effort merge across sources. A null field means no source supplied it — never a guess." },
      threatScore: { type: "integer", description: "0–100 unified score." },
      threatLabel: { type: "string", description: "CLEAN | LOW RISK | MODERATE | HIGH RISK | CRITICAL." },
      cachedAt: { type: "integer", description: "Epoch ms if served from cache." },
    },
  },
  EmailLookupResponse: {
    type: "object",
    properties: {
      email: { type: "string" },
      analysis: { type: "object", description: "Provider classification, disposable/role flags, guessed name." },
      gravatar: { type: "object", description: "Public Gravatar profile; `found: false` when there is none." },
      emailrep: { $ref: "#/components/schemas/SourceResult" },
      hunter: { $ref: "#/components/schemas/SourceResult" },
      abstract: { $ref: "#/components/schemas/SourceResult" },
      xon: { $ref: "#/components/schemas/SourceResult" },
      breachDirectory: { $ref: "#/components/schemas/SourceResult" },
      fullContact: { $ref: "#/components/schemas/SourceResult" },
      sourceHealth: { type: "array", items: { $ref: "#/components/schemas/SourceProvenance" } },
    },
  },
  UsernameLookupResponse: {
    type: "object",
    properties: {
      username: { type: "string" },
      checked: { type: "integer", description: "Sites auto-verified. Excludes `manual` sites." },
      found: { type: "integer", description: "Confirmed registrations. Zero false positives by construction." },
      manual: { type: "integer", description: "Sites that cannot be verified server-side; returned as links to open yourself." },
      hits: {
        type: "array",
        description: "Per-site verdict.",
        items: {
          type: "object",
          properties: {
            site: { type: "string" },
            category: { type: "string" },
            url: { type: "string" },
            status: { type: "string", enum: ["found", "notfound", "manual", "unknown"] },
            httpStatus: { type: "integer" },
          },
        },
      },
      profiles: { type: "array", items: { type: "object" }, description: "Rich API-verified profiles." },
      identity: { type: "object", description: "Name / location / avatar candidates synthesised from profiles." },
      pivots: { type: "array", items: { type: "object" } },
      sourceHealth: { type: "array", items: { $ref: "#/components/schemas/SourceProvenance" } },
    },
  },
  IpLookupResponse: {
    type: "object",
    properties: {
      input: { type: "string" },
      ip: { type: "object", description: "Geo, ASN, ISP, ports, CVEs, GreyNoise classification. Null on failure." },
      classification: { type: "object", description: "Present for private / loopback / reserved ranges, which are never sent upstream." },
      pivots: { type: "array", items: { type: "object" } },
      threatScore: { type: "integer" },
      threatLabel: { type: "string" },
      sources: { type: "array", items: { $ref: "#/components/schemas/SourceProvenance" }, description: "Alias of sourceHealth, kept for compatibility." },
      sourceHealth: { type: "array", items: { $ref: "#/components/schemas/SourceProvenance" } },
    },
  },
  DomainLookupResponse: {
    type: "object",
    properties: {
      domain: { type: "string" },
      isValid: { type: "boolean" },
      dns: { type: "object", description: "A, AAAA, MX, TXT, NS, CNAME record sets." },
      whois: { type: "object", description: "RDAP registration data, or null." },
      subdomains: { type: "array", items: { type: "string" }, description: "From certificate transparency." },
      emailSecurity: { type: "object", description: "SPF / DMARC / MX posture." },
      dnssec: { type: "boolean" },
      wayback: { type: "object", description: "Oldest archived snapshot, or null." },
      pivots: { type: "array", items: { type: "object" } },
      sourceHealth: { type: "array", items: { $ref: "#/components/schemas/SourceProvenance" } },
    },
  },
};

/** Build the full OpenAPI document for this build. */
export function buildOpenApiSpec(): Json {
  const rl = rateLimitConfig();
  const paths: Json = {};
  for (const e of ENDPOINTS) {
    const item = (paths[e.path] ??= {}) as Json;
    item[e.method] = operation(e);
  }

  const freeSources = SOURCES.filter((s) => s.tier === "free").map((s) => s.name);
  const keyedSources = SOURCES.filter((s) => s.tier === "key").map((s) => s.name);

  return {
    openapi: "3.1.0",
    info: {
      title: "HEAVEN-GeoIntel API",
      description: [
        "Unified OSINT console for phone, email, username, IP and domain identifiers.",
        "Returns publicly-derivable metadata only — never real-time location or device tracking.",
        "",
        `**Rate limiting.** ${rl.max} requests per ${Math.round(rl.windowMs / 1000)}s per client, with a server-wide ceiling of ${rl.globalMax}. Both are configurable via RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS and RATE_LIMIT_GLOBAL_MAX.`,
        "",
        `**Sources needing no key:** ${freeSources.join(", ")}.`,
        `**Sources unlocked by an optional key:** ${keyedSources.join(", ")}.`,
        "",
        "A source that is unreachable never fails a lookup — it is reported in `sourceHealth` and its fields come back null rather than fabricated.",
      ].join("\n"),
      version: APP_VERSION,
      contact: { name: "HEAVEN-GeoIntel maintainers", url: REPO },
      license: { name: "MIT (with OSINT acceptable-use policy)", url: `${REPO}/blob/main/LICENSE` },
      "x-logo": { url: "/brand/mark.png", altText: "HEAVEN-GeoIntel", backgroundColor: "#05060d" },
    },
    servers: [{ url: "/", description: "Same host as the running instance" }],
    paths,
    components: { schemas: SCHEMAS },
    tags: [
      { name: "lookup", description: "OSINT lookup endpoints — one per identifier type" },
      { name: "cases", description: "Investigation case store" },
      { name: "config", description: "Sources, API keys and runtime configuration" },
      { name: "meta", description: "API metadata and health" },
    ],
  };
}
