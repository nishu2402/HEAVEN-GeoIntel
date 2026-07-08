import { describe, it, expect } from "vitest";
import { caseTimeline } from "@/lib/analysis/caseTimeline";
import type { InvestigationCase, CaseEntity, EntityKind } from "@/lib/types";

const ent = (kind: EntityKind, value: string, addedAt: number): CaseEntity => ({ kind, value, addedAt });
const mkCase = (createdAt: number, entities: CaseEntity[]): InvestigationCase => ({
  id: "c1", name: "Case", createdAt, updatedAt: createdAt, entities,
});

describe("caseTimeline", () => {
  it("leads with the 'created' marker, then entities oldest-first", () => {
    const c = mkCase(1000, [
      ent("ip", "8.8.8.8", 3000),
      ent("domain", "dns.google", 2000),
    ]);
    const t = caseTimeline(c);
    expect(t.map((e) => e.type)).toEqual(["created", "entity", "entity"]);
    expect(t[0]).toEqual({ at: 1000, type: "created", label: "Case created" });
    expect(t[1]).toMatchObject({ at: 2000, type: "entity", label: "dns.google", entityKind: "domain" });
    expect(t[2]).toMatchObject({ at: 3000, type: "entity", label: "8.8.8.8", entityKind: "ip" });
  });

  it("keeps stored order for entities sharing a timestamp (stable sort)", () => {
    const c = mkCase(500, [
      ent("email", "a@x.com", 500),
      ent("username", "b", 500),
    ]);
    const t = caseTimeline(c);
    // created is at 500 too — it was pushed first, so it stays first; then a@x.com, then b.
    expect(t.map((e) => e.label)).toEqual(["Case created", "a@x.com", "b"]);
  });

  it("returns just the created marker for an empty case", () => {
    expect(caseTimeline(mkCase(42, []))).toEqual([{ at: 42, type: "created", label: "Case created" }]);
  });
});
