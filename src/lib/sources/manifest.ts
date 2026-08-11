// ── Source manifest — the single source of truth for data providers ──────────
//
// Every upstream this tool talks to is described here ONCE. Consumers derive
// their view of it rather than keeping a parallel copy:
//
//   • /api/sources   → configuration + last-observed runtime health
//   • /api/docs      → the source list embedded in the OpenAPI description
//   • SourcesPanel   → the in-app "Sources & keys" screen
//
// Adding a provider is a single entry here. Before this existed, the registry
// in /api/sources was a hand-maintained array that drifted from what the routes
// actually called.

import type { KeyName } from "../server/keyStore";
import type { Mode } from "../client/modes";

/** `free` needs no credentials; `key` is gated on one or more API keys. */
export type SourceTier = "free" | "key";

export interface SourceDef {
  /** Stable id — also the key used in a route's `sources` block. */
  id: string;
  name: string;
  tier: SourceTier;
  /** Env-var names that must ALL be set for a `key` source to be usable. */
  keys?: KeyName[];
  /** Which lookup modes call this source. */
  modes: Mode[];
  /** What an analyst gets from it — shown verbatim in the UI. */
  unlocks: string;
  /** Where to get credentials, for `key` sources. */
  signup?: string;
  /**
   * A fallback: called only when the preferred source for the same data is
   * unavailable, so a healthy lookup never reports it.
   *
   * Without this flag the alignment guard — "every source the manifest declares
   * must actually be reported" — has no way to tell a standby apart from a
   * source that was wired into the manifest and then forgotten in the route.
   * That guard is worth keeping strict, so the exception is declared here
   * rather than special-cased in the test.
   */
  standby?: boolean;
}

export const SOURCES: SourceDef[] = [
  // ── Always free, no key required ───────────────────────────────────────────
  {
    id: "hudsonRock",
    name: "Hudson Rock",
    tier: "free",
    // Phone AND email: the phone route uses Cavalier's search-by-username
    // endpoint, the email route its search-by-email endpoint. Both are keyless.
    modes: ["phone", "email"],
    unlocks: "Infostealer-malware exposure for a phone number or email",
  },
  {
    id: "leakCheck",
    name: "LeakCheck (public)",
    tier: "free",
    modes: ["phone", "email", "username"],
    unlocks: "Named breaches and exposed field types — no key, no credentials returned",
  },
  {
    id: "xon",
    name: "XposedOrNot",
    tier: "free",
    modes: ["email"],
    unlocks: "Email breach database — 1000+ sources",
  },
  {
    id: "gravatar",
    name: "Gravatar",
    tier: "free",
    modes: ["email"],
    unlocks: "Public profile + linked accounts for an email",
  },
  {
    id: "ip-api.com",
    name: "ip-api.com",
    tier: "free",
    modes: ["ip"],
    unlocks: "IP geolocation · ASN · ISP · reverse DNS · proxy/hosting flags",
  },
  {
    id: "ipwho.is",
    name: "ipwho.is",
    tier: "free",
    modes: ["ip"],
    standby: true,
    // Standby, not an extra fanout call: only reached when ip-api has spent its
    // 45-per-minute budget or is down. Narrower (no proxy/hosting/mobile flags
    // and no reverse DNS), which is why it is second — but a location from the
    // fallback beats a failed lookup from the preferred source.
    unlocks: "Backup IP geolocation · ASN · ISP — used when ip-api.com is rate-limited",
  },
  {
    id: "Shodan InternetDB",
    name: "Shodan InternetDB",
    tier: "free",
    modes: ["ip"],
    unlocks: "Open ports · known CVEs · hostnames · classifier tags",
  },
  {
    id: "GreyNoise Community",
    name: "GreyNoise Community",
    tier: "free",
    modes: ["ip"],
    unlocks: "Internet background-noise classification (benign / malicious)",
  },
  {
    id: "dns",
    name: "Cloudflare DNS-over-HTTPS",
    tier: "free",
    modes: ["domain"],
    unlocks: "A · AAAA · MX · TXT · NS · CNAME · DNSKEY records",
  },
  {
    id: "whois",
    name: "RDAP (rdap.org)",
    tier: "free",
    modes: ["domain"],
    unlocks: "Registrar · registration dates · nameservers · statuses",
  },
  {
    id: "subdomains",
    name: "Certificate Transparency (Certspotter · crt.sh)",
    tier: "free",
    modes: ["domain"],
    unlocks: "Subdomains observed in issued certificates",
  },
  {
    id: "wayback",
    name: "Internet Archive Wayback Machine",
    tier: "free",
    modes: ["domain"],
    unlocks: "Oldest archived snapshot of the domain",
  },
  {
    id: "usernameSweep",
    name: "Username site sweep",
    tier: "free",
    modes: ["username"],
    unlocks: "Where a handle is registered",
  },
  {
    id: "usernameProfiles",
    name: "GitHub · GitLab · Hacker News · Reddit APIs",
    tier: "free",
    modes: ["username"],
    unlocks: "Rich verified profiles: real name · join date · karma · repos",
  },

  // ── Optional keys (add in the app, or via .env.local) ──────────────────────
  {
    id: "ipqs",
    name: "IPQualityScore",
    tier: "key",
    keys: ["IPQS_API_KEY"],
    modes: ["phone"],
    unlocks: "Fraud score · VoIP · prepaid · active · city",
    signup: "https://www.ipqualityscore.com",
  },
  {
    id: "numverify",
    name: "NumVerify",
    tier: "key",
    keys: ["NUMVERIFY_API_KEY"],
    modes: ["phone"],
    unlocks: "Carrier + line type",
    signup: "https://numverify.com",
  },
  {
    id: "twilio",
    name: "Twilio Lookup",
    tier: "key",
    keys: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"],
    modes: ["phone"],
    unlocks: "Carrier · CNAM owner · MCC/MNC",
    signup: "https://www.twilio.com",
  },
  {
    id: "abstract",
    name: "AbstractAPI",
    tier: "key",
    keys: ["ABSTRACT_API_KEY"],
    modes: ["phone", "email"],
    unlocks: "Phone + email validation (SMTP/MX)",
    signup: "https://www.abstractapi.com",
  },
  {
    id: "hunter",
    name: "Hunter.io",
    tier: "key",
    keys: ["HUNTER_API_KEY"],
    modes: ["email"],
    unlocks: "Email deliverability + confidence",
    signup: "https://hunter.io",
  },
  {
    id: "emailrep",
    name: "EmailRep.io",
    tier: "key",
    keys: ["EMAILREP_API_KEY"],
    modes: ["email"],
    unlocks: "Reputation + breach flags (keyless tier is rate-limited to 429)",
    signup: "https://emailrep.io",
  },
  {
    id: "fullContact",
    name: "FullContact",
    tier: "key",
    keys: ["FULLCONTACT_API_KEY"],
    modes: ["phone", "email"],
    unlocks: "Real name · employer · social profiles",
    signup: "https://www.fullcontact.com",
  },
  {
    id: "breachDirectory",
    name: "BreachDirectory (RapidAPI)",
    tier: "key",
    keys: ["RAPIDAPI_KEY"],
    modes: ["phone", "email"],
    unlocks: "Real credential hashes (phone + email)",
    signup: "https://rapidapi.com/rohan-patra/api/breachdirectory",
  },
];

export const SOURCES_BY_ID: ReadonlyMap<string, SourceDef> = new Map(
  SOURCES.map((s) => [s.id, s])
);

/** Every source a given lookup mode fans out to. */
export function sourcesForMode(mode: Mode): SourceDef[] {
  return SOURCES.filter((s) => s.modes.includes(mode));
}

/** Display name for a source id, falling back to the id for unknown entries. */
export function sourceName(id: string): string {
  return SOURCES_BY_ID.get(id)?.name ?? id;
}
