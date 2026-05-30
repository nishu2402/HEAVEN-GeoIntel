// ── MCC / MNC operator database (offline, zero-key) ─────────────────────────
// Maps a PLMN code (Mobile Country Code + Mobile Network Code) to the real
// operator name + country. Lets us resolve Twilio's mobile_country_code /
// mobile_network_code into a human-readable carrier without any API call.
//
// Source: public ITU / Wikipedia MCC-MNC allocations (curated subset of the
// highest-traffic operators worldwide). Keyed by "MCC-MNC".

export interface MccMncEntry {
  operator: string;
  country: string;
  iso: string; // ISO 3166-1 alpha-2
}

// Keyed "MCC-MNC" (MNC may be 2 or 3 digits — both stored where they differ).
export const MCC_MNC: Record<string, MccMncEntry> = {
  // ── United States (MCC 310/311/312/313/316) ──
  "310-260": { operator: "T-Mobile US", country: "United States", iso: "US" },
  "310-410": { operator: "AT&T Mobility", country: "United States", iso: "US" },
  "310-150": { operator: "AT&T Mobility", country: "United States", iso: "US" },
  "310-120": { operator: "Sprint (T-Mobile)", country: "United States", iso: "US" },
  "311-480": { operator: "Verizon Wireless", country: "United States", iso: "US" },
  "311-280": { operator: "AT&T Mobility", country: "United States", iso: "US" },
  "310-030": { operator: "AT&T Mobility", country: "United States", iso: "US" },
  "310-004": { operator: "Verizon Wireless", country: "United States", iso: "US" },
  "312-530": { operator: "Sprint (T-Mobile)", country: "United States", iso: "US" },
  "310-160": { operator: "T-Mobile US", country: "United States", iso: "US" },
  "310-200": { operator: "T-Mobile US", country: "United States", iso: "US" },
  "310-310": { operator: "T-Mobile US", country: "United States", iso: "US" },
  "311-580": { operator: "US Cellular", country: "United States", iso: "US" },

  // ── Canada (MCC 302) ──
  "302-220": { operator: "Telus Mobility", country: "Canada", iso: "CA" },
  "302-221": { operator: "Telus Mobility", country: "Canada", iso: "CA" },
  "302-610": { operator: "Bell Mobility", country: "Canada", iso: "CA" },
  "302-720": { operator: "Rogers Wireless", country: "Canada", iso: "CA" },
  "302-490": { operator: "Freedom Mobile", country: "Canada", iso: "CA" },
  "302-780": { operator: "SaskTel", country: "Canada", iso: "CA" },

  // ── United Kingdom (MCC 234/235) ──
  "234-10": { operator: "O2 (Telefónica)", country: "United Kingdom", iso: "GB" },
  "234-15": { operator: "Vodafone UK", country: "United Kingdom", iso: "GB" },
  "234-20": { operator: "3 (Three)", country: "United Kingdom", iso: "GB" },
  "234-30": { operator: "EE (BT)", country: "United Kingdom", iso: "GB" },
  "234-33": { operator: "EE (BT)", country: "United Kingdom", iso: "GB" },
  "234-02": { operator: "O2 (Telefónica)", country: "United Kingdom", iso: "GB" },

  // ── Germany (MCC 262) ──
  "262-01": { operator: "Telekom (T-Mobile)", country: "Germany", iso: "DE" },
  "262-02": { operator: "Vodafone Germany", country: "Germany", iso: "DE" },
  "262-03": { operator: "O2 (Telefónica)", country: "Germany", iso: "DE" },
  "262-07": { operator: "O2 (Telefónica)", country: "Germany", iso: "DE" },

  // ── France (MCC 208) ──
  "208-01": { operator: "Orange France", country: "France", iso: "FR" },
  "208-10": { operator: "SFR", country: "France", iso: "FR" },
  "208-15": { operator: "Free Mobile", country: "France", iso: "FR" },
  "208-20": { operator: "Bouygues Telecom", country: "France", iso: "FR" },

  // ── India (MCC 404/405) ──
  "404-45": { operator: "Airtel", country: "India", iso: "IN" },
  "404-10": { operator: "Airtel", country: "India", iso: "IN" },
  "405-840": { operator: "Reliance Jio", country: "India", iso: "IN" },
  "405-854": { operator: "Reliance Jio", country: "India", iso: "IN" },
  "404-86": { operator: "Vodafone Idea (Vi)", country: "India", iso: "IN" },
  "404-20": { operator: "Vodafone Idea (Vi)", country: "India", iso: "IN" },
  "404-11": { operator: "Vodafone Idea (Vi)", country: "India", iso: "IN" },
  "404-01": { operator: "BSNL", country: "India", iso: "IN" },

  // ── China (MCC 460) ──
  "460-00": { operator: "China Mobile", country: "China", iso: "CN" },
  "460-02": { operator: "China Mobile", country: "China", iso: "CN" },
  "460-07": { operator: "China Mobile", country: "China", iso: "CN" },
  "460-01": { operator: "China Unicom", country: "China", iso: "CN" },
  "460-06": { operator: "China Unicom", country: "China", iso: "CN" },
  "460-03": { operator: "China Telecom", country: "China", iso: "CN" },
  "460-11": { operator: "China Telecom", country: "China", iso: "CN" },

  // ── Japan (MCC 440/441) ──
  "440-10": { operator: "NTT Docomo", country: "Japan", iso: "JP" },
  "440-20": { operator: "SoftBank", country: "Japan", iso: "JP" },
  "440-50": { operator: "au (KDDI)", country: "Japan", iso: "JP" },
  "440-51": { operator: "au (KDDI)", country: "Japan", iso: "JP" },

  // ── South Korea (MCC 450) ──
  "450-05": { operator: "SK Telecom", country: "South Korea", iso: "KR" },
  "450-08": { operator: "KT", country: "South Korea", iso: "KR" },
  "450-06": { operator: "LG U+", country: "South Korea", iso: "KR" },

  // ── Australia (MCC 505) ──
  "505-01": { operator: "Telstra", country: "Australia", iso: "AU" },
  "505-02": { operator: "Optus", country: "Australia", iso: "AU" },
  "505-03": { operator: "Vodafone Australia", country: "Australia", iso: "AU" },

  // ── Brazil (MCC 724) ──
  "724-06": { operator: "Vivo (Telefónica)", country: "Brazil", iso: "BR" },
  "724-11": { operator: "Vivo (Telefónica)", country: "Brazil", iso: "BR" },
  "724-02": { operator: "TIM Brasil", country: "Brazil", iso: "BR" },
  "724-03": { operator: "TIM Brasil", country: "Brazil", iso: "BR" },
  "724-05": { operator: "Claro Brasil", country: "Brazil", iso: "BR" },
  "724-31": { operator: "Oi", country: "Brazil", iso: "BR" },

  // ── Russia (MCC 250) ──
  "250-01": { operator: "MTS", country: "Russia", iso: "RU" },
  "250-02": { operator: "MegaFon", country: "Russia", iso: "RU" },
  "250-99": { operator: "Beeline", country: "Russia", iso: "RU" },
  "250-20": { operator: "Tele2 Russia", country: "Russia", iso: "RU" },

  // ── Mexico (MCC 334) ──
  "334-020": { operator: "Telcel", country: "Mexico", iso: "MX" },
  "334-030": { operator: "Movistar", country: "Mexico", iso: "MX" },
  "334-050": { operator: "AT&T Mexico", country: "Mexico", iso: "MX" },

  // ── Spain (MCC 214) ──
  "214-07": { operator: "Movistar", country: "Spain", iso: "ES" },
  "214-01": { operator: "Vodafone Spain", country: "Spain", iso: "ES" },
  "214-03": { operator: "Orange Spain", country: "Spain", iso: "ES" },
  "214-04": { operator: "Yoigo", country: "Spain", iso: "ES" },

  // ── Italy (MCC 222) ──
  "222-01": { operator: "TIM", country: "Italy", iso: "IT" },
  "222-10": { operator: "Vodafone Italy", country: "Italy", iso: "IT" },
  "222-88": { operator: "WindTre", country: "Italy", iso: "IT" },
  "222-50": { operator: "Iliad Italy", country: "Italy", iso: "IT" },

  // ── UAE / Saudi / others ──
  "424-02": { operator: "Etisalat", country: "United Arab Emirates", iso: "AE" },
  "424-03": { operator: "du", country: "United Arab Emirates", iso: "AE" },
  "420-01": { operator: "STC", country: "Saudi Arabia", iso: "SA" },
  "420-03": { operator: "Mobily", country: "Saudi Arabia", iso: "SA" },
  "420-04": { operator: "Zain KSA", country: "Saudi Arabia", iso: "SA" },

  // ── Nigeria / South Africa ──
  "621-30": { operator: "MTN Nigeria", country: "Nigeria", iso: "NG" },
  "621-20": { operator: "Airtel Nigeria", country: "Nigeria", iso: "NG" },
  "621-50": { operator: "Glo Mobile", country: "Nigeria", iso: "NG" },
  "655-10": { operator: "Vodacom", country: "South Africa", iso: "ZA" },
  "655-01": { operator: "Vodacom", country: "South Africa", iso: "ZA" },
  "655-07": { operator: "Cell C", country: "South Africa", iso: "ZA" },
  "655-02": { operator: "Telkom Mobile", country: "South Africa", iso: "ZA" },
  "655-10-mtn": { operator: "MTN South Africa", country: "South Africa", iso: "ZA" },

  // ── Indonesia / Pakistan / Bangladesh ──
  "510-10": { operator: "Telkomsel", country: "Indonesia", iso: "ID" },
  "510-11": { operator: "XL Axiata", country: "Indonesia", iso: "ID" },
  "510-89": { operator: "Tri (3) Indonesia", country: "Indonesia", iso: "ID" },
  "410-01": { operator: "Jazz (Mobilink)", country: "Pakistan", iso: "PK" },
  "410-03": { operator: "Ufone", country: "Pakistan", iso: "PK" },
  "410-06": { operator: "Telenor Pakistan", country: "Pakistan", iso: "PK" },
  "470-01": { operator: "Grameenphone", country: "Bangladesh", iso: "BD" },
  "470-02": { operator: "Robi Axiata", country: "Bangladesh", iso: "BD" },

  // ── Netherlands / Belgium / Sweden / Switzerland ──
  "204-04": { operator: "Vodafone NL", country: "Netherlands", iso: "NL" },
  "204-08": { operator: "KPN", country: "Netherlands", iso: "NL" },
  "204-16": { operator: "T-Mobile NL", country: "Netherlands", iso: "NL" },
  "206-01": { operator: "Proximus", country: "Belgium", iso: "BE" },
  "206-10": { operator: "Orange Belgium", country: "Belgium", iso: "BE" },
  "240-01": { operator: "Telia Sweden", country: "Sweden", iso: "SE" },
  "240-07": { operator: "Tele2 Sweden", country: "Sweden", iso: "SE" },
  "228-01": { operator: "Swisscom", country: "Switzerland", iso: "CH" },
  "228-02": { operator: "Sunrise", country: "Switzerland", iso: "CH" },
  "228-03": { operator: "Salt", country: "Switzerland", iso: "CH" },
};

/**
 * Resolve an MCC + MNC to a human carrier name, offline.
 * MNC may be 2 or 3 digits — we try both the raw and zero-padded forms.
 */
export function lookupMccMnc(
  mcc: string | null | undefined,
  mnc: string | null | undefined
): MccMncEntry | null {
  if (!mcc || !mnc) return null;
  const m = String(mcc).trim();
  const n = String(mnc).trim();
  const candidates = [
    `${m}-${n}`,
    `${m}-${n.padStart(2, "0")}`,
    `${m}-${n.padStart(3, "0")}`,
  ];
  for (const key of candidates) {
    if (MCC_MNC[key]) return MCC_MNC[key];
  }
  return null;
}
