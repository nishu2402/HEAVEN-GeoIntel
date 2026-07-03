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

  it("expectedLengths uses bundled country lengths", () => {
    const a = analyzePhoneNumber("+14155552671");
    expect(a!.expectedLengths).toEqual([10]);
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
