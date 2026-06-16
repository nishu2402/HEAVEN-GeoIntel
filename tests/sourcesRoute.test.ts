import { describe, it, expect, afterEach } from "vitest";
import { GET } from "@/app/api/sources/route";

interface SourceInfo { id: string; tier: "free" | "key"; configured: boolean }
interface SourcesResponse { sources: SourceInfo[]; keyActive: number; keyTotal: number }

describe("/api/sources", () => {
  afterEach(() => { delete process.env.IPQS_API_KEY; });

  it("reports sources with boolean 'configured' flags; free sources are always on", async () => {
    const res = await GET();
    const json = (await res.json()) as SourcesResponse;

    expect(Array.isArray(json.sources)).toBe(true);
    expect(json.sources.length).toBeGreaterThan(10);
    for (const s of json.sources) expect(typeof s.configured).toBe("boolean");
    expect(json.sources.filter((s) => s.tier === "free").every((s) => s.configured)).toBe(true);
    expect(typeof json.keyActive).toBe("number");
    expect(typeof json.keyTotal).toBe("number");
    expect(json.keyActive).toBeLessThanOrEqual(json.keyTotal);
  });

  it("reflects a configured key WITHOUT ever leaking its value", async () => {
    const secret = "SECRET_KEY_VALUE_do_not_leak_9876543210";
    process.env.IPQS_API_KEY = secret;

    const res = await GET();
    const json = (await res.json()) as SourcesResponse;

    const ipqs = json.sources.find((s) => s.id === "ipqs");
    expect(ipqs?.configured).toBe(true);
    // The whole serialized response must never contain the actual key value.
    expect(JSON.stringify(json)).not.toContain(secret);
  });
});
