import { describe, it, expect } from "vitest";
import { analyzePhoneNumber } from "@/lib/analysis/phoneAnalysis";
import { classifyAssignability } from "@/lib/analysis/phoneAssignability";

// Guards the rule that stops the tool attributing somebody else's leaked form
// field to a number nobody can hold. The live evidence behind it: on 2026-09-12
// +1 999-999-9999 scored 100/CRITICAL off 5 infostealer records and 1000 breach
// rows, and +44 20 7946 0958 — Ofcom's reserved drama range — scored 73/CRITICAL
// with a named Vidar infection.

function classify(e164: string) {
  const analysis = analyzePhoneNumber(e164);
  if (!analysis) throw new Error(`unparseable fixture: ${e164}`);
  return classifyAssignability(analysis);
}

describe("classifyAssignability", () => {
  it("passes an ordinary subscriber number through untouched", () => {
    const a = classify("+14155552671");
    expect(a).toEqual({ assignable: true, reason: null, detail: "", block: null });
  });

  it("refuses attribution for a number libphonenumber rules invalid", () => {
    const a = classify("+19999999999");
    expect(a.assignable).toBe(false);
    expect(a.reason).toBe("invalid");
    expect(a.block).toBeNull();
    expect(a.detail).toContain("no carrier ever issued it");
  });

  it("refuses attribution for the NANP fiction range", () => {
    const a = classify("+12025550123");
    expect(a.assignable).toBe(false);
    expect(a.reason).toBe("fictional");
    expect(a.block).toBe("(202) 555-0100-0199 (NANP fiction range)");
  });

  it("allows the rest of the 555 exchange, which is not blanket-reserved", () => {
    // 555-1212 is live directory assistance, so only the documented 01XX line
    // range may be treated as fiction.
    expect(classify("+12025551212").assignable).toBe(true);
    expect(classify("+12025552123").assignable).toBe(true);
  });

  it("refuses attribution for an Ofcom drama range", () => {
    const london = classify("+442079460958");
    expect(london.assignable).toBe(false);
    expect(london.reason).toBe("fictional");
    expect(london.block).toBe("020 7946 0000-0999 (London)");
    expect(london.detail).toContain("reserves for drama");

    expect(classify("+441134960123").block).toBe("0113 496 0000-0999 (Leeds)");
    expect(classify("+443069990123").block).toBe("03069 990000-990999 (non-geographic)");
  });

  it("catches the drama blocks libphonenumber already rejects, via the invalid rule", () => {
    // 01632 and 07700 900xxx are unassigned ranges libphonenumber knows about,
    // so they never reach the block table. Either way nothing is attributed.
    for (const n of ["+441632960123", "+447700900123"]) {
      const a = classify(n);
      expect(a.assignable).toBe(false);
      expect(a.reason).toBe("invalid");
    }
  });

  it("leaves real UK numbers outside the drama blocks alone", () => {
    // Same area code, a live 020 7946 neighbour one digit out of the block.
    expect(classify("+442079461958").assignable).toBe(true);
    expect(classify("+442079460958").assignable).toBe(false);
  });

  it("does not apply NANP fiction rules outside +1", () => {
    // An Indian mobile whose digits happen to contain 555 must not be caught by
    // the NANP positional rule.
    expect(classify("+919555501234").assignable).toBe(true);
  });
});
