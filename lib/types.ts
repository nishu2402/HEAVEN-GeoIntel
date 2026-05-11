import type { PhoneAnalysis } from "./phoneAnalysis";
import type { CountryIntel } from "./countryIntel";

export type { PhoneAnalysis, CountryIntel };

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

export interface LookupResponse {
  input: PhoneInputData;
  analysis: PhoneAnalysis;
  countryIntel: CountryIntel | null;
  sources: {
    numverify: SourceResult<NumVerifyData>;
    ipqs: SourceResult<IpqsData>;
    abstract: SourceResult<AbstractData>;
    twilio: SourceResult<TwilioData>;
  };
  aggregated: AggregatedResult;
  cachedAt?: number;
}

export interface HistoryEntry {
  e164: string;
  country: string;
  countryCallingCode: string;
  timestamp: number;
  flagEmoji: string;
}

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
  xon: SourceResult<XposedOrNotData>;                  // XposedOrNot — free breach DB
  breachDirectory: SourceResult<BreachDirectoryData>;   // BreachDirectory — credential hashes
  fullContact: SourceResult<FullContactData>;           // FullContact — real name + employer
  cachedAt?: number;
}
