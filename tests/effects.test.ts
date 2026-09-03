import { describe, it, expect, beforeEach } from "vitest";
import { effectsEnabled, setEffects, prefersReducedMotion, FX_KEY } from "@/lib/client/effects";

// The effects setting reads localStorage + matchMedia, neither of which exists in
// the node test env — stub the minimum so we can unit-test the pure decision logic.
let reducedMotion = false;

function mockStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
}

beforeEach(() => {
  reducedMotion = false;
  const g = globalThis as unknown as Record<string, unknown>;
  g.localStorage = mockStorage();
  g.CustomEvent = class { constructor(public type: string) {} };
  g.window = {
    matchMedia: () => ({ matches: reducedMotion }),
    dispatchEvent: () => true,
  };
});

describe("effects setting", () => {
  it("defaults ON when nothing is set and the OS doesn't request reduced motion", () => {
    expect(effectsEnabled()).toBe(true);
  });

  it("defaults OFF when the OS prefers reduced motion (and the user hasn't chosen)", () => {
    reducedMotion = true;
    expect(prefersReducedMotion()).toBe(true);
    expect(effectsEnabled()).toBe(false);
  });

  it("an explicit user choice overrides the OS preference", () => {
    reducedMotion = true;
    setEffects(true); // user turns effects ON despite reduced-motion
    expect(effectsEnabled()).toBe(true);
    expect(localStorage.getItem(FX_KEY)).toBe("1");

    setEffects(false); // user turns them OFF
    expect(effectsEnabled()).toBe(false);
    expect(localStorage.getItem(FX_KEY)).toBe("0");
  });

  it("never throws if storage is unavailable", () => {
    // Simulate unavailable storage (SSR, private mode) with a stub whose access
    // throws. Assigning `undefined` instead would, on Node >= 24, leave the
    // native `localStorage` accessor in place; reading it then falls back to the
    // unconfigured web-storage getter and prints a spurious ExperimentalWarning.
    // A throwing stub exercises the same catch paths without hitting that getter.
    const failing = () => { throw new Error("unavailable"); };
    (globalThis as unknown as Record<string, unknown>).localStorage = {
      getItem: failing,
      setItem: failing,
    };
    expect(() => effectsEnabled()).not.toThrow();
    expect(() => setEffects(true)).not.toThrow();
  });

  it("prefersReducedMotion returns false when matchMedia throws (unsupported)", () => {
    (globalThis as unknown as { window: unknown }).window = {
      matchMedia: () => { throw new Error("not implemented"); },
    };
    expect(prefersReducedMotion()).toBe(false);
  });
});
