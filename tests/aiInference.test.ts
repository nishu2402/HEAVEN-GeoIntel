import { describe, it, expect } from "vitest";
import { analyzeText, defaultTextInference, type TextInference } from "@/lib/ai/inference";

// The port composes the three model calls into one insight bundle and lets a
// caller inject a different backend. The default binding is the keyless model.

describe("analyzeText", () => {
  it("runs every model with the default keyless backend", () => {
    const insights = analyzeText("  password dump from 8.8.8.8 and admin@example.com  ");
    expect(insights.length).toBe("password dump from 8.8.8.8 and admin@example.com".length);
    expect(insights.entities.map((e) => e.kind)).toContain("ip");
    expect(insights.entities.map((e) => e.kind)).toContain("email");
    expect(insights.classification.category).toBe("credentials");
    expect(insights.language.language).toBe("en"); // "from" / "and" are en stopwords
  });

  it("uses an injected backend instead of the default", () => {
    const mock: TextInference = {
      extractEntities: () => [{ kind: "domain", value: "mock.test", confidence: 1 }],
      classify: () => ({ category: "threat", confidence: 1, scores: [{ category: "threat", score: 9 }] }),
      detectLanguage: () => ({ language: "xx", confidence: 1 }),
    };
    const insights = analyzeText("anything at all", mock);
    expect(insights.entities).toEqual([{ kind: "domain", value: "mock.test", confidence: 1 }]);
    expect(insights.classification.category).toBe("threat");
    expect(insights.language.language).toBe("xx");
  });
});

describe("defaultTextInference", () => {
  it("exposes the bundled model behind the three port methods", () => {
    expect(defaultTextInference.extractEntities("ip 1.2.3.4").some((e) => e.kind === "ip")).toBe(true);
    expect(defaultTextInference.classify("malware payload dropper").category).toBe("threat");
    expect(defaultTextInference.detectLanguage("le chat est sur la table").language).toBe("fr");
  });
});
