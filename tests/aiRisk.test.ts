import { describe, it, expect } from "vitest";
import { scoreRisk } from "@/lib/ai/risk";
import type { Signal, SignalCategory } from "@/lib/ai/signals";

// The scorer is a logistic model with checked-in coefficients. These tests pin
// the band thresholds, the explainability (factors decompose the score), and the
// two fallbacks (unknown id -> category weight; equal contributions -> id order).

const sig = (id: string, intensity: number, category: SignalCategory = "network", label = id): Signal =>
  ({ id, label, category, intensity, evidence: `${id} evidence` });

describe("scoreRisk", () => {
  it("returns a minimal floor with no factors when nothing contributes", () => {
    const r = scoreRisk([]);
    expect(r.factors).toEqual([]);
    expect(r.band).toBe("minimal");
    expect(r.score).toBeLessThan(15);
    expect(r.confidence).toBe("low");
    expect(r.rationale).toMatch(/no positive-risk signals/i);
  });

  it("ignores intensity-0 informational signals", () => {
    const r = scoreRisk([sig("network.benign", 0), sig("wallet.active", 0, "identity")]);
    expect(r.factors).toEqual([]);
    expect(r.band).toBe("minimal");
  });

  it("weights by signal id, falling back to the category weight for an unknown id", () => {
    const r = scoreRisk([sig("breach.count", 1, "breach"), sig("made.up", 1, "hygiene")]);
    const byId = r.factors.find((f) => f.id === "breach.count")!;
    const fallback = r.factors.find((f) => f.id === "made.up")!;
    expect(byId.weight).toBe(1.4);
    expect(fallback.weight).toBe(0.6); // hygiene category default
    expect(byId.contribution).toBeCloseTo(1.4);
  });

  it("decomposes the score into shares that sum to one", () => {
    const r = scoreRisk([sig("reputation.malicious", 1, "reputation"), sig("hygiene.disposable", 1, "hygiene")]);
    const total = r.factors.reduce((s, f) => s + f.share, 0);
    expect(total).toBeCloseTo(1);
    // most influential first
    expect(r.factors[0].id).toBe("reputation.malicious");
  });

  it("orders equal contributions by id for a stable list", () => {
    const r = scoreRisk([sig("z.item", 0.5, "hygiene"), sig("a.item", 0.5, "hygiene")]);
    expect(r.factors.map((f) => f.id)).toEqual(["a.item", "z.item"]);
  });

  it("bands the score minimal -> low -> elevated -> high -> critical", () => {
    expect(scoreRisk([]).band).toBe("minimal");
    expect(scoreRisk([sig("reputation.malicious", 0.8, "reputation")]).band).toBe("low");
    expect(scoreRisk([sig("reputation.malicious", 1, "reputation"), sig("hygiene.disposable", 1, "hygiene")]).band).toBe("elevated");
    expect(scoreRisk([sig("exposure.vulns", 1), sig("breach.count", 1, "breach")]).band).toBe("high");
    expect(scoreRisk([sig("malware.stealer", 1, "malware"), sig("exposure.vulns", 1)]).band).toBe("critical");
  });

  it("scales confidence with the number of contributing signals", () => {
    expect(scoreRisk([]).confidence).toBe("low");
    expect(scoreRisk([sig("breach.count", 1, "breach")]).confidence).toBe("medium");
    expect(scoreRisk([sig("malware.stealer", 1, "malware"), sig("exposure.vulns", 1), sig("breach.count", 1, "breach")]).confidence).toBe("high");
  });

  it("phrases the rationale by severity and cites the top factor", () => {
    const high = scoreRisk([sig("malware.stealer", 1, "malware"), sig("exposure.vulns", 1)]);
    expect(high.rationale).toMatch(/^Elevated risk driven chiefly by/);
    expect(high.rationale.toLowerCase()).toContain("malware.stealer evidence");
    const some = scoreRisk([sig("reputation.malicious", 0.8, "reputation")]);
    expect(some.rationale).toMatch(/^Some risk driven chiefly by/);
  });
});
