import { describe, it, expect } from "vitest";
import { GET } from "@/app/api/notable-breaches/route";

interface NotableBreach { name: string; records: number | null; date: string | null }
interface NotableResponse { source: string; version: string | null; count: number; breaches: NotableBreach[] }

// The notable-breaches route serves the vendored Wikipedia tier straight from the
// bundled snapshot: no key, no upstream call. It is a reference of institutional
// breaches by size, so the order is largest first and no per-identifier field
// (data classes) ever leaks into it.

describe("/api/notable-breaches", () => {
  it("serves the vendored reference, largest first, class-less, with an honest count", async () => {
    const res = await GET();
    const json = (await res.json()) as NotableResponse;

    expect(json.source).toMatch(/wikipedia/i);
    expect(json.count).toBeGreaterThan(0);
    expect(json.count).toBe(json.breaches.length);

    // Largest first: every row is at least as big as the next.
    for (let i = 1; i < json.breaches.length; i++) {
      expect(json.breaches[i - 1].records ?? 0).toBeGreaterThanOrEqual(json.breaches[i].records ?? 0);
    }

    // A reference row is a name, a size and a year — nothing about an identifier.
    const sample = json.breaches[0];
    expect(typeof sample.name).toBe("string");
    expect(JSON.stringify(json)).not.toContain("dataClasses");
  });

  it("carries the Wikipedia snapshot revision as provenance", async () => {
    const res = await GET();
    const json = (await res.json()) as NotableResponse;
    expect(typeof json.version === "string" || json.version === null).toBe(true);
  });
});
