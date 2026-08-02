import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { ENDPOINTS } from "@/lib/api/endpoints";
import { buildOpenApiSpec } from "@/lib/api/openapi";
import { SOURCES, SOURCES_BY_ID, sourceName, sourcesForMode } from "@/lib/sources/manifest";

// The structural guarantee behind the generated spec: walk the App Router API
// directory, extract every exported HTTP method, and require the registry to
// match it EXACTLY. Adding a route without documenting it — or documenting one
// that no longer exists — fails here rather than silently shipping a spec that
// lies about the API.

const API_DIR = path.join(process.cwd(), "src/app/api");

function actualOperations(): string[] {
  const ops: string[] = [];
  for (const entry of readdirSync(API_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(API_DIR, entry.name, "route.ts");
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/^export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/gm)) {
      ops.push(`${m[1].toLowerCase()} /api/${entry.name}`);
    }
  }
  return ops.sort();
}

describe("OpenAPI spec covers every route", () => {
  it("documents exactly the operations the app exposes", () => {
    const documented = ENDPOINTS.map((e) => `${e.method} ${e.path}`).sort();
    expect(documented).toEqual(actualOperations());
  });

  it("emits a path item for every registry entry", () => {
    const spec = buildOpenApiSpec();
    const paths = spec.paths as Record<string, Record<string, unknown>>;
    for (const e of ENDPOINTS) {
      expect(paths[e.path], `missing path ${e.path}`).toBeDefined();
      expect(paths[e.path][e.method], `missing ${e.method} ${e.path}`).toBeDefined();
    }
  });

  it("gives every operation a unique operationId", () => {
    const spec = buildOpenApiSpec();
    const paths = spec.paths as Record<string, Record<string, { operationId: string }>>;
    const ids = Object.values(paths).flatMap((item) => Object.values(item).map((op) => op.operationId));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("resolves every $ref against a defined schema", () => {
    const spec = buildOpenApiSpec();
    const schemas = (spec.components as { schemas: Record<string, unknown> }).schemas;
    const refs = new Set<string>();
    (function walk(node: unknown): void {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== "object") return;
      for (const [k, v] of Object.entries(node)) {
        if (k === "$ref" && typeof v === "string") refs.add(v.replace("#/components/schemas/", ""));
        else walk(v);
      }
    })(spec);
    for (const ref of refs) expect(schemas[ref], `undefined schema ${ref}`).toBeDefined();
  });

  it("describes the free and keyed sources from the manifest", () => {
    const description = (buildOpenApiSpec().info as { description: string }).description;
    for (const s of SOURCES) expect(description).toContain(s.name);
  });

  it("documents rate-limit headers on rate-limited operations only", () => {
    const spec = buildOpenApiSpec();
    const paths = spec.paths as Record<string, Record<string, { responses: Record<string, unknown> }>>;
    for (const e of ENDPOINTS) {
      const responses = paths[e.path][e.method].responses;
      expect(Boolean(responses["429"]), `429 on ${e.method} ${e.path}`).toBe(Boolean(e.rateLimited));
    }
  });
});

describe("source manifest", () => {
  it("has unique ids", () => {
    const ids = SOURCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every keyed source at least one key name and a signup URL", () => {
    for (const s of SOURCES.filter((s) => s.tier === "key")) {
      expect(s.keys?.length, `${s.id} has no keys`).toBeGreaterThan(0);
      expect(s.signup, `${s.id} has no signup URL`).toMatch(/^https:\/\//);
    }
  });

  it("gives every free source no key requirement", () => {
    for (const s of SOURCES.filter((s) => s.tier === "free")) {
      expect(s.keys, `${s.id} is free but declares keys`).toBeUndefined();
    }
  });

  it("indexes every source by id", () => {
    expect(SOURCES_BY_ID.size).toBe(SOURCES.length);
    expect(SOURCES_BY_ID.get("hudsonRock")?.name).toBe("Hudson Rock");
  });

  it("selects the sources a mode actually fans out to", () => {
    expect(sourcesForMode("ip").map((s) => s.id)).toEqual([
      "ip-api.com", "Shodan InternetDB", "GreyNoise Community",
    ]);
    expect(sourcesForMode("domain").map((s) => s.id)).toEqual([
      "dns", "whois", "subdomains", "wayback",
    ]);
    // Phone is the mode with the most keyed sources. Keyless it now runs two —
    // Hudson Rock and LeakCheck — which is the whole point of Phase 3.2.
    const phone = sourcesForMode("phone");
    expect(phone.map((s) => s.id)).toContain("hudsonRock");
    expect(phone.filter((s) => s.tier === "free").map((s) => s.id)).toEqual(["hudsonRock", "leakCheck"]);
    expect(sourcesForMode("cases")).toEqual([]);
  });

  it("resolves a display name, falling back to the id for an unknown source", () => {
    expect(sourceName("xon")).toBe("XposedOrNot");
    expect(sourceName("not-a-source")).toBe("not-a-source");
  });
});
