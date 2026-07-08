import { describe, it, expect } from "vitest";
import { mergeEntities, mergeCaseInto } from "@/lib/analysis/caseMerge";
import type { CaseEntity, EntityKind, InvestigationCase } from "@/lib/types";

const ent = (kind: EntityKind, value: string, addedAt: number): CaseEntity => ({ kind, value, addedAt });
const mkCase = (name: string, notes: string | undefined, entities: CaseEntity[]): InvestigationCase => ({
  id: name, name, createdAt: 0, updatedAt: 0, entities, notes,
});

describe("mergeEntities", () => {
  it("de-dupes by kind+value, keeps the earliest sighting, and orders oldest-first", () => {
    const target: CaseEntity[] = [ent("ip", "8.8.8.8", 300), ent("domain", "later.example", 400)];
    const source: CaseEntity[] = [ent("ip", "8.8.8.8", 100), ent("email", "a@b.com", 200)];
    // The shared IP keeps the earlier addedAt (100, from source); the rest fold in.
    expect(mergeEntities(target, source)).toEqual([
      ent("ip", "8.8.8.8", 100),
      ent("email", "a@b.com", 200),
      ent("domain", "later.example", 400),
    ]);
  });

  it("keeps the existing (earlier) entity when the incoming duplicate is newer", () => {
    const target: CaseEntity[] = [ent("ip", "1.1.1.1", 100)];
    const source: CaseEntity[] = [ent("ip", "1.1.1.1", 500)]; // newer → must NOT replace
    expect(mergeEntities(target, source)).toEqual([ent("ip", "1.1.1.1", 100)]);
  });

  it("matches duplicates case-insensitively", () => {
    const target: CaseEntity[] = [ent("domain", "Example.com", 100)];
    const source: CaseEntity[] = [ent("domain", "example.com", 50)];
    expect(mergeEntities(target, source)).toEqual([ent("domain", "example.com", 50)]);
  });
});

describe("mergeCaseInto", () => {
  it("appends the source notes under a labelled divider when both have notes", () => {
    const target = mkCase("Target", "target findings", [ent("ip", "8.8.8.8", 100)]);
    const source = mkCase("Source", "source findings", [ent("domain", "x.com", 200)]);
    const { entities, notes } = mergeCaseInto(target, source);
    expect(entities.map((e) => e.value)).toEqual(["8.8.8.8", "x.com"]);
    expect(notes).toBe('target findings\n\n— Merged from "Source" —\nsource findings');
  });

  it("omits the leading gap when the target has no notes of its own", () => {
    const target = mkCase("Target", "", []);
    const source = mkCase("Source", "src findings", []);
    expect(mergeCaseInto(target, source).notes).toBe('— Merged from "Source" —\nsrc findings');
  });

  it("leaves the target notes untouched when the source has only whitespace notes", () => {
    const target = mkCase("Target", "keep me", []);
    const source = mkCase("Source", "   ", []);
    expect(mergeCaseInto(target, source).notes).toBe("keep me");
  });

  it("tolerates undefined notes on both cases", () => {
    const target = mkCase("Target", undefined, []);
    const source = mkCase("Source", undefined, []);
    expect(mergeCaseInto(target, source).notes).toBe("");
  });
});
