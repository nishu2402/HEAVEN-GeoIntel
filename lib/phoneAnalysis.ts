import { parsePhoneNumberFromString } from "libphonenumber-js";
import type { CountryCode } from "libphonenumber-js";

export interface PhoneAnalysis {
  e164: string;
  nationalNumber: string;
  countryCallingCode: string;
  country: CountryCode | null;
  countryName: string;
  flagEmoji: string;

  isValid: boolean;
  isPossible: boolean;
  isValidForRegion: boolean;

  type: string | null;
  typeDescription: string;
  isMobile: boolean;
  isFixedLine: boolean;
  isVoip: boolean;
  isTollFree: boolean;
  isPremiumRate: boolean;
  isSharedCost: boolean;
  isPersonalNumber: boolean;
  isPager: boolean;
  isUan: boolean;
  isEmergency: boolean;

  formatE164: string;
  formatInternational: string;
  formatNational: string;
  formatRfc3966: string;

  countryCode: string;
  subscriberNumber: string;
  areaCode: string | null;
  numberLength: number;
  expectedLengths: number[];

  timezones: string[];
  utcOffsets: string[];

  carrierPrefix: string | null;
  numberPlanArea: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  MOBILE: "Mobile",
  FIXED_LINE: "Fixed Line",
  FIXED_LINE_OR_MOBILE: "Fixed Line or Mobile",
  TOLL_FREE: "Toll-Free",
  PREMIUM_RATE: "Premium Rate",
  SHARED_COST: "Shared Cost",
  VOIP: "VoIP / Internet",
  PERSONAL_NUMBER: "Personal Number",
  PAGER: "Pager",
  UAN: "Universal Access Number",
  EMERGENCY: "Emergency Services",
  VOICEMAIL: "Voicemail",
  SHORT_CODE: "Short Code",
  STANDARD_RATE: "Standard Rate",
  UNKNOWN: "Unknown",
};

// Country → primary IANA timezone name
const COUNTRY_TZ: Record<string, string> = {
  US: "America/New_York", CA: "America/Toronto", MX: "America/Mexico_City",
  BR: "America/Sao_Paulo", AR: "America/Argentina/Buenos_Aires", CL: "America/Santiago",
  CO: "America/Bogota", PE: "America/Lima", VE: "America/Caracas",
  GB: "Europe/London", IE: "Europe/Dublin", FR: "Europe/Paris",
  DE: "Europe/Berlin", AT: "Europe/Vienna", CH: "Europe/Zurich",
  IT: "Europe/Rome", ES: "Europe/Madrid", PT: "Europe/Lisbon",
  NL: "Europe/Amsterdam", BE: "Europe/Brussels", LU: "Europe/Luxembourg",
  DK: "Europe/Copenhagen", SE: "Europe/Stockholm", NO: "Europe/Oslo",
  FI: "Europe/Helsinki", PL: "Europe/Warsaw", CZ: "Europe/Prague",
  SK: "Europe/Bratislava", HU: "Europe/Budapest", RO: "Europe/Bucharest",
  BG: "Europe/Sofia", HR: "Europe/Zagreb", SI: "Europe/Ljubljana",
  GR: "Europe/Athens", TR: "Europe/Istanbul", RU: "Europe/Moscow",
  UA: "Europe/Kyiv", BY: "Europe/Minsk", MD: "Europe/Chisinau",
  EE: "Europe/Tallinn", LV: "Europe/Riga", LT: "Europe/Vilnius",
  IN: "Asia/Kolkata", PK: "Asia/Karachi", BD: "Asia/Dhaka",
  LK: "Asia/Colombo", NP: "Asia/Kathmandu", AF: "Asia/Kabul",
  CN: "Asia/Shanghai", JP: "Asia/Tokyo", KR: "Asia/Seoul",
  HK: "Asia/Hong_Kong", TW: "Asia/Taipei", MO: "Asia/Macau",
  MN: "Asia/Ulaanbaatar", SG: "Asia/Singapore", MY: "Asia/Kuala_Lumpur",
  ID: "Asia/Jakarta", PH: "Asia/Manila", TH: "Asia/Bangkok",
  VN: "Asia/Ho_Chi_Minh", MM: "Asia/Rangoon", KH: "Asia/Phnom_Penh",
  LA: "Asia/Vientiane", TL: "Asia/Dili",
  AE: "Asia/Dubai", SA: "Asia/Riyadh", QA: "Asia/Qatar",
  KW: "Asia/Kuwait", BH: "Asia/Bahrain", OM: "Asia/Muscat",
  YE: "Asia/Aden", IQ: "Asia/Baghdad", IR: "Asia/Tehran",
  JO: "Asia/Amman", LB: "Asia/Beirut", SY: "Asia/Damascus",
  IL: "Asia/Jerusalem", PS: "Asia/Gaza", CY: "Asia/Nicosia",
  AM: "Asia/Yerevan", GE: "Asia/Tbilisi", AZ: "Asia/Baku",
  KZ: "Asia/Almaty", UZ: "Asia/Tashkent", TM: "Asia/Ashgabat",
  KG: "Asia/Bishkek", TJ: "Asia/Dushanbe",
  AU: "Australia/Sydney", NZ: "Pacific/Auckland",
  FJ: "Pacific/Fiji", PG: "Pacific/Port_Moresby",
  EG: "Africa/Cairo", ZA: "Africa/Johannesburg", NG: "Africa/Lagos",
  KE: "Africa/Nairobi", ET: "Africa/Addis_Ababa", GH: "Africa/Accra",
  TZ: "Africa/Dar_es_Salaam", UG: "Africa/Kampala", SD: "Africa/Khartoum",
  MA: "Africa/Casablanca", TN: "Africa/Tunis", DZ: "Africa/Algiers",
  LY: "Africa/Tripoli", SN: "Africa/Dakar", CI: "Africa/Abidjan",
  CM: "Africa/Douala", AO: "Africa/Luanda", MZ: "Africa/Maputo",
  ZW: "Africa/Harare", ZM: "Africa/Lusaka", MG: "Indian/Antananarivo",
};

// IANA timezone → human-readable UTC offset string
const TZ_UTC: Record<string, string> = {
  "America/New_York": "UTC-5 / UTC-4 (EDT)",
  "America/Chicago": "UTC-6 / UTC-5 (CDT)",
  "America/Denver": "UTC-7 / UTC-6 (MDT)",
  "America/Los_Angeles": "UTC-8 / UTC-7 (PDT)",
  "America/Toronto": "UTC-5 / UTC-4 (EDT)",
  "America/Vancouver": "UTC-8 / UTC-7 (PDT)",
  "America/Anchorage": "UTC-9 / UTC-8 (AKDT)",
  "Pacific/Honolulu": "UTC-10",
  "America/Sao_Paulo": "UTC-3 / UTC-2 (BRST)",
  "America/Mexico_City": "UTC-6 / UTC-5 (CDT)",
  "America/Argentina/Buenos_Aires": "UTC-3",
  "America/Santiago": "UTC-4 / UTC-3 (CLST)",
  "America/Bogota": "UTC-5",
  "America/Lima": "UTC-5",
  "America/Caracas": "UTC-4",
  "Europe/London": "UTC+0 / UTC+1 (BST)",
  "Europe/Dublin": "UTC+0 / UTC+1 (IST)",
  "Europe/Paris": "UTC+1 / UTC+2 (CEST)",
  "Europe/Berlin": "UTC+1 / UTC+2 (CEST)",
  "Europe/Vienna": "UTC+1 / UTC+2 (CEST)",
  "Europe/Zurich": "UTC+1 / UTC+2 (CEST)",
  "Europe/Rome": "UTC+1 / UTC+2 (CEST)",
  "Europe/Madrid": "UTC+1 / UTC+2 (CEST)",
  "Europe/Lisbon": "UTC+0 / UTC+1 (WEST)",
  "Europe/Amsterdam": "UTC+1 / UTC+2 (CEST)",
  "Europe/Brussels": "UTC+1 / UTC+2 (CEST)",
  "Europe/Copenhagen": "UTC+1 / UTC+2 (CEST)",
  "Europe/Stockholm": "UTC+1 / UTC+2 (CEST)",
  "Europe/Oslo": "UTC+1 / UTC+2 (CEST)",
  "Europe/Helsinki": "UTC+2 / UTC+3 (EEST)",
  "Europe/Warsaw": "UTC+1 / UTC+2 (CEST)",
  "Europe/Prague": "UTC+1 / UTC+2 (CEST)",
  "Europe/Budapest": "UTC+1 / UTC+2 (CEST)",
  "Europe/Bucharest": "UTC+2 / UTC+3 (EEST)",
  "Europe/Sofia": "UTC+2 / UTC+3 (EEST)",
  "Europe/Athens": "UTC+2 / UTC+3 (EEST)",
  "Europe/Istanbul": "UTC+3",
  "Europe/Moscow": "UTC+3",
  "Europe/Kyiv": "UTC+2 / UTC+3 (EEST)",
  "Europe/Minsk": "UTC+3",
  "Europe/Tallinn": "UTC+2 / UTC+3 (EEST)",
  "Europe/Riga": "UTC+2 / UTC+3 (EEST)",
  "Europe/Vilnius": "UTC+2 / UTC+3 (EEST)",
  "Asia/Kolkata": "UTC+5:30",
  "Asia/Karachi": "UTC+5",
  "Asia/Dhaka": "UTC+6",
  "Asia/Colombo": "UTC+5:30",
  "Asia/Kathmandu": "UTC+5:45",
  "Asia/Kabul": "UTC+4:30",
  "Asia/Tehran": "UTC+3:30 / UTC+4:30 (IRDT)",
  "Asia/Baghdad": "UTC+3",
  "Asia/Riyadh": "UTC+3",
  "Asia/Dubai": "UTC+4",
  "Asia/Qatar": "UTC+3",
  "Asia/Kuwait": "UTC+3",
  "Asia/Muscat": "UTC+4",
  "Asia/Jerusalem": "UTC+2 / UTC+3 (IDT)",
  "Asia/Beirut": "UTC+2 / UTC+3 (EEST)",
  "Asia/Amman": "UTC+2 / UTC+3 (EEST)",
  "Asia/Nicosia": "UTC+2 / UTC+3 (EEST)",
  "Asia/Yerevan": "UTC+4",
  "Asia/Tbilisi": "UTC+4",
  "Asia/Baku": "UTC+4",
  "Asia/Almaty": "UTC+6",
  "Asia/Tashkent": "UTC+5",
  "Asia/Shanghai": "UTC+8",
  "Asia/Hong_Kong": "UTC+8",
  "Asia/Tokyo": "UTC+9",
  "Asia/Seoul": "UTC+9",
  "Asia/Singapore": "UTC+8",
  "Asia/Kuala_Lumpur": "UTC+8",
  "Asia/Jakarta": "UTC+7",
  "Asia/Manila": "UTC+8",
  "Asia/Bangkok": "UTC+7",
  "Asia/Ho_Chi_Minh": "UTC+7",
  "Australia/Sydney": "UTC+10 / UTC+11 (AEDT)",
  "Australia/Melbourne": "UTC+10 / UTC+11 (AEDT)",
  "Pacific/Auckland": "UTC+12 / UTC+13 (NZDT)",
  "Africa/Cairo": "UTC+2",
  "Africa/Johannesburg": "UTC+2",
  "Africa/Lagos": "UTC+1",
  "Africa/Nairobi": "UTC+3",
  "Africa/Accra": "UTC+0",
  "Africa/Casablanca": "UTC+1",
};

export function countryToFlagEmoji(code: string): string {
  if (!code || code.length !== 2) return "🌐";
  return code
    .toUpperCase()
    .split("")
    .map((c) => String.fromCodePoint(c.charCodeAt(0) + 127397))
    .join("");
}

function getCountryDisplayName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function extractCarrierPrefix(national: string): string | null {
  const digits = national.replace(/\D/g, "");
  if (!digits) return null;
  const prefixLen = digits.length >= 7 ? 3 : digits.length >= 5 ? 2 : null;
  if (!prefixLen) return null;
  return digits.slice(0, prefixLen);
}

// Derive timezones and UTC offsets from country code using the bundled map
function getTimezonesForCountry(country: CountryCode | null): { timezones: string[]; utcOffsets: string[] } {
  if (!country) return { timezones: [], utcOffsets: [] };
  const tz = COUNTRY_TZ[country];
  if (!tz) return { timezones: [], utcOffsets: [] };
  const offset = TZ_UTC[tz] ?? tz;
  return { timezones: [tz], utcOffsets: [offset] };
}

// Typical national number lengths per country (subscriber digits)
const COUNTRY_NUMBER_LENGTHS: Partial<Record<CountryCode, number[]>> = {
  US: [10], CA: [10], GB: [10], DE: [10, 11], FR: [9], IN: [10],
  CN: [11], JP: [10, 11], AU: [9], BR: [11], RU: [10], MX: [10],
  KR: [10], ZA: [9], NG: [10], PK: [10], BD: [10], EG: [10],
  TR: [10], SA: [9], AE: [9], SG: [8], NL: [9], IT: [10],
  ES: [9], PL: [9], UA: [9], PH: [10], ID: [10, 12], MY: [9, 10],
  TH: [9], VN: [9], AR: [10], CL: [9], IL: [9], IR: [10],
  SE: [9], NO: [8], DK: [8], FI: [9], CH: [9], BE: [9], PT: [9],
  GR: [10], HU: [9], RO: [10], CZ: [9], AT: [10], NZ: [8, 9],
};

export function analyzePhoneNumber(raw: string): PhoneAnalysis | null {
  const parsed = parsePhoneNumberFromString(raw);
  if (!parsed) return null;

  const e164 = parsed.format("E.164");
  const national = parsed.format("NATIONAL");
  const international = parsed.format("INTERNATIONAL");
  const rfc3966 = parsed.format("RFC3966");
  const country = (parsed.country ?? null) as CountryCode | null;
  const type = parsed.getType() ?? null;
  const typeStr = type ?? "UNKNOWN";

  const { timezones, utcOffsets } = getTimezonesForCountry(country);

  const nationalDigits = national.replace(/\D/g, "");

  // Area code extraction — country-specific rules
  let areaCode: string | null = null;
  let subscriberNumber = nationalDigits;

  if (country === "US" || country === "CA") {
    areaCode = nationalDigits.slice(0, 3);
    subscriberNumber = nationalDigits.slice(3);
  } else if (country === "GB") {
    // UK: 07xxx mobile = 4-digit area code, landline 01/02 = 3-5 digits
    if (nationalDigits.startsWith("7") || nationalDigits.startsWith("07")) {
      areaCode = nationalDigits.startsWith("0") ? nationalDigits.slice(1, 5) : nationalDigits.slice(0, 4);
      subscriberNumber = nationalDigits.slice(4);
    } else {
      areaCode = nationalDigits.slice(0, 3);
      subscriberNumber = nationalDigits.slice(3);
    }
  } else if (country === "DE") {
    areaCode = nationalDigits.slice(0, 3);
    subscriberNumber = nationalDigits.slice(3);
  } else if (country === "FR") {
    areaCode = nationalDigits.slice(0, 2);
    subscriberNumber = nationalDigits.slice(2);
  } else if (country === "AU") {
    areaCode = nationalDigits.slice(0, 1);
    subscriberNumber = nationalDigits.slice(1);
  } else if (nationalDigits.length >= 8) {
    areaCode = nationalDigits.slice(0, 2);
    subscriberNumber = nationalDigits.slice(2);
  }

  const expectedLengths: number[] = country ? (COUNTRY_NUMBER_LENGTHS[country] ?? []) : [];

  return {
    e164,
    nationalNumber: nationalDigits,
    countryCallingCode: `+${parsed.countryCallingCode}`,
    country,
    countryName: country ? getCountryDisplayName(country) : "Unknown",
    flagEmoji: country ? countryToFlagEmoji(country) : "🌐",

    isValid: parsed.isValid(),
    isPossible: parsed.isPossible(),
    isValidForRegion: country ? parsed.isValid() : false,

    type,
    typeDescription: TYPE_LABELS[typeStr] ?? "Unknown",
    isMobile: typeStr === "MOBILE" || typeStr === "FIXED_LINE_OR_MOBILE",
    isFixedLine: typeStr === "FIXED_LINE" || typeStr === "FIXED_LINE_OR_MOBILE",
    isVoip: typeStr === "VOIP",
    isTollFree: typeStr === "TOLL_FREE",
    isPremiumRate: typeStr === "PREMIUM_RATE",
    isSharedCost: typeStr === "SHARED_COST",
    isPersonalNumber: typeStr === "PERSONAL_NUMBER",
    isPager: typeStr === "PAGER",
    isUan: typeStr === "UAN",
    isEmergency: (typeStr as string) === "EMERGENCY",

    formatE164: e164,
    formatInternational: international,
    formatNational: national,
    formatRfc3966: rfc3966,

    countryCode: `+${parsed.countryCallingCode}`,
    subscriberNumber,
    areaCode,
    numberLength: nationalDigits.length,
    expectedLengths,

    timezones,
    utcOffsets,

    carrierPrefix: extractCarrierPrefix(nationalDigits),
    numberPlanArea: country ? getCountryDisplayName(country) : null,
  };
}
