import { describe, it, expect } from "vitest";
import { buildCaseBriefing } from "@/lib/ai/caseBriefing";
import type { InvestigationCase } from "@/lib/types";

// The case briefing counts what is pinned and reads the notes with the on-device
// model. Pure; every branch (empty case, notes present/absent, extracted ids,
// topic) is covered with real inputs.

const caseOf = (over: Partial<InvestigationCase>): InvestigationCase => ({
  id: "c1", name: "Case", createdAt: 0, updatedAt: 0, entities: [], ...over,
});

describe("buildCaseBriefing", () => {
  it("summarises composition and reads identifiers + topic from the notes", () => {
    const b = buildCaseBriefing(caseOf({
      entities: [
        { kind: "email", value: "a@b.com", addedAt: 0 },
        { kind: "email", value: "c@d.com", addedAt: 0 },
        { kind: "domain", value: "b.com", addedAt: 0 },
      ],
      notes: "password dump seen at 8.8.8.8 for victim@example.com",
    }));

    expect(b.total).toBe(3);
    // email (2) sorts before domain (1).
    expect(b.entityCounts).toEqual([
      { kind: "email", count: 2 },
      { kind: "domain", count: 1 },
    ]);
    expect(b.lines[0]).toBe("This case holds 3 identifiers: 2 emails, 1 domain.");
    expect(b.notesInsights).not.toBeNull();
    expect(b.lines.some((l) => l.includes("the model can extract"))).toBe(true);
    expect(b.lines.some((l) => l.includes("read as credentials"))).toBe(true);
  });

  it("handles an empty case with no notes", () => {
    const b = buildCaseBriefing(caseOf({}));
    expect(b.total).toBe(0);
    expect(b.notesInsights).toBeNull();
    expect(b.lines[0]).toBe("This case has no identifiers pinned yet.");
    expect(b.lines).toHaveLength(2); // composition line + disclaimer only
  });

  it("reads notes that contain no identifiers and no strong topic", () => {
    const b = buildCaseBriefing(caseOf({
      entities: [{ kind: "ip", value: "1.2.3.4", addedAt: 0 }],
      notes: "met the analyst on tuesday to review",
    }));
    expect(b.notesInsights).not.toBeNull();
    // No extractable identifiers and a neutral topic → neither optional line.
    expect(b.lines.some((l) => l.includes("the model can extract"))).toBe(false);
    expect(b.lines.some((l) => l.includes("read as"))).toBe(false);
  });
});
