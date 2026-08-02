// ── API endpoint registry ────────────────────────────────────────────────────
//
// One declarative entry per HTTP operation the app exposes. The OpenAPI spec at
// /api/docs is GENERATED from this list, so it can no longer drift: before this
// existed the spec was hand-written and documented 3 of 11 endpoints while the
// README told people to import it into Postman.
//
// `tests/openapiCoverage.test.ts` walks src/app/api/**/route.ts, extracts the
// exported HTTP methods, and asserts this registry matches them EXACTLY. Adding
// a route without documenting it fails the build.

export type HttpMethod = "get" | "post" | "delete";

export interface JsonField {
  name: string;
  type: "string" | "integer" | "boolean" | "array" | "object";
  required?: boolean;
  description: string;
  example?: unknown;
  /** For `array`, the item type. */
  items?: "string" | "object";
  enum?: string[];
}

export interface QueryParam {
  name: string;
  description: string;
  required?: boolean;
  example?: string;
}

export interface EndpointDef {
  path: string;
  method: HttpMethod;
  summary: string;
  description: string;
  tag: "lookup" | "cases" | "config" | "meta";
  /** JSON request-body fields. Omit for GET/DELETE. */
  body?: JsonField[];
  query?: QueryParam[];
  /** Named response schema in components, when one is defined. */
  responseSchema?: string;
  responseDescription: string;
  /** Documented non-200 outcomes beyond the shared 400/429. */
  errors?: { status: number; description: string }[];
  /** True when the route consumes rate-limit quota (adds 429 + headers). */
  rateLimited?: boolean;
}

const IDENTIFIER_ERRORS = [{ status: 400, description: "Missing or malformed identifier." }];

export const ENDPOINTS: EndpointDef[] = [
  // ── Lookup modes ───────────────────────────────────────────────────────────
  {
    path: "/api/lookup",
    method: "post",
    summary: "Phone-number OSINT lookup",
    description:
      "Parses the phone number, runs offline analysis (libphonenumber, NPA, country dataset), and fans out to Hudson Rock plus any configured paid APIs in parallel. Always returns 200 with partial data on third-party failure.",
    tag: "lookup",
    rateLimited: true,
    body: [
      {
        name: "number",
        type: "string",
        required: true,
        description: "Phone number in any libphonenumber-parseable format (E.164 preferred).",
        example: "+14155552671",
      },
    ],
    responseSchema: "LookupResponse",
    responseDescription: "Full phone intelligence report.",
    errors: IDENTIFIER_ERRORS,
  },
  {
    path: "/api/email-lookup",
    method: "post",
    summary: "Email OSINT lookup",
    description:
      "Classifies the address (provider type, disposable, role account), then queries Gravatar, XposedOrNot and any configured keyed sources in parallel.",
    tag: "lookup",
    rateLimited: true,
    body: [
      {
        name: "email",
        type: "string",
        required: true,
        description: "Email address to investigate.",
        example: "target@example.com",
      },
    ],
    responseSchema: "EmailLookupResponse",
    responseDescription: "Email analysis, breach exposure and profile data.",
    errors: IDENTIFIER_ERRORS,
  },
  {
    path: "/api/username-lookup",
    method: "post",
    summary: "Username sweep across social platforms",
    description:
      "Probes the username catalog server-side and returns a per-site verdict. Sites that answer HTTP 200 for every handle are reported as `manual` and NEVER auto-claimed, so a nonexistent handle yields zero false positives. Four platforms with public JSON APIs additionally return a rich profile.",
    tag: "lookup",
    rateLimited: true,
    body: [
      {
        name: "username",
        type: "string",
        required: true,
        description: "Handle without a leading @. 2–40 chars: letters, digits, dot, underscore, hyphen.",
        example: "torvalds",
      },
    ],
    responseSchema: "UsernameLookupResponse",
    responseDescription: "Per-site verdicts, rich profiles and derived identity signals.",
    errors: IDENTIFIER_ERRORS,
  },
  {
    path: "/api/ip-lookup",
    method: "post",
    summary: "IP address OSINT lookup",
    description:
      "Geolocation, ASN and ISP from ip-api, open ports and CVEs from Shodan InternetDB, and scanner classification from GreyNoise. Private, loopback and reserved ranges are classified locally and never forwarded upstream.",
    tag: "lookup",
    rateLimited: true,
    body: [
      {
        name: "ip",
        type: "string",
        required: true,
        description: "IPv4 or IPv6 address.",
        example: "8.8.8.8",
      },
    ],
    responseSchema: "IpLookupResponse",
    responseDescription: "Network intelligence with per-source provenance.",
    errors: IDENTIFIER_ERRORS,
  },
  {
    path: "/api/domain-lookup",
    method: "post",
    summary: "Domain OSINT lookup",
    description:
      "DNS records over Cloudflare DoH, registration data over RDAP, subdomains from certificate transparency, plus SPF/DMARC/DNSSEC posture and the oldest Wayback snapshot.",
    tag: "lookup",
    rateLimited: true,
    body: [
      {
        name: "domain",
        type: "string",
        required: true,
        description: "Bare domain or full URL; scheme, path, port and leading www. are stripped.",
        example: "example.com",
      },
    ],
    responseSchema: "DomainLookupResponse",
    responseDescription: "DNS, WHOIS, subdomains and email-security posture.",
    errors: IDENTIFIER_ERRORS,
  },
  {
    path: "/api/bulk-lookup",
    method: "post",
    summary: "Bulk phone triage",
    description:
      "Offline analysis for many numbers at once, suitable for CSV export. Deliberately does NOT fan out to paid APIs per row — it uses offline analysis plus any result already in the cache.",
    tag: "lookup",
    rateLimited: true,
    body: [
      {
        name: "numbers",
        type: "array",
        items: "string",
        required: true,
        description: "Phone numbers to triage.",
        example: ["+14155552671", "+447911123456"],
      },
    ],
    responseDescription: "Flat rows of offline analysis, one per input number.",
    errors: [{ status: 400, description: "Empty array, or more entries than the bulk limit." }],
  },

  // ── Cases ──────────────────────────────────────────────────────────────────
  {
    path: "/api/cases",
    method: "get",
    summary: "List investigation cases",
    description: "Returns every case in the file-backed store, newest first.",
    tag: "cases",
    responseDescription: "Array of cases with their entities and notes.",
  },
  {
    path: "/api/cases",
    method: "post",
    summary: "Mutate an investigation case",
    description:
      "Single write endpoint for cases; the `action` field selects the operation. `create` needs `name`; `rename`/`notes`/`addEntity`/`removeEntity`/`merge` need `id`.",
    tag: "cases",
    body: [
      {
        name: "action",
        type: "string",
        required: true,
        enum: ["create", "rename", "notes", "addEntity", "removeEntity", "import", "merge"],
        description: "Which mutation to apply.",
        example: "create",
      },
      { name: "id", type: "string", description: "Target case id, for every action except create and import." },
      { name: "name", type: "string", description: "Case name, for create and rename." },
      { name: "notes", type: "string", description: "Free-text notes, for the notes action." },
      { name: "entity", type: "object", description: "`{ kind, value }` for addEntity / removeEntity." },
      { name: "payload", type: "object", description: "A previously exported case, for import." },
      { name: "sourceId", type: "string", description: "Case folded into `id` and then deleted, for merge." },
    ],
    responseDescription: "The updated case.",
    errors: [{ status: 400, description: "Unknown action, or missing field for the chosen action." }],
  },
  {
    path: "/api/cases",
    method: "delete",
    summary: "Delete an investigation case",
    description: "Removes one case and everything in it. Not recoverable.",
    tag: "cases",
    query: [{ name: "id", description: "Case id to delete.", required: true, example: "c_1a2b3c" }],
    responseDescription: "`{ ok: true }` once the case is gone.",
    errors: [{ status: 400, description: "Missing ?id=." }],
  },

  // ── Configuration ──────────────────────────────────────────────────────────
  {
    path: "/api/keys",
    method: "get",
    summary: "Which optional API keys are configured",
    description:
      "Returns a map of key name to where it is configured — \"ui\", \"env\" or null. Key VALUES are never returned by any endpoint.",
    tag: "config",
    responseDescription: "`{ keys, names }` — provenance map plus the allow-list of key names.",
  },
  {
    path: "/api/keys",
    method: "post",
    summary: "Store an optional API key",
    description:
      "Saves a provider key to .data/keys.json (mode 0600). The name must be in the allow-list. Storing a key invalidates every cached lookup, so the next lookup reflects the new key immediately.",
    tag: "config",
    body: [
      { name: "name", type: "string", required: true, description: "Allow-listed key name.", example: "IPQS_API_KEY" },
      { name: "value", type: "string", required: true, description: "The key value. Never echoed back." },
    ],
    responseDescription: "`{ ok: true, keys }` with the refreshed provenance map.",
    errors: [{ status: 400, description: "Unknown key name, empty value, or invalid JSON." }],
  },
  {
    path: "/api/keys",
    method: "delete",
    summary: "Remove a stored API key",
    description: "Deletes one key by name, or every key with ?all=1. Also invalidates the lookup caches.",
    tag: "config",
    query: [
      { name: "name", description: "Key name to remove.", example: "IPQS_API_KEY" },
      { name: "all", description: "Set to 1 to remove every stored key.", example: "1" },
    ],
    responseDescription: "`{ ok: true, keys }` with the refreshed provenance map.",
    errors: [{ status: 400, description: "Neither ?name= nor ?all=1 supplied, or unknown key name." }],
  },
  {
    path: "/api/datasets",
    method: "get",
    summary: "Bundled datasets and any runtime overlays",
    description:
      "Reports each bundled dataset (country intel, NPA, MCC/MNC, disposable domains, username sites) and whether an overlay from .data/datasets/ is installed, with its version and row count. Never returns dataset contents.",
    tag: "config",
    responseDescription: "`{ dir, datasets, warnings, usernameSites }`.",
  },
  {
    path: "/api/datasets",
    method: "post",
    summary: "Reload dataset overlays from disk",
    description:
      "Re-reads .data/datasets/ without restarting the process, so an updated area-code table or username catalog takes effect immediately. Returns the same report as GET.",
    tag: "config",
    responseDescription: "The refreshed dataset report.",
  },
  {
    path: "/api/sources",
    method: "get",
    summary: "Data sources, key status and observed health",
    description:
      "Every source this instance can query, whether its key is configured and how, plus what the source actually did on its last call (`lastSeen`). Also reports the live runtime limits.",
    tag: "config",
    responseDescription: "`{ sources, keyTotal, keyActive, runtime }`.",
  },

  // ── Meta ───────────────────────────────────────────────────────────────────
  {
    path: "/api/health",
    method: "get",
    summary: "Liveness probe",
    description:
      "Returns 200 with uptime and version. This is the one path excluded from the auth gate and the CSRF guard so container probes work without credentials.",
    tag: "meta",
    responseDescription: "`{ status, version, uptime }`.",
  },
  {
    path: "/api/docs",
    method: "get",
    summary: "This OpenAPI 3.1 specification",
    description:
      "The spec is generated from the endpoint registry at request time, so it always matches the routes this build actually exposes. Import the URL into Postman, Insomnia or Swagger UI.",
    tag: "meta",
    responseDescription: "An OpenAPI 3.1 document.",
  },
];
