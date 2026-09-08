import { describe, it, expect } from "vitest";
import { insightsToEntities, summarizeInsights, runTargetFor } from "@/lib/ai/mlSignals";
import type { TextInsights } from "@/lib/ai/inference";

// The bridge from text insights to graph entities and a grounded summary. Both
// functions are pure; the tests build insight bundles directly so every branch
// (host derivation, dedupe, empty guards, the tie sort) is hit with real shapes.

const insights = (over: Partial<TextInsights>): TextInsights => ({
  length: 0,
  entities: [],
  classification: { category: "neutral", confidence: 0, scores: [] },
  language: { language: "unknown", confidence: 0 },
  ...over,
});

describe("insightsToEntities", () => {
  it("maps identifiers onto graph kinds and derives hosts", () => {
    const out = insightsToEntities(insights({
      entities: [
        { kind: "email", value: "User@Example.com", confidence: 0.97 },
        { kind: "email", value: "user@example.com", confidence: 0.97 }, // dedupes with the first
        { kind: "email", value: "bad@", confidence: 0.97 },             // empty host → no domain
        { kind: "url", value: "https://sub.evil.io/path", confidence: 0.97 },
        { kind: "url", value: "not a url", confidence: 0.97 },          // unparseable → no host
        { kind: "ip", value: "8.8.8.8", confidence: 0.95 },
        { kind: "domain", value: "example.com", confidence: 0.7 },      // dedupes with the email host
        { kind: "domain", value: "fresh.org", confidence: 0.7 },
        { kind: "phone", value: "+14155552671", confidence: 0.9 },
        { kind: "username", value: "octocat", confidence: 0.55 },
        { kind: "wallet", value: "0xabc", confidence: 0.95 },           // not a graph kind
        { kind: "hash", value: "deadbeef", confidence: 0.85 },          // not a graph kind
      ],
    }));

    expect(out).toEqual([
      { kind: "email", value: "User@Example.com" },
      { kind: "domain", value: "example.com" },
      { kind: "email", value: "bad@" },
      { kind: "domain", value: "sub.evil.io" },
      { kind: "ip", value: "8.8.8.8" },
      { kind: "domain", value: "fresh.org" },
      { kind: "phone", value: "+14155552671" },
      { kind: "username", value: "octocat" },
    ]);
  });

  it("returns nothing when there are no entities", () => {
    expect(insightsToEntities(insights({}))).toEqual([]);
  });
});

describe("runTargetFor", () => {
  it("maps a direct kind to its lookup mode", () => {
    expect(runTargetFor({ kind: "email", value: "a@b.com", confidence: 1 })).toEqual({ mode: "email", value: "a@b.com" });
    expect(runTargetFor({ kind: "hash", value: "deadbeef", confidence: 1 })).toEqual({ mode: "hash", value: "deadbeef" });
  });

  it("runs a URL as a domain lookup on its host", () => {
    expect(runTargetFor({ kind: "url", value: "https://www.evil.io/x", confidence: 1 })).toEqual({ mode: "domain", value: "evil.io" });
  });

  it("falls back to the raw value when a URL will not parse", () => {
    expect(runTargetFor({ kind: "url", value: "not a url", confidence: 1 })).toEqual({ mode: "domain", value: "not a url" });
  });

  it("falls back to the raw value when a URL parses but carries no host", () => {
    // file:// URLs parse cleanly yet have an empty hostname.
    expect(runTargetFor({ kind: "url", value: "file:///etc/passwd", confidence: 1 })).toEqual({ mode: "domain", value: "file:///etc/passwd" });
  });
});

describe("summarizeInsights", () => {
  it("describes counts, topic and language when present", () => {
    const lines = summarizeInsights(insights({
      entities: [
        { kind: "email", value: "a@b.com", confidence: 1 },
        { kind: "ip", value: "1.2.3.4", confidence: 1 },
      ],
      classification: { category: "credentials", confidence: 0.75, scores: [{ category: "credentials", score: 3 }] },
      language: { language: "en", confidence: 0.9 },
    }));
    // Two different kinds tie at 1 each → sorted by name (email before ip).
    expect(lines[0]).toBe("Extracted 2 identifiers: 1 email, 1 ip.");
    expect(lines[1]).toBe("Topic reads as leaked credentials (75% of the topic weight).");
    expect(lines[2]).toBe("Language detected: en.");
    expect(lines[lines.length - 1]).toContain("verbatim from the text you provided");
  });

  it("states plainly when nothing was found, with no topic or language line", () => {
    const lines = summarizeInsights(insights({}));
    expect(lines[0]).toBe("No identifiers were extracted from this text.");
    expect(lines.some((l) => l.startsWith("Topic reads"))).toBe(false);
    expect(lines.some((l) => l.startsWith("Language detected"))).toBe(false);
    expect(lines).toHaveLength(2);
  });
});
