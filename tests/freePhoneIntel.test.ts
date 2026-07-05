import { describe, it, expect } from "vitest";
import { analyzePhoneNumber } from "@/lib/analysis/phoneAnalysis";
import { deriveOfflineReputation } from "@/lib/analysis/freePhoneIntel";
import type { PhoneAnalysis } from "@/lib/types";

// deriveOfflineReputation reads only e164/country/subscriberNumber/npaInfo/
// areaCode/isValid, so a minimal cast is enough to exercise the NPA-hint branch.
const usNumber = (areaCode: string): PhoneAnalysis =>
  ({ e164: `+1${areaCode}5551234`, country: "US", subscriberNumber: `${areaCode}5551234`,
     npaInfo: null, areaCode, isValid: true } as unknown as PhoneAnalysis);

describe("deriveOfflineReputation", () => {
  it("flags US toll-free numbers", () => {
    const a = analyzePhoneNumber("+18005551234")!;
    const rep = deriveOfflineReputation(a);
    expect(rep.signals.join(" ")).toMatch(/toll-free/i);
  });

  it("infers an Indian operator-group hint for +91 mobiles", () => {
    const a = analyzePhoneNumber("+919876543210")!;
    const rep = deriveOfflineReputation(a);
    expect(rep.inferredCarrier).toMatch(/9-series|Jio|Airtel|Vi/);
  });

  it("rates confidence as high for a valid country-bound number", () => {
    const a = analyzePhoneNumber("+14155552671")!;
    const rep = deriveOfflineReputation(a);
    expect(rep.confidence).toBe("high");
  });

  it("adds a US NPA type hint when the area code isn't in the local DB", () => {
    const pcs = deriveOfflineReputation(usNumber("500")); // personal-comms NPA
    expect(pcs.signals.join(" ")).toMatch(/personal communications/i);
    expect(pcs.inferredCarrier).toMatch(/personal communications/i);

    const premium = deriveOfflineReputation(usNumber("900")); // premium-rate NPA
    expect(premium.signals.join(" ")).toMatch(/premium-rate/i);
  });

  it("rates confidence low when the number is invalid or country-less", () => {
    const invalid = { e164: "+000", country: null, subscriberNumber: "", npaInfo: null,
      areaCode: null, isValid: false } as unknown as PhoneAnalysis;
    expect(deriveOfflineReputation(invalid).confidence).toBe("low");
  });

  it("adds no operator-group hint for an Indian number outside the known prefixes", () => {
    const inNoGroup = { e164: "+911234567890", country: "IN", subscriberNumber: "1234567890",
      npaInfo: null, areaCode: null, isValid: true } as unknown as PhoneAnalysis;
    const rep = deriveOfflineReputation(inNoGroup);
    expect(rep.signals.join(" ")).not.toMatch(/Group:/); // no fabricated carrier group
  });
});
