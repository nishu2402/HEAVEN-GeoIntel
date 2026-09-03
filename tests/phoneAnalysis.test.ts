import { describe, it, expect } from "vitest";
import { analyzePhoneNumber, countryToFlagEmoji } from "@/lib/analysis/phoneAnalysis";

describe("analyzePhoneNumber", () => {
  it("parses a US E.164 number into all four formats", () => {
    const a = analyzePhoneNumber("+14155552671");
    expect(a).not.toBeNull();
    expect(a!.country).toBe("US");
    expect(a!.formatE164).toBe("+14155552671");
    expect(a!.formatNational).toBe("(415) 555-2671");
    expect(a!.formatInternational).toBe("+1 415 555 2671");
    // libphonenumber-js emits the compact form without dashes
    expect(a!.formatRfc3966).toBe("tel:+14155552671");
  });

  it("extracts NPA area code only for US/CA", () => {
    const us = analyzePhoneNumber("+14155552671");
    const uk = analyzePhoneNumber("+447911123456");
    expect(us!.areaCode).toBe("415");
    // UK uses variable-length area codes — we refuse to guess
    expect(uk!.areaCode).toBeNull();
  });

  it("never claims isMobile=true for FIXED_LINE_OR_MOBILE numbers", () => {
    // Italian fixed/mobile numbers are intentionally ambiguous
    const it = analyzePhoneNumber("+390666543210");
    if (it && it.type === "FIXED_LINE_OR_MOBILE") {
      expect(it.isMobile).toBe(false);
      expect(it.isFixedLine).toBe(false);
      expect(it.isAmbiguousType).toBe(true);
    }
  });

  it("returns null for unparseable input", () => {
    expect(analyzePhoneNumber("not a number")).toBeNull();
    expect(analyzePhoneNumber("")).toBeNull();
  });

  it("resolves IANA timezone + UTC offset for a known country", () => {
    const india = analyzePhoneNumber("+919876543210");
    expect(india!.timezones).toContain("Asia/Kolkata");
    expect(india!.utcOffsets[0]).toContain("UTC+5:30");
  });

  it("uses the NPA-specific timezone, not the US country default, for a Pacific area code", () => {
    // 415 is San Francisco — Pacific. The old code showed the US default (Eastern),
    // which is wrong data for ~half the country. The NPA zone must win.
    const sf = analyzePhoneNumber("+14155552671")!;
    expect(sf.npaInfo!.timezone).toBe("America/Los_Angeles");
    expect(sf.timezones).toEqual(["America/Los_Angeles"]);
    expect(sf.utcOffsets[0]).toContain("UTC-8");
    expect(sf.utcOffsets[0]).not.toContain("UTC-5"); // never Eastern for SF
  });

  it("renders a correct DST-free offset for a no-DST area code (Arizona 602)", () => {
    const az = analyzePhoneNumber("+16025551234")!;
    expect(az.timezones).toEqual(["America/Phoenix"]);
    expect(az.utcOffsets[0]).toBe("UTC-7"); // Arizona keeps MST year-round
  });

  it("prefers the NPA zone for Canada too (Vancouver 604 → Pacific, not Toronto)", () => {
    const van = analyzePhoneNumber("+16045551234")!;
    expect(van.country).toBe("CA");
    expect(van.timezones).toEqual(["America/Vancouver"]);
    expect(van.utcOffsets[0]).toContain("UTC-8");
  });

  it("expectedLengths uses bundled country lengths", () => {
    const a = analyzePhoneNumber("+14155552671");
    expect(a!.expectedLengths).toEqual([10]);
  });

  it("handles a valid but country-less number (international freephone) without guessing", () => {
    const a = analyzePhoneNumber("+80012345678"); // UIFN: no country
    expect(a).not.toBeNull();
    expect(a!.country).toBeNull();
    expect(a!.countryName).toBe("Unknown");
    expect(a!.flagEmoji).toBe("🌐");
    expect(a!.isValidForRegion).toBe(false);
    expect(a!.npaInfo).toBeNull();
    expect(a!.timezones).toEqual([]);
    expect(a!.numberPlanArea).toBeNull();
    expect(a!.expectedLengths).toEqual([]);
  });

  it("reports a central-office code only inside the NANP", () => {
    // NXX is a North American Numbering Plan concept: digits 4–6 of a 10-digit
    // NANP number. It was previously derived for every country, which printed
    // "Central office (NXX): 098" for an Indian number — a NANP label on a
    // non-NANP number, and (before the trunk-prefix fix) the trunk zero itself.
    const us = analyzePhoneNumber("+14155552671");
    expect(us!.carrierPrefix).toBe("555");

    const fo = analyzePhoneNumber("+298123456"); // Faroe Islands, 6 national digits
    expect(fo!.country).toBe("FO");
    expect(fo!.carrierPrefix).toBeNull();
    expect(fo!.timezones).toEqual([]); // FO not in the bundled TZ map: no fabricated tz

    const inNum = analyzePhoneNumber("+919876543210");
    expect(inNum!.carrierPrefix).toBeNull();
  });

  it("reports no central-office code for a too-short number with no resolved country", () => {
    // libphonenumber parses "+1415" (isValid false) rather than returning null,
    // but withholds a country until the number is a full 10 NANP digits — so
    // the NANP-only branch is not entered and nothing is fabricated.
    const stub = analyzePhoneNumber("+1415");
    expect(stub!.isValid).toBe(false);
    expect(stub!.country).toBeNull();
    expect(stub!.carrierPrefix).toBeNull();
  });

  it("strips the trunk prefix the NATIONAL format carries", () => {
    // format("NATIONAL") keeps the digit a caller dials domestically — India's
    // "0", Russia's "8". Counting it made a valid +91 number report
    // "11 digits · expected 10", i.e. valid input rendered as malformed.
    const india = analyzePhoneNumber("+919876543210");
    expect(india!.nationalNumber).toBe("9876543210");
    expect(india!.numberLength).toBe(10);
    expect(india!.expectedLengths).toEqual([10]);

    const russia = analyzePhoneNumber("+79161234567");
    expect(russia!.nationalNumber).toBe("9161234567"); // leading "8" dropped

    // The NANP has no trunk prefix, so US numbers are unchanged.
    const us = analyzePhoneNumber("+14155552671");
    expect(us!.nationalNumber).toBe("4155552671");
    expect(us!.subscriberNumber).toBe("5552671");
  });
});

describe("countryToFlagEmoji", () => {
  it("converts a 2-letter ISO code to a flag emoji", () => {
    expect(countryToFlagEmoji("US")).toBe("🇺🇸");
    expect(countryToFlagEmoji("IN")).toBe("🇮🇳");
    expect(countryToFlagEmoji("GB")).toBe("🇬🇧");
  });

  it("returns the globe glyph for an empty or invalid code", () => {
    expect(countryToFlagEmoji("")).toBe("🌐");
    expect(countryToFlagEmoji("USA")).toBe("🌐");
  });
});
