import type { PhoneAnalysis } from "./analysis/phoneAnalysis";
import type { CountryIntel } from "./data/countryIntel";
import type { OfflineReputation } from "./analysis/freePhoneIntel";
import type { IpClassification } from "./analysis/ipClassify";
import type { BreachAggregate } from "./analysis/breachAggregate";
import type { CredentialExposure } from "./analysis/credentialExposure";

export type { PhoneAnalysis, CountryIntel, OfflineReputation, IpClassification };
export type { BreachAggregate, CredentialExposure };

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
  threatScore: number;          // 0-100 unified threat score
  threatLabel: string;          // "CLEAN" | "LOW RISK" | "MODERATE" | "HIGH RISK" | "CRITICAL"
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
  domain: string;
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

export interface EmailLookupResponse {
  email: string;
  analysis: EmailAnalysis;
  gravatar: GravatarProfile;
  emailrep: SourceResult<EmailRepData>;
  hunter: SourceResult<HunterData>;
  abstract: SourceResult<AbstractEmailData>;
  xon: SourceResult<XposedOrNotData>;                  // XposedOrNot: free breach DB
  breachDirectory: SourceResult<BreachDirectoryData>;   // BreachDirectory: credential hashes
  fullContact: SourceResult<FullContactData>;           // FullContact: real name + employer
  hudsonRock: SourceResult<HudsonRockData>;             // Hudson Rock: infostealer exposure
  leakCheck: SourceResult<LeakCheckData>;               // LeakCheck: public breach index
  comb: SourceResult<CombExposure>;                     // ProxyNova COMB: masked credential pairs
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
   * True when the source was never called because its API key isn't
   * configured. Distinct from `ok: false`, which means it was called and
   * failed — an unconfigured optional source is not an outage.
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

import type { TakeoverSignal } from "./analysis/subdomainTakeover";
export type { TakeoverSignal };

/**
 * A dangling-CNAME subdomain-takeover candidate: the affected name plus the
 * matched service and the fingerprint that confirms it. A CANDIDATE, never a
 * confirmed takeover — the service match is necessary but not sufficient, so the
 * panel points the analyst at the verification step rather than claiming a hit.
 */
export interface TakeoverCandidate extends TakeoverSignal {
  /** The subdomain (or apex) whose CNAME points at the takeover-prone service. */
  name: string;
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

export interface DomainLookupResponse {
  domain: string;
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
  /** Subdomains discovered via certificate transparency (crt.sh) */
  subdomains: string[];
  /** Email-security posture derived from TXT records */
  emailSecurity: {
    hasSpf: boolean;
    spf: string | null;
    hasDmarc: boolean;
    dmarcPolicy: string | null;   // none / quarantine / reject
    hasMx: boolean;
  };
  /** DNSSEC signed? (DNSKEY present). null = couldn't determine. */
  dnssec: boolean | null;
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

// ── Crypto wallet OSINT ─────────────────────────────────────────────────────

import type { WalletChain, WalletFacts } from "./analysis/wallet";
import type { EnsIdentity } from "./analysis/ens";
export type { WalletChain, WalletFacts, EnsIdentity };

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

export type EntityKind = "phone" | "email" | "username" | "ip" | "domain";

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
}
