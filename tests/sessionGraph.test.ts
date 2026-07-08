// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { getSessionGraph, saveSessionGraph, clearSessionGraph } from "@/lib/client/sessionGraph";
import type { GraphEntity } from "@/components/graph/LinkGraph";

// The Session Link Graph persistence layer (localStorage-backed). It must be
// SSR-safe, never throw, validate every stored node (kind + non-empty value),
// and cap the stored graph. jsdom provides window but not a working
// localStorage, so we install a minimal in-memory Storage (same as the
// lookupHistory suite).
beforeAll(() => {
  const store = new Map<string, string>();
  const mem: Storage = {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => { store.delete(k); },
    setItem: (k, v) => { store.set(k, String(v)); },
  };
  Object.defineProperty(globalThis, "localStorage", { value: mem, configurable: true, writable: true });
});

beforeEach(() => localStorage.clear());

const KEY = "hv-session-graph-v1";

describe("sessionGraph", () => {
  it("starts empty and round-trips a saved graph", () => {
    expect(getSessionGraph()).toEqual([]);
    const g: GraphEntity[] = [
      { kind: "domain", value: "dns.google" },
      { kind: "ip", value: "8.8.8.8" },
    ];
    saveSessionGraph(g);
    expect(getSessionGraph()).toEqual(g);
  });

  it("drops malformed nodes on read (bad kind, empty/blank value, non-object)", () => {
    localStorage.setItem(KEY, JSON.stringify([
      { kind: "domain", value: "keep.example" },
      { kind: "bogus", value: "x" },       // unknown kind → dropped
      { kind: "ip", value: "   " },          // blank value → dropped
      { kind: "email", value: 42 },          // non-string value → dropped
      null,                                    // non-object → dropped
      "nope",                                 // non-object → dropped
    ]));
    expect(getSessionGraph()).toEqual([{ kind: "domain", value: "keep.example" }]);
  });

  it("sanitises malformed nodes on write, keeping only valid ones", () => {
    saveSessionGraph([
      { kind: "phone", value: "+14155552671" },
      { kind: "domain", value: "  " } as GraphEntity,     // blank → dropped
      { kind: "nope" as GraphEntity["kind"], value: "x" }, // bad kind → dropped
    ]);
    expect(getSessionGraph()).toEqual([{ kind: "phone", value: "+14155552671" }]);
  });

  it("caps the persisted graph at 200 nodes", () => {
    const many: GraphEntity[] = Array.from({ length: 250 }, (_, i) => ({ kind: "ip", value: `10.0.0.${i}` }));
    saveSessionGraph(many);
    expect(getSessionGraph()).toHaveLength(200);
  });

  it("returns [] on corrupt storage instead of throwing", () => {
    localStorage.setItem(KEY, "{not json");
    expect(getSessionGraph()).toEqual([]);
  });

  it("returns [] when stored JSON is valid but not an array", () => {
    localStorage.setItem(KEY, '{"nope":true}');
    expect(getSessionGraph()).toEqual([]);
  });

  it("clearSessionGraph forgets the persisted graph", () => {
    saveSessionGraph([{ kind: "username", value: "torvalds" }]);
    clearSessionGraph();
    expect(getSessionGraph()).toEqual([]);
  });

  it("is best-effort: save/clear never throw when localStorage is unavailable", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() { throw new Error("SecurityError: localStorage blocked"); },
    });
    try {
      expect(getSessionGraph()).toEqual([]);            // read → [] (catch)
      expect(() => saveSessionGraph([{ kind: "ip", value: "1.1.1.1" }])).not.toThrow(); // write swallowed
      expect(() => clearSessionGraph()).not.toThrow();  // clear swallowed
    } finally {
      if (original) Object.defineProperty(globalThis, "localStorage", original);
    }
  });
});
