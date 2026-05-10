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
  active_status: string;
  user_activity: string;
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
  isMobile: boolean | null;
  isFixedLine: boolean | null;
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
