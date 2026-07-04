import { describe, it, expect } from "vitest";
import { MODES, LOOKUP_MODES, detectMode, type Mode } from "@/lib/client/modes";

// The mode registry backs the tab switcher, command palette, and the
// shareable-URL round-trip; detectMode powers the palette's "smart run".

describe("MODES registry invariants", () => {
  it("has 8 modes with unique ids", () => {
    expect(MODES).toHaveLength(8);
    expect(new Set(MODES.map((m) => m.id)).size).toBe(8);
  });

  it("exposes exactly the 5 single-input lookup modes, each with a placeholder", () => {
    expect(LOOKUP_MODES.map((m) => m.id)).toEqual(["phone", "email", "username", "ip", "domain"]);
    for (const m of LOOKUP_MODES) expect(m.placeholder, m.id).toBeTruthy();
  });

  it("gives every mode a non-empty label and glyph", () => {
    for (const m of MODES) {
      expect(m.label, m.id).toBeTruthy();
      expect(m.glyph, m.id).toBeTruthy();
    }
  });
});

describe("detectMode — best-effort classification", () => {
  const cases: [string, Mode][] = [
    ["+14155552671", "phone"],
    ["+1 415 555 2671", "phone"],
    ["target@domain.com", "email"],
    ["8.8.8.8", "ip"],
    ["2606:4700:4700::1111", "ip"],
    ["github.com", "domain"],
    ["sub.example.co.uk", "domain"],
    ["torvalds", "username"],
    ["", "username"],
  ];
  it.each(cases)("classifies %j as %s", (input, mode) => {
    expect(detectMode(input)).toBe(mode);
  });
});
