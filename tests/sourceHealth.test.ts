import { describe, it, expect, beforeEach } from "vitest";
import {
  healthSnapshot,
  mark,
  markAll,
  provenance,
  resetHealth,
  settleSources,
  timedValue,
} from "@/lib/server/sourceHealth";

// Every lookup mode now reports source outcomes in ONE shape. The two rules
// that carry weight: a rejected source must never fail the whole lookup, and
// "no API key configured" must not be presented as an outage.

beforeEach(resetHealth);

describe("settleSources", () => {
  it("returns each source's result keyed by name", async () => {
    const { results } = await settleSources({
      alpha: Promise.resolve({ ok: true, data: 1 }),
      beta: Promise.resolve({ ok: false, error: "HTTP 500" }),
    });
    expect(results.alpha).toEqual({ ok: true, data: 1 });
    expect(results.beta).toEqual({ ok: false, error: "HTTP 500" });
  });

  it("converts a rejection into a failed envelope instead of throwing", async () => {
    // Typed as the success shape: the point is that callers can keep their
    // normal envelope type even though this promise rejects.
    const boom: Promise<{ ok: boolean; error?: string }> = Promise.reject(new Error("network died"));
    const { results, health } = await settleSources({ alpha: boom });
    expect(results.alpha.ok).toBe(false);
    expect(results.alpha.error).toBe("request failed");
    expect(health[0]).toMatchObject({ source: "alpha", ok: false, error: "request failed" });
  });

  it("keeps a healthy source's result when a sibling rejects", async () => {
    const { results } = await settleSources({
      good: Promise.resolve({ ok: true }),
      bad: Promise.reject(new Error("nope")),
    });
    expect(results.good.ok).toBe(true);
    expect(results.bad.ok).toBe(false);
  });

  it("emits provenance for every source, with timing", async () => {
    const { health } = await settleSources({
      a: Promise.resolve({ ok: true }),
      b: Promise.resolve({ ok: false, error: "HTTP 404" }),
    });
    expect(health.map((h) => h.source)).toEqual(["a", "b"]);
    for (const h of health) {
      expect(h.ms).toBeGreaterThanOrEqual(0);
      expect(h.fetchedAt).toBeGreaterThan(0);
    }
  });

  it("records what it saw into the health snapshot", async () => {
    await settleSources({ alpha: Promise.resolve({ ok: true }) });
    expect(healthSnapshot().alpha.ok).toBe(true);
  });
});

describe("provenance", () => {
  it("marks an unconfigured source as skipped, not failed", () => {
    const p = provenance("ipqs", { ok: false, error: "NOT_CONFIGURED" }, 3);
    expect(p.skipped).toBe(true);
    expect(p.ok).toBe(false);
    expect(p.error).toBe("NOT_CONFIGURED");
  });

  it("does not mark a genuine failure as skipped", () => {
    expect(provenance("ipqs", { ok: false, error: "HTTP 500" }, 3).skipped).toBeUndefined();
  });

  it("omits error entirely on success", () => {
    const p = provenance("gravatar", { ok: true }, 12);
    expect(p).toEqual({ source: "gravatar", ok: true, ms: 12, fetchedAt: expect.any(Number) });
  });
});

describe("timedValue", () => {
  it("times a plain-data source and applies the ok predicate", async () => {
    const hit = await timedValue("whois", Promise.resolve({ registrar: "x" }), (v) => v !== null);
    expect(hit.value).toEqual({ registrar: "x" });
    expect(hit.provenance).toMatchObject({ source: "whois", ok: true });
    expect(hit.provenance.ms).toBeGreaterThanOrEqual(0);

    const miss = await timedValue("whois", Promise.resolve(null), (v) => v !== null);
    expect(miss.provenance.ok).toBe(false);
  });

  it("records into the snapshot", async () => {
    await timedValue("dns", Promise.resolve([1]), (v) => v.length > 0);
    expect(healthSnapshot().dns.ok).toBe(true);
  });
});

describe("health snapshot", () => {
  it("keeps only the most recent observation per source", () => {
    mark({ source: "a", ok: false, ms: 1, fetchedAt: 1 });
    mark({ source: "a", ok: true, ms: 2, fetchedAt: 2 });
    expect(healthSnapshot().a).toEqual({ source: "a", ok: true, ms: 2, fetchedAt: 2 });
  });

  it("markAll records a batch and returns it unchanged", () => {
    const batch = [
      { source: "x", ok: true, ms: 1, fetchedAt: 1 },
      { source: "y", ok: false, ms: 2, fetchedAt: 2 },
    ];
    expect(markAll(batch)).toBe(batch);
    expect(Object.keys(healthSnapshot()).sort()).toEqual(["x", "y"]);
  });

  it("resetHealth empties it", () => {
    mark({ source: "a", ok: true, ms: 1, fetchedAt: 1 });
    resetHealth();
    expect(healthSnapshot()).toEqual({});
  });
});
