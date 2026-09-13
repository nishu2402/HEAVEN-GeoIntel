import type { PhoneAnalysis } from "./analysis/phoneAnalysis";
import type { Assignability } from "./analysis/phoneAssignability";
import type { CountryIntel } from "./data/countryIntel";
import type { OfflineReputation } from "./analysis/freePhoneIntel";
import type { IpClassification } from "./analysis/ipClassify";
import type { BreachAggregate } from "./analysis/breachAggregate";
import type { CredentialExposure } from "./analysis/credentialExposure";

export type { PhoneAnalysis, CountryIntel, OfflineReputation, IpClassification };
export type { BreachAggregate, CredentialExposure, Assignability };

export interface PhoneInputData {
  raw: string;
  e164: string;
  national: string;
  country: string;
  countryCallingCode: string;
  region: string | null;
  isValid: boolean;
  isPossible: boolean;
  type: string | null;
}

export interface SourceResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface NumVerifyData {
  valid: boolean;
  number: string;
  local_format: string;
  international_format: string;
  country_prefix: string;
  country_code: string;
  country_name: string;
  location: string;
  carrier: string;
  line_type: string;
}

export interface IpqsData {
  valid: boolean;
  fraud_score: number;
  recent_abuse: boolean;
  VOIP: boolean;
  prepaid: boolean;
  risky: boolean;
  active: boolean;
  carrier: string;
  line_type: string;
  country: string;
  city: string;
  region: string;
  timezone: string;
  formatted: string;
  local_format: string;
  dialing_code: number;
  active_status?: string;
  user_activity?: string;
  associated_email_addresses?: { status: string; emails: string[] };
  name: string;
  message: string;
  success: boolean;
}

export interface AbstractData {
  phone: string;
  valid: boolean;
  format: {
    local: string;
    international: string;
  };
  country: {
    code: string;
    name: string;
    prefix: string;
  };
  location: string;
  type: string;
  carrier: string;
}

export interface TwilioData {
  calling_country_code: string;
  country_code: string;
  phone_number: string;
  national_format: string;
  valid: boolean;
  validation_errors: string[] | null;
  caller_name: { caller_name: string | null; caller_type: string | null; error_code: string | null } | null;
  sim_swap: null;
  call_forwarding: null;
  live_activity: null;
  line_type_intelligence: {
    error_code: string | null;
    mobile_country_code: string | null;
    mobile_network_code: string | null;
    carrier_name: string | null;
    type: string | null;
  } | null;
  identity_match: null;
}

export interface AggregatedResult {
  carrier: string | null;
  lineType: string | null;
  typeDescription: string;
  country: string;
  countryName: string;
  region: string | null;
  timezone: string[] | null;
  utcOffsets: string[] | null;
  isValid: boolean;
  fraudScore: number | null;
  isVoip: boolean | null;
  isMobile: boolean | null;      // null = not confirmed, true = confirmed mobile, false = confirmed NOT mobile
  isFixedLine: boolean | null;
  isAmbiguousType: boolean;      // true when carrier cannot distinguish mobile vs landline from number structure
  isTollFree: boolean | null;
  isPremiumRate: boolean | null;
  isDisposable: boolean | null;
  isRisky: boolean | null;
  recentAbuse: boolean | null;
  carrierPrefix: string | null;
  areaCode: string | null;
  numberLength: number | null;
  formatE164: string;
  formatInternational: string;
  formatNational: string;
  formatRfc3966: string;
  // SIM & caller identity
  callerName: string | null;
  callerType: string | null;
  prepaid: boolean | null;
  active: boolean | null;
  activeStatus: string | null;
  userActivity: string | null;
  mobileCountryCode: string | null;
  mobileNetworkCode: string | null;
  associatedEmails: string[] | null;
  city: string | null;
}

// ── Hudson Rock infostealer search (free, no key) ────────────────────────────
// Hudson Rock's Cavalier "osint-tools/search-by-login" endpoint accepts any
// identifier (email, username, phone) and returns infostealer infections that
// captured that identifier.  Free, no API key.
export interface HudsonRockStealer {
  computerName: string | null;
  operatingSystem: string | null;
  malwareFamily: string | null;
  dateCompromised: string | null;
  ip: string | null;
  topPasswords: string[];      // observed paired credentials (first N)
  topLogins: string[];         // sites the credentials were used on
}

export interface HudsonRockData {
  /** total infections found (or zero) */
  total: number;
  /** detailed stealer hits, limited to N */
  stealers: HudsonRockStealer[];
  /** message returned by the API when nothing found */
  message?: string;
}

// ── LeakCheck public breach index (free, no key) ──────────────────────────────
// LeakCheck's *public* endpoint reports, for an email / phone / username, how
// many indexed breach records mention it, which field types were exposed, and
// the named source breaches. It never returns credentials — the paid tier does
// that — so what we render is exposure metadata only.
export interface LeakCheckSource {
  name: string;
  /** "YYYY-MM" when the breach is dated; null when the index has no date. */
  date: string | null;
}

export interface LeakCheckData {
  /** Number of indexed records mentioning the identifier. */
  found: number;
  /** Field types exposed across those records ("password", "address", …). */
  fields: string[];
  /** Named breaches the identifier appears in. */
  sources: LeakCheckSource[];
}

// ── ProxyNova COMB credential exposure (free, no key) ────────────────────────
// ProxyNova indexes the COMB compilation (billions of email:password pairs). The
// endpoint matches SUBSTRINGS, so a raw query returns unrelated logins — we keep
// only lines whose login is EXACTLY the queried email, which is the discipline
// that stops a fuzzy index from manufacturing a false positive. What survives is
// masked before it ever leaves the server: a count and masked previews, never a
// usable secret (the same rule Hudson Rock output follows).
export interface CombExposure {
  /** Exact-login pairs seen for this identifier — a floor, capped by the request. */
  pairs: number;
  /** Distinct passwords among those pairs — a floor. */
  distinctPasswords: number;
  /** True when the source truncated its response, so more may exist beyond it. */
  capped: boolean;
  /** Masked password previews — never a usable secret. */
  samples: string[];
}

export interface LookupResponse {
  input: PhoneInputData;
  analysis: PhoneAnalysis;
  countryIntel: CountryIntel | null;
  /** Offline reputation derived purely from number structure — never an API */
  offline: OfflineReputation;
  sources: {
    numverify: SourceResult<NumVerifyData>;
    ipqs: SourceResult<IpqsData>;
    abstract: SourceResult<AbstractData>;
    twilio: SourceResult<TwilioData>;
    breachDirectory: SourceResult<BreachDirectoryData>;
    fullContact: SourceResult<FullContactData>;
    hudsonRock: SourceResult<HudsonRockData>;
    leakCheck: SourceResult<LeakCheckData>;
  };
  /**
   * Uniform per-source provenance — the same shape every lookup mode emits, so
   * one UI component can render source health for any mode. `sources` above
   * carries the typed payloads; this carries only who answered and how fast.
   */
  sourceHealth?: SourceProvenance[];
  aggregated: AggregatedResult;
  /**
   * 0-100 ABUSE risk: fraud score, abuse reports, premium-rate billing, VOIP.
   * It no longer includes breach volume — that is `exposureScore`. Folding the
   * two together is what made a published switchboard read MODERATE because a
   * breach index held eleven records mentioning it.
   */
  threatScore: number;
  threatLabel: string;          // "CLEAN" | "LOW RISK" | "MODERATE" | "HIGH RISK" | "CRITICAL" | "NOT ASSIGNABLE"
  /** Why the abuse figure is what it is, one line per contributing signal. */
  threatReasons?: string[];
  /** 0-100 EXPOSURE: how much of this identifier is already public. */
  exposureScore?: number;
  exposureLabel?: string;       // "NONE OBSERVED" | "LIMITED" | "SIGNIFICANT" | "EXTENSIVE" | "NOT ASSESSED"
  exposureReasons?: string[];
  /**
   * Whether a subscriber can hold this number at all. When `assignable` is
   * false the breach and infostealer sources carry `NOT_ASSIGNABLE` instead of
   * results: those indexes answer for placeholder numbers, and attributing
   * someone else's leaked form field to this number would be a false positive.
   */
  assignability?: Assignability;
  /** Server-computed, catalog-enriched union across this mode's breach sources. */
  breachAggregate?: BreachAggregate;
  /** Fused credential-exposure + reuse assessment (COMB is email-only, so no pairs here). */
  credentialExposure?: CredentialExposure;
  cachedAt?: number;
}

export interface HistoryEntry {
  e164: string;
  country: string;
  countryCallingCode: string;
  timestamp: number;
  flagEmoji: string;
}

// ── BreachDirectory / FullContact types are declared in the email section below ──
// They are re-used by the phone lookup route for breach hash hits and person enrichment.

// ── Email OSINT types ──────────────────────────────────────────────────────────

export type EmailProviderType =
  | "free"        // Gmail, Outlook, Yahoo, etc.
  | "corporate"   // Custom domain / business
  | "educational" // .edu domains
  | "government"  // .gov / .mil domains
  | "privacy"     // ProtonMail, Tutanota, etc.
  | "disposable"  // Temp mail / throwaway
  | "unknown";

export interface EmailAnalysis {
  email: string;
  username: string;
  /** ASCII (punycode) domain — what the upstreams are actually asked about. */
  domain: string;
  /** Unicode spelling of `domain`, for display. Equal to it for an ASCII name. */
  domainUnicode: string;
  tld: string;
  isValidFormat: boolean;
  providerType: EmailProviderType;
  providerName: string;       // "Gmail", "ProtonMail", "Custom Corporate", etc.
  isDisposable: boolean;
  isWebmail: boolean;
  isPrivacyFocused: boolean;
  isRoleAddress: boolean;     // admin@, info@, support@, etc.
  guessedName: string | null; // best-effort name from username
}

export interface GravatarProfile {
  found: boolean;
  displayName: string | null;
  preferredUsername: string | null;
  aboutMe: string | null;
  currentLocation: string | null;
  profileUrl: string | null;
  thumbnailUrl: string | null;
  accounts: { shortname: string; username: string; url: string }[];
  verifiedAccounts: { serviceLabel: string; url: string }[];
}

export interface EmailRepData {
  email: string;
  reputation: string;
  suspicious: boolean;
  references: number;
  blacklisted: boolean;
  maliciousActivity: boolean;
  credentialsLeaked: boolean;
  dataBreach: boolean;
  firstSeen: string | null;
  lastSeen: string | null;
  domainExists: boolean;
  newDomain: boolean;
  freeProvider: boolean;
  disposable: boolean;
  deliverable: boolean;
  validMx: boolean;
  primaryMx: string | null;
  spam: boolean;
  spoofable: boolean;
  spfStrict: boolean;
  dmarc: boolean;
  profiles: string[];
}

export interface HunterData {
  result: string;         // "deliverable" | "undeliverable" | "risky" | "unknown"
  score: number;          // 0-100 confidence
  regexp: boolean;
  gibberish: boolean;
  disposable: boolean;
  webmail: boolean;
  mxRecords: boolean;
  smtpServer: boolean;
  smtpCheck: boolean;
  acceptAll: boolean;
  block: boolean;
}

export interface AbstractEmailData {
  email: string;
  autocorrect: string;
  deliverability: string;
  qualityScore: number;
  isValidFormat: boolean;
  isFreeEmail: boolean;
  isDisposableEmail: boolean;
  isRoleEmail: boolean;
  isCatchallEmail: boolean;
  isMxFound: boolean;
  isSmtpValid: boolean;
}

export interface XposedOrNotBreach {
  breach: string;
  xposedData: string[];         // ["Passwords", "Email Addresses", "Usernames", ...]
  xposedDate: string;           // "2013-10-04"
  xposedRecords: number;
  domain: string;
  passwordRisk: string;         // "ClearText" | "EasyToCrack" | "StrongHash" | "Unknown"
  verified: boolean;
}

export interface XposedOrNotData {
  breachCount: number;
  breaches: XposedOrNotBreach[];
  xposedDataTypes: string[];    // All unique data types across all breaches
  yearwiseDetails: Record<string, number>;
}

// ── Have I Been Pwned — per-account breaches (optional API key) ────────────────
// The keyless indexes (XposedOrNot, LeakCheck) each know a slice of the world;
// HIBP's per-account API knows the widest slice but requires a paid key. When a
// key is present these breaches join the unified union like any other source.
export interface HibpBreach {
  name: string;                 // machine name, e.g. "Adobe"
  title: string;                // display title, e.g. "Adobe"
  domain: string;               // "adobe.com" (may be "")
  breachDate: string;           // "2013-10-04"
  pwnCount: number;             // accounts exposed
  dataClasses: string[];        // ["Email addresses", "Passwords", ...]
  verified: boolean;            // HIBP's IsVerified flag
}

export interface HibpData {
  breachCount: number;
  breaches: HibpBreach[];
}

// ── FullContact person enrichment ─────────────────────────────────────────────

export interface FullContactSocialProfile {
  platform: string;    // "LinkedIn", "Twitter", "GitHub", etc.
  url: string;
  username: string;
}

export interface FullContactEmployment {
  name: string;
  title: string | null;
  current: boolean;
}

export interface FullContactData {
  fullName: string | null;
  age: number | null;
  gender: string | null;
  location: string | null;
  title: string | null;          // current job title
  organization: string | null;   // current employer
  bio: string | null;
  avatar: string | null;         // profile photo URL
  profiles: FullContactSocialProfile[];
  otherEmails: string[];
  phones: string[];
  employment: FullContactEmployment[];
}

export interface BreachDirectoryEntry {
  password: string;       // partial plaintext e.g. "p****d"
  sha1: string;           // SHA-1 hash of the original password
  hash: string;           // MD5 hash of the original password
  sources: string[];      // which breach databases it came from
}

export interface BreachDirectoryData {
  found: number;
  fields: string[];       // field types found: ["email", "password", "username"]
  sources: string[];      // all source breach names
  results: BreachDirectoryEntry[];
}

// ── Mail exchange (keyless MX fingerprint) ───────────────────────────────────
// Where a domain's mail actually lands, read from its published MX records. A
// corroboration signal for email mode: it describes the DOMAIN's infrastructure,
// never that a specific address exists.
export type MailProviderCategory =
  | "google" | "microsoft" | "proofpoint" | "mimecast" | "zoho"
  | "yandex" | "proton" | "fastmail" | "apple" | "amazon"
  | "gmx" | "cloudflare" | "godaddy" | "tencent" | "netease"
  | "rackspace" | "other" | "none";

export interface MailProviderData {
  /** Mail can be delivered: at least one MX names a real exchanger. */
  hasMx: boolean;
  /**
   * True when the domain publishes an RFC 7505 null MX (one record of
   * preference 0 whose exchange is the root label), which is it declaring that
   * it accepts no mail. `hasMx: false` alone only means none was published.
   */
  nullMx: boolean;
  /** Mail exchangers, primary (lowest priority number) first, deduplicated. */
  mxHosts: string[];
  /** Human-readable provider, e.g. "Google Workspace" or "Self-managed …". */
  provider: string;
  category: MailProviderCategory;
}

export interface EmailLookupResponse {
  email: string;
  analysis: EmailAnalysis;
  /**
   * 0-100 ABUSE risk from reputation signals only. Optional so a response
   * cached before the split still renders; the dashboard recomputes it.
   */
  threatScore?: number;
  threatLabel?: string;
  threatReasons?: string[];
  /** 0-100 EXPOSURE: breach records, credential dumps, infostealer captures. */
  exposureScore?: number;
  exposureLabel?: string;
  exposureReasons?: string[];
  gravatar: GravatarProfile;
  /** Keyless mail-exchange fingerprint (Cloudflare DoH). Optional so a response
   * cached before this field existed still renders. */
  mail?: SourceResult<MailProviderData>;
  emailrep: SourceResult<EmailRepData>;
  hunter: SourceResult<HunterData>;
  abstract: SourceResult<AbstractEmailData>;
  xon: SourceResult<XposedOrNotData>;                  // XposedOrNot: free breach DB
  breachDirectory: SourceResult<BreachDirectoryData>;   // BreachDirectory: credential hashes
  fullContact: SourceResult<FullContactData>;           // FullContact: real name + employer
  hudsonRock: SourceResult<HudsonRockData>;             // Hudson Rock: infostealer exposure
  leakCheck: SourceResult<LeakCheckData>;               // LeakCheck: public breach index
  comb: SourceResult<CombExposure>;                     // ProxyNova COMB: masked credential pairs
  hibp: SourceResult<HibpData>;                         // Have I Been Pwned: per-account breaches (optional key)
  /**
   * Server-computed union across every breach source that answered, enriched
   * from the vendored HIBP catalog. Optional so a cached response from before
   * this field existed still renders (the client recomputes it as a fallback).
   */
  breachAggregate?: BreachAggregate;
  /** Fused credential-exposure + password-reuse assessment. */
  credentialExposure?: CredentialExposure;
  /** Uniform per-source provenance — same shape as every other lookup mode. */
  sourceHealth?: SourceProvenance[];
  cachedAt?: number;
}

// ── Username OSINT ──────────────────────────────────────────────────────────

// "manual" = a site whose existence CANNOT be determined by a server-side probe
// (JS-rendered SPA or bot-wall that returns HTTP 200 for everyone). We never claim
// found/notfound for these — the UI surfaces them as "open to verify" links.
export type UsernameHitStatus = "found" | "notfound" | "unknown" | "manual";

export interface UsernameHit {
  site: string;
  category: string;
  url: string;
  status: UsernameHitStatus;
  httpStatus?: number;
}

/** A single labelled metric on a rich profile card (e.g. "repos" → "42"). */
export interface ProfileStat {
  label: string;
  value: string;
}

/**
 * A confirmed account pulled from a keyless public API (GitHub, GitLab, Hacker
 * News, Reddit). Unlike a bare `UsernameHit` (which only knows found/notfound),
 * a SocialProfile carries the account's real data — the difference between "an
 * account exists here" and "here is who it is". Every field except platform/
 * handle/url is best-effort; the UI hides what's null.
 */
export interface SocialProfile {
  platform: string;              // "GitHub", "GitLab", "Hacker News", "Reddit"
  /** UsernameCategory string, used only to pick the badge colour. */
  category: string;
  handle: string;                // the account's own login/id (may differ in case)
  url: string;                   // public profile URL
  avatarUrl: string | null;
  displayName: string | null;
  bio: string | null;
  stats: ProfileStat[];          // karma / repos / followers …
  joinedYear: string | null;     // 4-digit year the account was created
  location: string | null;
  /** Extra one-liner: company, org, or a status flag like "account suspended". */
  extra: string | null;
}

/**
 * Cross-profile identity synthesis: the distinct real-name / location / avatar /
 * bio candidates gathered from every confirmed profile, each tagged with the
 * platform it came from. Pure derivation — no new network calls, no guessing.
 */
export interface IdentitySignals {
  names: { value: string; source: string }[];
  locations: { value: string; source: string }[];
  avatars: { url: string; source: string }[];
  bios: { value: string; source: string }[];
}

import type { ResolvedIdentity } from "./analysis/identityResolve";
import type { LinkProof } from "./analysis/identityLinks";
import type { AvatarCluster } from "./analysis/phash";
export type { ResolvedIdentity, LinkProof, AvatarCluster };

export interface UsernameLookupResponse {
  username: string;
  /** Sites we could actually auto-verify (excludes `manual` sites). */
  checked: number;
  found: number;
  /** Sites that can't be verified server-side — shown as "open to verify" links. */
  manual?: number;
  hits: UsernameHit[];
  /** Rich, API-verified accounts (GitHub / GitLab / Hacker News / Reddit). */
  profiles: SocialProfile[];
  /** Real-name / location / avatar candidates synthesised from `profiles`. */
  identity: IdentitySignals;
  /**
   * The server's entity resolution over `identity`, fusing only the accounts
   * `identityProofs` actually links. Optional so a response cached before this
   * existed still renders (the client resolves it as a fallback).
   */
  resolvedIdentity?: ResolvedIdentity;
  /** What links two accounts to one subject: a self-link, or a matching photo. */
  identityProofs?: LinkProof[];
  /**
   * Accounts whose profile photos are the same image, by perceptual hash
   * computed SERVER-side. It used to be computed on a browser canvas, which
   * needs CORS, so it never worked for a host that does not send the header.
   */
  avatarClusters?: AvatarCluster[];
  /** Avatars that produced no hash, with the reason (a platform default, …). */
  avatarSkipped?: { url: string; source: string; reason: string }[];
  /** Derived dork/search links to pivot further (no key) */
  pivots: { label: string; url: string }[];
  /** LeakCheck public breach index — free, no key. */
  leakCheck: SourceResult<LeakCheckData>;
  /** Hudson Rock infostealer exposure for the handle — free, no key. */
  hudsonRock: SourceResult<HudsonRockData>;
  /** Server-computed, catalog-enriched breach union (LeakCheck, enriched offline). */
  breachAggregate?: BreachAggregate;
  /** Fused credential-exposure + reuse assessment (COMB is email-only). */
  credentialExposure?: CredentialExposure;
  /** Uniform per-source provenance — same shape as every other lookup mode. */
  sourceHealth?: SourceProvenance[];
  cachedAt?: number;
}

/** One deep-sweep probe result. Same three-state honesty as the fast sweep. */
export interface SweepHit {
  site: string;
  category: string;
  /** The profile URL to show, which can differ from the URL probed. */
  url: string;
  status: "found" | "notfound" | "unknown";
  httpStatus?: number;
  /**
   * Anti-bot protection the catalog records for this site. An `unknown` on a
   * Cloudflare-protected site is explained by this rather than looking like a
   * tool failure.
   */
  protection?: string[];
}

export interface UsernameSweepResponse {
  username: string;
  offset: number;
  /** Sites probed in THIS page. */
  limit: number;
  /** Sites in the sweep this request covers. */
  total: number;
  /**
   * Sites excluded because their detection markers failed the last validation
   * run. Available with `includeUnvalidated`, and reported so the coverage is
   * legible rather than silently narrowed.
   */
  unvalidated: number;
  /** Offset for the next page, or null at the end. */
  nextOffset: number | null;
  hits: SweepHit[];
  found: number;
  notfound: number;
  unknown: number;
  sourceHealth?: SourceProvenance[];
}

// ── IP OSINT ────────────────────────────────────────────────────────────────

export interface IpLookupData {
  ip: string;
  type: string | null;            // IPv4 / IPv6
  city: string | null;
  region: string | null;
  country: string | null;
  countryCode: string | null;
  continent: string | null;
  latitude: number | null;
  longitude: number | null;
  postal: string | null;
  timezone: string | null;
  utcOffset: string | null;
  asn: number | null;
  asnOrg: string | null;          // ASN organisation
  isp: string | null;
  org: string | null;
  // Risk flags (best-effort from free sources)
  isProxy: boolean | null;
  isVpn: boolean | null;
  isTor: boolean | null;
  isHosting: boolean | null;
  isMobile: boolean | null;
  flagEmoji: string | null;
  reverse: string | null;         // PTR / reverse DNS if resolvable
  // Internet-exposure intel from Shodan InternetDB (free, no key). null means
  // the source had nothing / was unreachable — NOT "zero" (we never fake data).
  ports: number[] | null;         // open ports observed
  vulns: string[] | null;         // CVE IDs
  hostnames: string[] | null;     // hostnames mapped to the IP
  tags: string[] | null;          // shodan classifiers: cdn, tor, vpn, compromised, …
  // GreyNoise Community (free, no key) — internet-scanner classification.
  greyNoise: {
    classification: string;       // benign | malicious | unknown
    noise: boolean;               // seen mass-scanning the internet
    riot: boolean;                // common business service (likely benign)
    name: string | null;          // actor/operator label
    lastSeen: string | null;
  } | null;
  // RIPEstat RIR routing/abuse enrichment (keyless). Optional + nullable: absent
  // on cached results from before this existed, null when RIPEstat had nothing.
  abuseContact?: string | null;       // network abuse-report address
  prefix?: string | null;             // the announced prefix (netblock) covering this IP
  announcedPrefixes?: number | null;  // how many prefixes this IP's ASN announces
}

/** Per-source provenance for a lookup: which source, did it answer, latency. */
export interface SourceProvenance {
  source: string;
  ok: boolean;
  ms: number;
  fetchedAt: number;
  error?: string;
  /**
   * True when the source was never called at all. Distinct from `ok: false`,
   * which means it was called and failed: a source that was never called is not
   * an outage. `error` says which of the two reasons applies:
   *
   *   NOT_CONFIGURED  its API key is not set, so adding one would enable it
   *   NO_INPUT        it is keyless, but this lookup had nothing to ask it
   *                   about (no resolved address, no registrant organisation)
   *
   * The distinction is not cosmetic: a report that says "not configured" for a
   * keyless source tells the reader a key would have produced an answer, which
   * is false.
   */
  skipped?: boolean;
}

export interface IpLookupResponse {
  input: string;
  ip: IpLookupData | null;
  /** Offline IANA scope classification (private/loopback/CGNAT/documentation/…/global). */
  classification?: IpClassification;
  /** Curated free pivot links for deeper IP investigation */
  pivots: { label: string; url: string; note: string }[];
  threatScore: number;
  threatLabel: string;
  /** Which sources were queried, whether they answered, and how fast. */
  sources?: SourceProvenance[];
  /** Uniform per-source provenance — same shape as every other lookup mode. */
  sourceHealth?: SourceProvenance[];
  error?: string;
  cachedAt?: number;
}

// ── Domain OSINT ────────────────────────────────────────────────────────────

export interface DnsRecord {
  type: string;   // A / AAAA / MX / TXT / NS / CNAME / SOA
  value: string;
  ttl?: number;
  priority?: number; // MX
}

export interface DomainWhois {
  registrar: string | null;
  createdDate: string | null;
  updatedDate: string | null;
  expiresDate: string | null;
  nameservers: string[];
  statuses: string[];
  registrantOrg: string | null;
  registrantCountry: string | null;
}

// ── HTTP / TLS posture (domain mode) ─────────────────────────────────────────

/** Response headers, lower-cased keys. */
export type HeaderMap = Record<string, string>;

export interface SecurityHeaderCheck {
  name: string;
  present: boolean;
  value: string | null;
  score: number;
  max: number;
  /** Why this scored what it did, in the analyst's terms. */
  note: string;
}

export interface SecurityPosture {
  checks: SecurityHeaderCheck[];
  score: number;
  max: number;
  percent: number;
  grade: "A" | "B" | "C" | "D" | "F";
}

export interface TechFingerprint {
  name: string;
  kind: "server" | "cdn" | "cms" | "framework" | "language" | "hosting" | "security";
  version: string | null;
  /** The header or markup that produced the detection — never a guess. */
  evidence: string;
}

export interface CookieFinding {
  name: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string | null;
}

export interface TlsInfo {
  protocol: string | null;
  cipher: string | null;
  issuer: string | null;
  subject: string | null;
  /** Subject organisation (OV/EV certificates only): a CA-verified legal name. */
  subjectOrg?: string | null;
  /** EV only: ISO country of the jurisdiction of incorporation. */
  subjectJurisdiction?: string | null;
  /** EV only: the company registration number the CA verified. */
  subjectRegistrationNumber?: string | null;
  altNames: string[];
  validFrom: string | null;
  validTo: string | null;
  /** Negative once expired. null when the date could not be read. */
  daysRemaining: number | null;
  /** Did the chain validate against the system trust store? */
  trusted: boolean;
  /** Set when `trusted` is false — e.g. "self signed certificate". */
  trustError: string | null;
}

export interface HttpProbe {
  /** Final URL after redirects. */
  url: string;
  status: number;
  /** Each hop as "301 http://x → https://x", oldest first. */
  redirectChain: string[];
  /** Did plain http:// upgrade to https://? null when http was unreachable. */
  httpsRedirect: boolean | null;
  security: SecurityPosture;
  tech: TechFingerprint[];
  disclosures: { header: string; value: string; hasVersion: boolean }[];
  cookies: CookieFinding[];
  title: string | null;
  tls: TlsInfo | null;
}

import type { TakeoverSignal, TakeoverVerification } from "./analysis/subdomainTakeover";
export type { TakeoverSignal, TakeoverVerification };

/**
 * A dangling-CNAME subdomain-takeover candidate: the affected name plus the
 * matched service and the fingerprint that confirms it. A CANDIDATE, never a
 * confirmed takeover — the service match is necessary but not sufficient, so the
 * panel points the analyst at the verification step rather than claiming a hit.
 */
export interface TakeoverCandidate extends TakeoverSignal {
  /** The subdomain (or apex) whose CNAME points at the takeover-prone service. */
  name: string;
  /**
   * What a live probe of `name` found. Candidates verified as `claimed` are
   * dropped server-side, so only "unclaimed" (fingerprint served) and
   * "unverified" (nothing answered) ever reach the UI.
   */
  verification: TakeoverVerification;
}

/** One breach the vendored HIBP catalog records for a domain. */
export interface DomainBreach {
  name: string;
  domain: string | null;
  date: string | null;
  records: number | null;
  dataClasses: string[];
  verified: boolean;
}

/** The DNS queries a domain lookup makes. DMARC is the TXT query on `_dmarc.<domain>`. */
export type DnsQueryKind = "A" | "AAAA" | "MX" | "TXT" | "NS" | "CNAME" | "DMARC" | "DNSKEY";

/**
 * What each subdomain source contributed, so a short list can be read.
 *
 * A bare count is not a finding: 9 subdomains from a source that only publishes
 * recent certificates means something different from 9 from the full CT history.
 * Measured on wordpress.org, those two answers were 9 and 25.
 */
export interface SubdomainCoverage {
  sources: { source: string; ok: boolean; found: number }[];
  /** Distinct hosts found across all sources, before the reporting cap. */
  distinct: number;
  /** The reporting cap applied to the list. */
  limit: number;
  /** True when `distinct` exceeded the cap, so the list is a prefix. */
  capped: boolean;
}

/** A discovered subdomain with its current A records. `[]` means it resolves to nothing. */
export interface SubdomainHost {
  host: string;
  addresses: string[];
}

/** Shodan / GreyNoise exposure for one address. `null` fields mean "not learned". */
export interface HostExposureRecord {
  ip: string;
  ports: number[] | null;
  vulns: string[] | null;
  hostnames: string[] | null;
  tags: string[] | null;
  greyNoise: IpLookupData["greyNoise"];
  isTor: boolean | null;
  isVpn: boolean | null;
  isProxy: boolean | null;
}

import type { PassiveDnsResult, PassiveDnsRecord } from "./server/passiveDns";
import type { LeiOutcome, LeiRecord } from "./server/gleif";
export type { PassiveDnsResult, PassiveDnsRecord, LeiOutcome, LeiRecord };

export interface DomainLookupResponse {
  /** ASCII (punycode) form — the name every upstream was asked about. */
  domain: string;
  /** Unicode spelling, set only for an internationalised name. */
  domainUnicode?: string;
  isValid: boolean;
  dns: {
    a: DnsRecord[];
    aaaa: DnsRecord[];
    mx: DnsRecord[];
    txt: DnsRecord[];
    ns: DnsRecord[];
    cname: DnsRecord[];
  };
  whois: DomainWhois | null;
  /**
   * Subdomains discovered across certificate transparency (Certspotter + crt.sh)
   * and reverse IP, deduplicated and sorted. `subdomainCoverage` says which
   * source found how many, and whether the list was capped.
   */
  subdomains: string[];
  subdomainCoverage?: SubdomainCoverage;
  /** Current A records for the first N discovered subdomains. */
  subdomainHosts?: SubdomainHost[];
  /**
   * Passive-DNS history for the apex: what it used to resolve to, with
   * first/last-seen. null when the source did not answer, which is never the
   * same as "this name has no history".
   */
  passiveDns?: PassiveDnsResult | null;
  /** Shodan / GreyNoise exposure for the apex's own resolved addresses. */
  hostExposure?: HostExposureRecord[];
  /**
   * Other hostnames sharing the apex's first A record. Co-hosting, not
   * subdomains: names under this domain are merged into `subdomains` instead.
   */
  reverseIp?: { ip: string; hosts: string[]; total: number } | null;
  /**
   * Legal-entity register match for the RDAP registrant organisation. null when
   * WHOIS was redacted (nothing to query) or the register did not answer;
   * `records: []` means it answered and held nothing for that name.
   */
  lei?: LeiOutcome | null;
  /**
   * Email-security posture derived from TXT / _dmarc TXT / MX. Each `has*` is
   * null when its DNS query got no answer: unknown, which is never the same as
   * absent. Reading a timed-out TXT lookup as "no SPF" called a real domain
   * spoofable.
   */
  emailSecurity: {
    hasSpf: boolean | null;
    spf: string | null;
    hasDmarc: boolean | null;
    dmarcPolicy: string | null;   // none / quarantine / reject
    hasMx: boolean | null;
    /**
     * True when the domain publishes an RFC 7505 null MX: a single MX of
     * preference 0 whose exchange is the root label, which is the domain saying
     * it accepts no mail. Distinct from `hasMx: false`, which only means no
     * exchanger was published. null when the MX query went unanswered.
     */
    nullMx: boolean | null;
  };
  /** DNSSEC signed? (DNSKEY present). null = couldn't determine. */
  dnssec: boolean | null;
  /**
   * DNS queries that got no answer (timeout, network error, SERVFAIL). Their
   * record sets above are empty because they are unknown, not because the
   * domain has none. NXDOMAIN is an answer and never appears here.
   */
  dnsFailed?: DnsQueryKind[];
  /** Internet Archive first-snapshot evidence (free, no key). */
  wayback: { available: boolean; firstSnapshot: string | null; snapshotUrl: string | null } | null;
  /**
   * Live HTTP + TLS posture. null when the host serves nothing on 443, which is
   * ordinary for a parked or mail-only domain and is NOT an error.
   */
  http: HttpProbe | null;
  /**
   * Breaches the offline HIBP catalog records for this domain. It reports what
   * is publicly catalogued about the domain, NOT that its users are currently
   * compromised — a distinction the panel makes in words. A bundled dataset, so
   * it is not an upstream source and carries no source-health row.
   */
  knownBreaches?: DomainBreach[];
  /**
   * Dangling-CNAME takeover candidates found by resolving discovered subdomains'
   * CNAMEs and matching them against known takeover-prone services. Empty when
   * none matched; each is a lead to verify, not a confirmed takeover.
   */
  takeoverCandidates?: TakeoverCandidate[];
  pivots: { label: string; url: string; note: string }[];
  sources?: SourceProvenance[];
  /** Uniform per-source provenance — same shape as every other lookup mode. */
  sourceHealth?: SourceProvenance[];
  cachedAt?: number;
}

// ── Typosquat resolution ────────────────────────────────────────────────────

/** One generated look-alike, and what DNS says about it. */
export interface TyposquatFinding {
  /** The candidate as DNS sees it (punycode for an IDN look-alike). */
  domain: string;
  /** Unicode spelling, for an IDN homoglyph candidate. */
  display?: string;
  technique: string;
  addresses: string[];
  /** Mail exchangers, so "this look-alike can receive mail" is visible. */
  mx: string[];
  /** True when the name has A or MX records: it is live, not merely generated. */
  resolves: boolean;
  /** False when a query got no answer, so `resolves: false` is not an absence. */
  answered: boolean;
  /** RDAP registration facts, for the first few resolving candidates only. */
  whois: { registrar: string | null; createdDate: string | null } | null;
  /** Days since registration, when RDAP supplied a creation date. */
  ageDays: number | null;
}

export interface TyposquatScanResponse {
  domain: string;
  /** How many candidates the generator produced. */
  generated: number;
  /** How many were actually resolved (bounded by the request's limit). */
  checked: number;
  resolving: number;
  withMail: number;
  /** Candidates whose DNS queries got no answer: unknown, not absent. */
  unanswered: number;
  /** Only the candidates that resolve. The rest are not findings. */
  findings: TyposquatFinding[];
  sourceHealth?: SourceProvenance[];
}

// ── Crypto wallet OSINT ─────────────────────────────────────────────────────

import type { WalletChain, WalletFacts } from "./analysis/wallet";
import type { EnsIdentity } from "./analysis/ens";
import type { WalletActivity, TokenBalance } from "./analysis/walletActivity";
import type { SanctionedAddress } from "./data/sanctionedAddresses";
export type { WalletChain, WalletFacts, EnsIdentity, WalletActivity, TokenBalance, SanctionedAddress };

/**
 * OFAC screening result for one address, from the vendored SDN snapshot.
 *
 * `listed: false` means "not on the SDN list", which is not the same as clean —
 * the panel says so. Other authorities publish their own lists, and an address
 * one hop from a designated one is not itself designated.
 */
export interface SanctionsScreening {
  listed: boolean;
  matches: SanctionedAddress[];
  source: string;
  /** ISO date the snapshot was taken, so its age is visible. */
  snapshotDate: string;
  /** Addresses in the snapshot, for the scope note. */
  listSize: number;
}

export interface WalletLookupResponse {
  input: string;
  chain: WalletChain | null;
  /** Factual on-chain read; null when the address was unresolvable or the explorer was down. */
  facts: WalletFacts | null;
  pivots: { label: string; url: string; note: string }[];
  /**
   * ENS identity for an Ethereum address (reverse-resolved + forward-verified)
   * or for an ENS-name input (forward-resolved). null when there is none, or
   * absent on cached results from before this existed.
   */
  ens?: EnsIdentity | null;
  /**
   * OFAC SDN screening. Present for every wallet lookup, including one whose
   * chain the tool cannot read: the sanctions answer is offline and does not
   * depend on an explorer.
   */
  sanctions?: SanctionsScreening;
  /**
   * Recent-history summary (Bitcoin). Every field is explicitly a SAMPLE of the
   * most recent transactions, never a claim about the whole history.
   */
  activity?: WalletActivity | null;
  /** Non-zero ERC-20 balances from the fixed token list (Ethereum). */
  tokens?: TokenBalance[];
  sourceHealth?: SourceProvenance[];
  error?: string;
  cachedAt?: number;
}

// ── File-hash / IOC OSINT ────────────────────────────────────────────────────

import type { HashKind, HashFacts } from "./analysis/hash";
export type { HashKind, HashFacts };

export interface HashLookupResponse {
  input: string;
  kind: HashKind | null;
  /** Known-software reputation; null only when the source was unreachable. */
  facts: HashFacts | null;
  pivots: { label: string; url: string; note: string }[];
  sourceHealth?: SourceProvenance[];
  error?: string;
  cachedAt?: number;
}

// ── Investigation cases (persistent store) ──────────────────────────────────

/**
 * Identifier kinds a case, an edge, a snapshot or the graph can hold.
 *
 * `wallet` and `hash` are here because the tool has modes for both: leaving them
 * out meant a wallet address could be looked up but never pinned, and the link
 * graph knew five of the seven things the console can investigate.
 */
export type EntityKind = "phone" | "email" | "username" | "ip" | "domain" | "wallet" | "hash";

export interface CaseEntity {
  kind: EntityKind;
  value: string;
  addedAt: number;
  /** optional compact label/summary captured at add-time */
  note?: string;
}

/** One identifier inside an edge or a snapshot. */
export interface EntityRef {
  kind: EntityKind;
  value: string;
}

/**
 * A derived relationship between two identifiers in a case.
 *
 * The session graph only ever knew that two identifiers had both been looked
 * up; it could not say *why* they were connected. An edge records the actual
 * derivation ("Gravatar — linked github account"), so the graph survives the
 * browser, reaches the exported report, and can be read months later.
 */
export interface CaseEdge {
  from: EntityRef;
  to: EntityRef;
  /** Verbatim auto-pivot reason — which source/field produced the link. */
  reason: string;
  addedAt: number;
}

/**
 * A comparable fingerprint of one lookup, so re-running it later can be diffed.
 *
 * Deliberately NOT the whole response: storing full results would bloat the
 * case file and pin PII on disk indefinitely. `facts` holds only the scalars an
 * analyst would actually watch — breach counts, open ports, subdomain totals.
 */
export interface CaseSnapshot {
  kind: EntityKind;
  value: string;
  takenAt: number;
  facts: Record<string, number | string>;
  /**
   * True when the lookup behind this snapshot was served from the result cache.
   * Without it, an unchanged diff is ambiguous: nothing moved upstream, or we
   * simply compared a cached result with itself.
   */
  fromCache?: boolean;
}

export interface InvestigationCase {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  entities: CaseEntity[];
  /** freeform analyst notes */
  notes?: string;
  /** Derived relationships between this case's identifiers. */
  edges?: CaseEdge[];
  /** Lookup fingerprints, newest last, capped per identifier. */
  snapshots?: CaseSnapshot[];
  /**
   * When the analyst last marked this case's changes as read. Anything that
   * moved after it is unread in the change inbox. Absent means nothing has been
   * reviewed yet, so every change is unread.
   */
  reviewedAt?: number;
}
