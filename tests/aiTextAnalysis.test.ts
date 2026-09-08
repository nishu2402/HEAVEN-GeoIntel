import { describe, it, expect } from "vitest";
import { extractEntities, classifyText, detectLanguage } from "@/lib/ai/textAnalysis";
import type { MlEntityKind } from "@/lib/ai/textAnalysis";

// The on-device text model is pure and grounded: extraction only ever returns a
// substring of the input that passed a shape check, classification labels the
// topic from a bundled word table, and language ID is script + stopword based.
// Every branch of all three is exercised here so the 100% gate is met with real
// inputs, not contrivances.

const byKind = (text: string, kind: MlEntityKind): string[] =>
  extractEntities(text).filter((e) => e.kind === kind).map((e) => e.value);

describe("extractEntities", () => {
  const text = [
    "Contact admin@Example.com or admin@example.com again.",
    "Visit https://malware.evil.io/path?x=1 and http://bad.example.net.",
    "ETH 0x1111111111111111111111111111111111111111",
    "BTC bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
    "legacy 1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2",
    "SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "IPv4 8.8.8.8 and IPv6 2001:0db8:0000:0000:0000:ff00:0042:8329",
    "phone +14155552671",
    "handle @octocat mentions",
    "domain plain example.com but file malware.exe should be skipped",
  ].join("\n");

  it("pulls each identifier kind out of one mixed block", () => {
    expect(byKind(text, "url")).toEqual([
      "https://malware.evil.io/path?x=1",
      "http://bad.example.net",
    ]);
    // Two identical emails collapse to one (dedupe), lower-cased.
    expect(byKind(text, "email")).toEqual(["admin@example.com"]);
    expect(byKind(text, "wallet")).toEqual([
      "0x1111111111111111111111111111111111111111",
      "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
      "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2",
    ]);
    expect(byKind(text, "hash")).toEqual([
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    ]);
    expect(byKind(text, "ip")).toEqual(["8.8.8.8", "2001:0db8:0000:0000:0000:ff00:0042:8329"]);
    expect(byKind(text, "phone")).toEqual(["+14155552671"]);
    // The @handle is captured from group 1, without the leading @.
    expect(byKind(text, "username")).toEqual(["octocat"]);
  });

  it("extracts a bare domain only when its TLD is a real public suffix", () => {
    // A URL's host is consumed by the URL match, so the only free-standing domain
    // is `example.com`; `malware.exe` is rejected because `exe` is not a TLD.
    expect(byKind(text, "domain")).toEqual(["example.com"]);
  });

  it("returns nothing for text with no identifiers", () => {
    expect(extractEntities("just some ordinary words here")).toEqual([]);
  });

  it("carries a confidence on every entity", () => {
    const handle = extractEntities("see @jdoe").find((e) => e.kind === "username");
    expect(handle?.confidence).toBeGreaterThan(0);
    expect(handle?.confidence).toBeLessThan(1);
  });
});

describe("classifyText", () => {
  it("labels a credential dump", () => {
    const c = classifyText("password dump combo list, plaintext credentials leaked");
    expect(c.category).toBe("credentials");
    expect(c.confidence).toBeGreaterThan(0);
    expect(c.scores[0].category).toBe("credentials");
  });

  it("returns neutral with no scores when nothing fires", () => {
    const c = classifyText("the weather is nice today");
    expect(c).toEqual({ category: "neutral", confidence: 0, scores: [] });
  });

  it("breaks a tie by category name, alphabetically", () => {
    // `leak` (credentials 2) and `scan` (network 2) tie; credentials sorts first.
    const c = classifyText("leak scan");
    expect(c.category).toBe("credentials");
    expect(c.confidence).toBeCloseTo(0.5, 5);
    expect(c.scores.map((s) => s.category)).toEqual(["credentials", "network"]);
  });

  it("counts a shared keyword toward both of its topics", () => {
    // `breach` votes for credentials and threat both.
    const c = classifyText("breach breach breach");
    const cats = c.scores.map((s) => s.category);
    expect(cats).toContain("credentials");
    expect(cats).toContain("threat");
  });
});

describe("detectLanguage", () => {
  it("reads a non-Latin script directly", () => {
    expect(detectLanguage("Это тестовое сообщение").language).toBe("ru");
    // Greek: the Cyrillic and CJK patterns miss, the Greek one hits.
    expect(detectLanguage("Καλημέρα κόσμε φίλε").language).toBe("el");
  });

  it("scores Latin text by stopword overlap", () => {
    expect(detectLanguage("the quick brown fox and the lazy dog").language).toBe("en");
  });

  it("breaks a Latin tie by language code", () => {
    // `una`∈{es,it}, `que`∈{es,fr,pt}: es scores 2, the rest 1 each. The 1-1-1
    // tail exercises the alphabetical tiebreak in the sort; es is the clear top.
    const g = detectLanguage("una que");
    expect(g.language).toBe("es");
    expect(g.confidence).toBeCloseTo(2 / 5, 5);
  });

  it("returns unknown when there is no script or stopword signal", () => {
    expect(detectLanguage("xyzzy plugh qwerty")).toEqual({ language: "unknown", confidence: 0 });
  });
});
