import { describe, it, expect } from "vitest";
import { analyzePhoneNumber } from "@/lib/phoneAnalysis";
import { deriveOfflineReputation } from "@/lib/freePhoneIntel";

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

  it("returns at least one free, no-login recommended lookup", () => {
    const a = analyzePhoneNumber("+14155552671")!;
    const rep = deriveOfflineReputation(a);
    expect(rep.recommendedLookups.length).toBeGreaterThan(0);
    for (const link of rep.recommendedLookups) {
      expect(link.url).toMatch(/^https?:\/\//);
    }
  });

  it("rates confidence as high for a valid country-bound number", () => {
    const a = analyzePhoneNumber("+14155552671")!;
    const rep = deriveOfflineReputation(a);
    expect(rep.confidence).toBe("high");
  });
});
