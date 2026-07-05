import { describe, it, expect } from "vitest";
import { getCountryIntel, getCallingCodeToCountry, COUNTRY_DATA } from "@/lib/data/countryIntel";
import { lookupMccMnc, MCC_MNC } from "@/lib/data/mccMnc";
import { getNpaInfo } from "@/lib/data/usNpaDatabase";

// Offline lookup tables that feed real verdicts (country context, carrier name).
// A malformed row = a silently wrong result, so alongside spot-check lookups we
// assert structural invariants across every entry.

describe("countryIntel lookups", () => {
  it("resolves a country by ISO code, case-insensitively", () => {
    expect(getCountryIntel("US")?.name).toBe("United States");
    expect(getCountryIntel("us")?.name).toBe("United States");
  });

  it("returns null for an unknown code", () => {
    expect(getCountryIntel("ZZ")).toBeNull();
    expect(getCountryIntel("")).toBeNull();
  });

  it("maps a calling code back to a self-consistent country (with or without +)", () => {
    const iso = getCallingCodeToCountry("+81");
    expect(iso).toBeTruthy();
    expect(getCountryIntel(iso!)?.callingCode).toBe("+81");
    expect(getCallingCodeToCountry("81")).toBe(iso); // + is optional
    expect(getCallingCodeToCountry("+99999")).toBeNull();
  });
});

describe("countryIntel data integrity (every entry)", () => {
  it("has well-formed, self-consistent rows", () => {
    for (const [code, c] of Object.entries(COUNTRY_DATA)) {
      expect(c.code, code).toBe(code);                       // key matches payload
      expect(code, code).toMatch(/^[A-Z]{2}$/);              // ISO-3166-1 alpha-2
      expect(c.name, code).toBeTruthy();
      expect(c.callingCode, code).toMatch(/^\+\d+$/);        // "+" + digits
      expect(c.flagEmoji, code).toBeTruthy();
      expect(c.currency?.code, code).toBeTruthy();
      expect(Array.isArray(c.languages) && c.languages.length > 0, code).toBe(true);
      expect(["left", "right"], code).toContain(c.drivingSide);
    }
  });
});

describe("mccMnc lookups", () => {
  it("resolves a known PLMN to its operator", () => {
    expect(lookupMccMnc("310", "260")?.operator).toBe("T-Mobile US");
  });

  it("zero-pads a short MNC and returns null for missing/unknown input", () => {
    expect(lookupMccMnc(null, "260")).toBeNull();
    expect(lookupMccMnc("310", null)).toBeNull();
    expect(lookupMccMnc("000", "000")).toBeNull();
  });
});

describe("mccMnc data integrity (every entry)", () => {
  it("has well-formed keys and rows", () => {
    for (const [key, e] of Object.entries(MCC_MNC)) {
      expect(key, key).toMatch(/^\d{3}-\d{2,3}$/);  // MCC(3)-MNC(2 or 3)
      expect(e.operator, key).toBeTruthy();
      expect(e.country, key).toBeTruthy();
      expect(e.iso, key).toMatch(/^[A-Z]{2}$/);      // ISO-3166-1 alpha-2
    }
  });
});

describe("usNpaDatabase (getNpaInfo)", () => {
  it("resolves a US area code from the leading 3 national digits", () => {
    const ny = getNpaInfo("2125551234");
    expect(ny?.stateAbbr).toBe("NY");
  });

  it("returns null for fewer than 3 digits or an unknown NPA", () => {
    expect(getNpaInfo("12")).toBeNull();     // too short
    expect(getNpaInfo("")).toBeNull();
    expect(getNpaInfo("0005551234")).toBeNull(); // unknown NPA
  });
});
