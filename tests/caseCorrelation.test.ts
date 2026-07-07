import { describe, it, expect } from "vitest";
import { correlateCases } from "@/lib/analysis/caseCorrelation";
import type { InvestigationCase, CaseEntity, EntityKind } from "@/lib/types";

let seq = 0;
const ent = (kind: EntityKind, value: string): CaseEntity => ({ kind, value, addedAt: ++seq });
const mkCase = (id: string, name: string, entities: CaseEntity[]): InvestigationCase => ({
  id, name, createdAt: 1, updatedAt: 1, entities,
});

describe("correlateCases", () => {
  it("returns nothing when no entity is shared across cases", () => {
    const cases = [
      mkCase("a", "Alpha", [ent("phone", "+14155552671")]),
      mkCase("b", "Bravo", [ent("email", "x@y.com")]),
    ];
    expect(correlateCases(cases)).toEqual([]);
  });

  it("surfaces an entity shared by two cases with both case refs (name-sorted)", () => {
    const cases = [
      mkCase("b", "Bravo", [ent("phone", "+14155552671"), ent("email", "solo@x.com")]),
      mkCase("a", "Alpha", [ent("phone", "+14155552671")]),
    ];
    const res = correlateCases(cases);
    expect(res).toHaveLength(1);
    expect(res[0].kind).toBe("phone");
    expect(res[0].value).toBe("+14155552671");
    expect(res[0].count).toBe(2);
    expect(res[0].cases.map((c) => c.name)).toEqual(["Alpha", "Bravo"]); // sorted by name
  });

  it("matches case-insensitively on value and de-dupes the same case once", () => {
    const cases = [
      // Same email in different case + a duplicate within one case → case counted once.
      mkCase("a", "Alpha", [ent("email", "Target@Example.com"), ent("email", "target@example.com")]),
      mkCase("b", "Bravo", [ent("email", "TARGET@EXAMPLE.COM")]),
    ];
    const res = correlateCases(cases);
    expect(res).toHaveLength(1);
    expect(res[0].count).toBe(2); // Alpha counted once despite the duplicate
    expect(res[0].cases.map((c) => c.id).sort()).toEqual(["a", "b"]);
  });

  it("treats the same value under different kinds as distinct entities", () => {
    const cases = [
      mkCase("a", "Alpha", [ent("username", "root"), ent("domain", "root")]),
      mkCase("b", "Bravo", [ent("username", "root")]),
    ];
    const res = correlateCases(cases);
    // Only username:root is shared (domain:root is in one case only).
    expect(res).toHaveLength(1);
    expect(res[0].kind).toBe("username");
  });

  it("orders results by share-count desc, then by value for ties", () => {
    const shared = "+14155550000";
    const cases = [
      mkCase("a", "Alpha", [ent("phone", shared), ent("ip", "8.8.8.8"), ent("ip", "1.1.1.1")]),
      mkCase("b", "Bravo", [ent("phone", shared), ent("ip", "8.8.8.8")]),
      mkCase("c", "Charlie", [ent("phone", shared), ent("ip", "1.1.1.1")]),
    ];
    const res = correlateCases(cases);
    // phone is in 3 cases → first. Then two IPs each in 2 cases → tie broken by value.
    expect(res[0].value).toBe(shared);
    expect(res[0].count).toBe(3);
    expect(res.slice(1).map((r) => r.value)).toEqual(["1.1.1.1", "8.8.8.8"]);
  });

  it("handles an empty input", () => {
    expect(correlateCases([])).toEqual([]);
  });
});
