// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { getLookups, pushLookup, clearLookups, LOOKUPS_EVENT } from "@/lib/client/lookupHistory";

// The RECENT-lookups feature (localStorage-backed). Newest-first, de-duped by
// kind+value (case-insensitive), capped at 30, and best-effort (never throws).
// jsdom here provides window/CustomEvent but not a working localStorage, so we
// install a minimal in-memory Storage.
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

describe("lookupHistory", () => {
  it("starts empty and records newest-first", () => {
    expect(getLookups()).toEqual([]);
    pushLookup("phone", "+14155552671");
    pushLookup("email", "a@b.com");
    const items = getLookups();
    expect(items.map((i) => i.value)).toEqual(["a@b.com", "+14155552671"]);
    expect(items[0].kind).toBe("email");
    expect(typeof items[0].ts).toBe("number");
  });

  it("de-dupes by kind+value (case-insensitive) and moves the hit to the front", () => {
    pushLookup("email", "Person@Example.com");
    pushLookup("username", "torvalds");
    pushLookup("email", "person@example.com"); // same email, different case
    const items = getLookups();
    expect(items.filter((i) => i.kind === "email")).toHaveLength(1);
    expect(items[0].kind).toBe("email"); // re-inserted at front
    expect(items).toHaveLength(2);
  });

  it("keeps the same value under different kinds as distinct entries", () => {
    pushLookup("username", "8888");
    pushLookup("phone", "8888");
    expect(getLookups()).toHaveLength(2);
  });

  it("ignores empty/whitespace values", () => {
    pushLookup("phone", "   ");
    pushLookup("phone", "");
    expect(getLookups()).toEqual([]);
  });

  it("caps history at 30, dropping the oldest", () => {
    for (let i = 0; i < 35; i++) pushLookup("ip", `10.0.0.${i}`);
    const items = getLookups();
    expect(items).toHaveLength(30);
    expect(items[0].value).toBe("10.0.0.34");  // newest
    expect(items.some((i) => i.value === "10.0.0.0")).toBe(false); // oldest evicted
  });

  it("clearLookups empties history", () => {
    pushLookup("phone", "+14155552671");
    clearLookups();
    expect(getLookups()).toEqual([]);
  });

  it("returns [] on corrupt storage instead of throwing", () => {
    localStorage.setItem("hv-lookups-v1", "{not json");
    expect(getLookups()).toEqual([]);
  });

  it("returns [] when stored JSON is valid but not an array", () => {
    localStorage.setItem("hv-lookups-v1", '{"nope":true}');
    expect(getLookups()).toEqual([]);
  });

  it("emits a change event on push and clear (so live views refresh)", () => {
    const spy = vi.fn();
    window.addEventListener(LOOKUPS_EVENT, spy);
    pushLookup("phone", "+14155552671");
    clearLookups();
    expect(spy).toHaveBeenCalledTimes(2);
    window.removeEventListener(LOOKUPS_EVENT, spy);
  });
});
