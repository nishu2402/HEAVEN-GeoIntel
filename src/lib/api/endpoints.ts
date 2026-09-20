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
      "Probes the username catalog server-side and returns a per-site verdict. Sites that answer HTTP 200 for every handle are reported as `manual` and NEVER auto-claimed, so a nonexistent handle yields zero false positives. Nine platforms with keyless public JSON APIs additionally return a rich profile: GitHub, GitLab, Codeberg, Hacker News, Reddit, Bluesky, Mastodon, Chess.com and Lichess.",
    tag: "lookup",
    rateLimited: true,
    body: [
      {
        name: "username",
        type: "string",
        required: true,
        description: "Handle without a leading @. 2-40 chars: letters, digits, dot, underscore, hyphen.",
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
    path: "/api/wallet-lookup",
    method: "post",
    summary: "Crypto wallet OSINT lookup",
    description:
      "Detects the chain from the address and reads the public ledger: Bitcoin balance + activity from mempool.space, or Ethereum balance + transaction count from a public JSON-RPC. Keyless, factual, no false-positive surface.",
    tag: "lookup",
    rateLimited: true,
    body: [
      {
        name: "address",
        type: "string",
        required: true,
        description: "A Bitcoin (legacy/bech32) or Ethereum (0x…) address.",
        example: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      },
    ],
    responseDescription: "Chain, balance, activity and explorer pivots.",
    errors: [{ status: 400, description: "Not a recognised BTC or ETH address." }],
  },
  {
    path: "/api/hash-lookup",
    method: "post",
    summary: "File-hash / IOC OSINT lookup",
    description:
      "Detects the algorithm (MD5/SHA-1/SHA-256) and queries CIRCL hashlookup for known-software (NSRL) reputation. A hit clears the hash as catalogued benign software; a miss is reported as unknown, never as a detection, with malware-verdict engines offered as pivots. Keyless, no false-positive surface.",
    tag: "lookup",
    rateLimited: true,
    body: [
      {
        name: "hash",
        type: "string",
        required: true,
        description: "A 32-char MD5, 40-char SHA-1 or 64-char SHA-256 hex digest.",
        example: "8ed4b4ed952526d89899e723f3488de4",
      },
    ],
    responseDescription: "Algorithm, known-software reputation and verdict-engine pivots.",
    errors: [{ status: 400, description: "Not a recognised MD5, SHA-1 or SHA-256 hash." }],
  },
  {
    path: "/api/pwned-password",
    method: "post",
    summary: "Pwned Passwords range check (k-anonymity)",
    description:
      "Keyless password-exposure check. The browser hashes the password with SHA-1 and sends ONLY the first five hex characters of that digest; this relays the prefix to Have I Been Pwned's Pwned Passwords range endpoint and returns the raw suffix list for the client to match locally. The password and its full hash never reach the server, so no single password is identifiable here.",
    tag: "lookup",
    rateLimited: true,
    body: [
      {
        name: "prefix",
        type: "string",
        required: true,
        description: "The first five hex characters of the password's SHA-1 digest. Never the password or the full hash.",
        example: "5BAA6",
      },
    ],
    responseDescription: "`{ range }`: the raw Pwned Passwords body, one `SUFFIX:count` per line, matched client-side.",
    errors: [
      { status: 400, description: "The prefix is not exactly five hex characters." },
      { status: 502, description: "The Pwned Passwords range endpoint was unreachable or rate-limiting." },
    ],
  },
  {
    path: "/api/bulk-lookup",
    method: "post",
    summary: "Start a bulk triage job",
    description:
      "Queues a job that runs the REAL lookup for every row, in any mode. `items` may mix identifiers and be classified per row with `mode: \"auto\"`. Returns a job id immediately; poll GET for progress. The original phone-only `numbers` array is still accepted.",
    tag: "lookup",
    rateLimited: true,
    body: [
      {
        name: "items",
        type: "array",
        items: "string",
        description: "Identifiers to look up. Any mode, mixed freely.",
        example: ["wordpress.org", "security@example.com", "+14155552671"],
      },
      {
        name: "mode",
        type: "string",
        description: "Force one mode, or classify each row on its own with \"auto\".",
        enum: ["auto", "phone", "email", "username", "ip", "domain", "wallet", "hash"],
        example: "auto",
      },
      {
        name: "numbers",
        type: "array",
        items: "string",
        description: "Phone numbers, the pre-3.2 form of this endpoint.",
        example: ["+14155552671"],
      },
    ],
    responseDescription: "The job id, its row count, and any rows that could not be classified into a lookup mode.",
    errors: [{ status: 400, description: "Neither items nor numbers, an empty list, or nothing classifiable." }],
  },
  {
    path: "/api/bulk-lookup",
    method: "get",
    summary: "Bulk job progress",
    description: "Rows completed so far, streaming in as the job runs. `format=csv` returns the same rows as CSV.",
    tag: "lookup",
    query: [
      { name: "id", description: "Job id returned by POST.", required: true, example: "0f2c…" },
      { name: "format", description: "`csv` for a spreadsheet download instead of JSON.", example: "csv" },
    ],
    responseDescription: "Job state, progress counters and the rows finished so far.",
    errors: [{ status: 404, description: "No job with that id (they are kept for 30 minutes after finishing)." }],
  },
  {
    path: "/api/bulk-lookup",
    method: "delete",
    summary: "Stop a bulk job",
    description: "Stops a running job. Rows already finished stay readable.",
    tag: "lookup",
    query: [{ name: "id", description: "Job id to stop.", required: true }],
    responseDescription: "The job id and its new state.",
    errors: [{ status: 404, description: "No running job with that id." }],
  },
  {
    path: "/api/username-sweep",
    method: "post",
    summary: "Deep username sweep (paged)",
    description:
      "Checks the WhatsMyName catalog against each site's own four-field detection contract (status AND body marker, in both directions). Paged: walk `offset` until `nextOffset` is null. Validated sites only by default.",
    tag: "lookup",
    rateLimited: true,
    body: [
      { name: "username", type: "string", required: true, description: "The handle to check.", example: "torvalds" },
      { name: "offset", type: "integer", description: "Where to resume in the catalog.", example: 60 },
      { name: "limit", type: "integer", description: "Sites per page (max 80).", example: 60 },
      {
        name: "includeUnvalidated",
        type: "boolean",
        description: "Also probe sites whose detection markers failed the last validation run.",
        example: false,
      },
    ],
    responseDescription: "One page of results, each found / notfound / unknown, with the paging cursor.",
    errors: IDENTIFIER_ERRORS,
  },
  {
    path: "/api/typosquat-scan",
    method: "post",
    summary: "Resolve look-alike domains",
    description:
      "Generates typosquat and IDN homoglyph candidates for a domain and resolves every one over DNS-over-HTTPS, then adds an RDAP registration date for the first few that resolve.",
    tag: "lookup",
    rateLimited: true,
    body: [
      { name: "domain", type: "string", required: true, description: "The domain to protect.", example: "example.com" },
      { name: "limit", type: "integer", description: "Candidates to resolve (max 300).", example: 200 },
    ],
    responseDescription: "Only the candidates that resolve, with addresses, MX and registration age.",
    errors: IDENTIFIER_ERRORS,
  },
  {
    path: "/api/evidence",
    method: "get",
    summary: "Read a case's evidence locker",
    description:
      "The manifest of preserved lookup responses for one case, each with the SHA-256 recorded when it was captured. With `id`, returns that artifact's exact bytes.",
    tag: "cases",
    query: [
      { name: "caseId", description: "Case whose locker to read.", required: true },
      { name: "id", description: "Artifact id, to fetch its bytes verbatim." },
    ],
    responseDescription: "The manifest, or one artifact's stored JSON.",
    errors: [{ status: 404, description: "No such artifact." }],
  },
  {
    path: "/api/evidence",
    method: "post",
    summary: "Preserve or verify evidence",
    description:
      "`capture` stores a lookup response under the hash of its own bytes. `verify` recomputes every hash in the case and reports which artifacts still match.",
    tag: "cases",
    rateLimited: true,
    body: [
      { name: "action", type: "string", required: true, description: "capture or verify.", enum: ["capture", "verify"] },
      { name: "caseId", type: "string", required: true, description: "The case to write to or verify." },
      { name: "mode", type: "string", description: "Lookup mode the artifact came from.", example: "domain" },
      { name: "identifier", type: "string", description: "The identifier that was looked up." },
      { name: "note", type: "string", description: "Why this was preserved." },
      { name: "payload", type: "object", description: "The lookup response, exactly as the API returned it." },
    ],
    responseDescription: "The manifest entry, or the verification result for every artifact.",
    errors: [{ status: 413, description: "The artifact is larger than the store's limit." }],
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
      "Returns a map of key name to where it is configured: \"ui\", \"env\" or null. Key VALUES are never returned by any endpoint.",
    tag: "config",
    responseDescription: "`{ keys, names }`: provenance map plus the allow-list of key names.",
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
  {
    path: "/api/notable-breaches",
    method: "get",
    summary: "Notable breaches reference (institutional, keyless)",
    description:
      "The vendored Wikipedia notable-breaches tier: the largest documented government and institutional data breaches, by record count, read straight from the bundled snapshot. Each row carries a record count and year only, describes an incident the credential indexes never hold, and asserts nothing about any identifier. It is a browsable reference, not a presence check.",
    tag: "config",
    responseDescription: "`{ source, version, count, breaches }`, largest first.",
  },
  {
    path: "/api/ai-analyst",
    method: "get",
    summary: "Which AI providers can run on this instance, and which models they offer",
    description:
      "Reports, per provider, whether it would run right now: the local Ollama server is probed for the models it actually has, and each cloud provider is checked for a saved or environment key. Key PRESENCE and its origin (\"ui\" or \"env\") are reported; a key value never is. The panel uses this to select a provider that works instead of opening on one that needs installing. With `?models=<provider>` it instead asks that cloud provider which models its configured key may call, filtered to the ones that can answer a text prompt and ordered with the vetted defaults first. That list is asked for rather than compiled in, because a shipped list goes stale: every Gemini model this app once suggested has since been withdrawn, and the panel offered names the provider answers with a 404.",
    tag: "config",
    query: [
      { name: "models", description: "Ask this cloud provider (openai, anthropic, gemini, groq, deepseek, mistral, openrouter) for the models its saved or environment key may call, instead of the readiness report. Ollama is not accepted: its installed models already come back with the readiness report.", example: "gemini" },
    ],
    responseDescription: "`{ providers, recommended, ollamaRunning }`, providers local-first; or `{ models, error? }` with `?models=`.",
  },
  {
    path: "/api/ai-analyst",
    method: "post",
    summary: "Optional AI-analyst relay (Ollama or bring-your-own cloud key)",
    description:
      "Forwards a strictly grounded prompt, built by the browser from a finished analysis, to a language model and returns the raw completion. A local Ollama server is preferred when one is running, so nothing leaves the machine; a cloud provider is opt-in. Its key is resolved in one order: the key in this request body (pasted in the panel, used once, never stored or logged), then a key saved from the panel into the key store, then the server environment (OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY / GROQ_API_KEY / DEEPSEEK_API_KEY / MISTRAL_API_KEY / OPENROUTER_API_KEY). The audit records the provider name only (salted and hashed like every other target) with the status the run actually returned, never the prompt, the subject, or the key. Failures are reported by cause rather than all as 502: a key or model the operator can correct is a 400 carrying the provider's own explanation, a provider that is rate-limiting or overloaded passes its 429 or 503 through, and only an unreachable or unusable provider is a 502. The client re-validates every identifier the model emits before rendering it, so a hallucinated value is surfaced as unverified rather than trusted.",
    tag: "config",
    rateLimited: true,
    body: [
      { name: "provider", type: "string", required: true, enum: ["ollama", "openai", "anthropic", "gemini", "groq", "deepseek", "mistral", "openrouter"], description: "Which model backend to use.", example: "ollama" },
      { name: "model", type: "string", required: true, description: "Model name for the chosen provider.", example: "llama3.2" },
      { name: "system", type: "string", required: true, description: "The grounding system prompt built client-side." },
      { name: "user", type: "string", required: true, description: "The serialised evidence bundle built client-side." },
      { name: "apiKey", type: "string", required: false, description: "Optional bring-your-own key for the chosen cloud provider, entered in the panel. Sent only in this request body, used once, never stored or logged; when omitted the relay falls back to a key saved through /api/keys, then to the server env var. Ignored for Ollama." },
    ],
    responseDescription: "`{ text }`: the model's raw completion, validated and narrated on the client.",
    errors: [
      { status: 400, description: "Malformed body, or a setup problem the caller can fix: no key configured for the chosen provider, a key the provider rejected, or a model the key cannot call (retired, renamed, or not offered on this tier). The provider's own sentence about the refusal is appended, since it usually names the fix." },
      { status: 502, description: "The provider was unreachable or answered with nothing usable. An answer cut off at the model's token ceiling, or blocked by the provider's safety filter, says which of the two it was." },
      { status: 503, description: "The provider is overloaded. Unlike a 502 this is neither the key nor the model, and the same request usually succeeds shortly after." },
    ],
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
    path: "/api/version",
    method: "get",
    summary: "Update check against the latest GitHub release",
    description:
      "Compares this build's version with the latest published release of the project on GitHub and reports whether a newer version is available. The result is cached for an hour, so a busy instance makes at most one third-party call per hour; `?force=1` bypasses the cache for a manual check. It never invents a version and never reports an update that does not exist: a missing release, a rate limit or an offline host all return `ok:false` with `updateAvailable:false`.",
    tag: "meta",
    query: [{ name: "force", description: "Set to 1 to bypass the one-hour cache and check immediately.", example: "1" }],
    responseDescription: "`{ current, latest, updateAvailable, url, publishedAt, checkedAt, ok, reason? }`.",
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
