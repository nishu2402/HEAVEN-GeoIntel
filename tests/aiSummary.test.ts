import { describe, it, expect } from "vitest";
import { narrate } from "@/lib/ai/summary";
import type { AiAnalysis } from "@/lib/ai";
import type { RiskAssessment, RiskFactor } from "@/lib/ai/risk";
import type { Anomaly } from "@/lib/ai/anomaly";

const factor = (id: string): RiskFactor =>
  ({ id, label: id, category: "network", intensity: 1, weight: 1, contribution: 1, share: 0.25, evidence: `${id} evidence` });

const analysis = (over: { factors?: RiskFactor[]; anomalies?: Anomaly[]; score?: number; band?: RiskAssessment["band"] } = {}): AiAnalysis => ({
  kind: "email",
  subject: "ada@example.com",
  signals: [],
  anomalies: over.anomalies ?? [],
  risk: {
    score: over.score ?? 50,
    band: over.band ?? "elevated",
    confidence: "medium",
    factors: over.factors ?? [],
    rationale: "r",
  },
  summary: [],
});

describe("narrate", () => {
  it("says nothing alarming when there are no factors and no anomalies", () => {
    const lines = narrate(analysis());
    expect(lines[0]).toBe("No elevated-risk signals were found for ada@example.com across the sources that answered.");
    expect(lines[lines.length - 1]).toMatch(/asserts nothing a source did not report/);
    expect(lines).toHaveLength(2);
  });

  it("leads with the score and lists up to three factors, pluralising the count", () => {
    const one = narrate(analysis({ factors: [factor("a")] }));
    expect(one[0]).toBe("ada@example.com scores 50 out of 100 (elevated risk).");
    expect(one[1]).toBe("The score rests on 1 risk signal, chief among them:");

    const many = narrate(analysis({ factors: [factor("a"), factor("b"), factor("c"), factor("d")] }));
    expect(many[1]).toContain("rests on 4 risk signals");
    // only three factor sentences are rendered even with four factors
    const factorLines = many.filter((l) => /evidence\.$/.test(l));
    expect(factorLines).toHaveLength(3);
  });

  it("renders anomalies even when no factor moved the score", () => {
    const lines = narrate(analysis({ anomalies: [{ id: "x", title: "Something", detail: "happened.", severity: "high" }] }));
    // score line present, but no "rests on" line since factors is empty
    expect(lines.some((l) => l.startsWith("ada@example.com scores"))).toBe(true);
    expect(lines.some((l) => /rests on/.test(l))).toBe(false);
    expect(lines).toContain("Something. happened.");
  });
});
