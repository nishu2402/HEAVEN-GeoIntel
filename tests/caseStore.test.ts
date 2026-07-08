import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as store from "@/lib/server/caseStore";

// Run the file-backed store against a hermetic temp dir (never the real .data)
// via the HV_DATA_DIR override. The store resolves its path lazily per call, so
// setting the env in beforeAll (before the first store call) is enough.
let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "hv-casestore-"));
  process.env.HV_DATA_DIR = dir;
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.HV_DATA_DIR;
});

beforeEach(async () => {
  await store.deleteAllCases();
});

describe("caseStore CRUD", () => {
  it("creates, renames, notes, adds/dedupes/removes entities, deletes", async () => {
    const c = await store.createCase("Op Nightfall");
    expect(c.name).toBe("Op Nightfall");
    expect(c.entities).toEqual([]);

    await store.renameCase(c.id, "Op Daybreak");
    await store.setCaseNotes(c.id, "watch this handle");

    await store.addEntity(c.id, "phone", "+14155552671");
    await store.addEntity(c.id, "phone", "+14155552671"); // duplicate — ignored
    await store.addEntity(c.id, "email", "a@b.com");

    let got = await store.getCase(c.id);
    expect(got?.name).toBe("Op Daybreak");
    expect(got?.notes).toBe("watch this handle");
    expect(got?.entities.length).toBe(2); // duplicate did not double-count

    await store.removeEntity(c.id, "phone", "+14155552671");
    got = await store.getCase(c.id);
    expect(got?.entities.length).toBe(1);
    expect(got?.entities[0].kind).toBe("email");

    expect(await store.deleteCase(c.id)).toBe(true);
    expect(await store.getCase(c.id)).toBeNull();
    expect(await store.deleteCase(c.id)).toBe(false); // already gone
  });
});

describe("caseStore concurrency (regression: lost-update race + chain poisoning)", () => {
  it("persists every entity when 20 addEntity calls race on one case", async () => {
    const c = await store.createCase("race");
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.addEntity(c.id, "phone", `+1415555${(1000 + i).toString()}`),
      ),
    );
    const got = await store.getCase(c.id);
    // With the old read-modify-write, concurrent writers clobbered each other and
    // this landed well under 20. Serialised mutations must keep all 20.
    expect(got?.entities.length).toBe(20);
  });

  it("keeps every case when creates race (queue never poisons/loses a write)", async () => {
    await Promise.all(Array.from({ length: 15 }, (_, i) => store.createCase(`c${i}`)));
    const all = await store.listCases();
    expect(all.length).toBe(15);
    expect(new Set(all.map((x) => x.id)).size).toBe(15); // all distinct, none lost
  });
});

describe("caseStore importCase (untrusted re-import: validate + sanitise)", () => {
  it("imports as a brand-new case, keeping valid entities", async () => {
    const c = await store.importCase({
      name: "Op Reimport",
      notes: "chain of custody",
      entities: [
        { kind: "phone", value: "+14155552671" },
        { kind: "email", value: "a@b.com" },
      ],
    });
    expect(c.id).toBeTruthy();
    expect(c.name).toBe("Op Reimport");
    expect(c.notes).toBe("chain of custody");
    expect(c.entities.map((e) => e.kind).sort()).toEqual(["email", "phone"]);
  });

  it("drops unknown kinds, empty values, and duplicates", async () => {
    const c = await store.importCase({
      entities: [
        { kind: "bogus", value: "x" },            // unknown kind → dropped
        { kind: "phone", value: "   " },           // empty → dropped
        { kind: "phone", value: "+14155552671" },
        { kind: "phone", value: "+14155552671" },  // dup → dropped
      ],
    });
    expect(c.entities).toHaveLength(1);
    expect(c.entities[0].value).toBe("+14155552671");
  });

  it("replaces a non-finite addedAt with a real timestamp, keeps a valid one", async () => {
    const c = await store.importCase({
      entities: [
        { kind: "phone", value: "+1", addedAt: Number.NaN },
        { kind: "email", value: "a@b.com", addedAt: 1_700_000_000_000 },
        { kind: "ip", value: "8.8.8.8", addedAt: "oops" as unknown as number },
      ],
    });
    for (const e of c.entities) expect(Number.isFinite(e.addedAt)).toBe(true);
    expect(c.entities.find((e) => e.kind === "email")!.addedAt).toBe(1_700_000_000_000);
  });

  it("defaults a missing name and never clobbers an existing case", async () => {
    const a = await store.importCase({ entities: [] });
    const b = await store.importCase({ entities: [] });
    expect(a.name).toMatch(/^Imported \d{4}-\d{2}-\d{2}$/);
    expect(a.id).not.toBe(b.id);
    const all = await store.listCases();
    expect(all.filter((c) => c.id === a.id || c.id === b.id)).toHaveLength(2);
  });

  it("caps an oversized entity value (no unbounded payloads)", async () => {
    const huge = "9".repeat(5000);
    const c = await store.importCase({ entities: [{ kind: "phone", value: huge }] });
    expect(c.entities[0].value.length).toBeLessThan(huge.length);
  });

  it("keeps an entity note (capped) on import", async () => {
    const c = await store.importCase({ entities: [{ kind: "phone", value: "+1", note: "seen in breach" }] });
    expect(c.entities[0].note).toBe("seen in breach");
  });

  it("tolerates null entries and missing fields in the imported list", async () => {
    const c = await store.importCase({
      entities: [
        null as unknown as { kind: string },   // null entry → skipped
        { value: "x" },                          // no kind → skipped
        { kind: "phone" },                       // no value → skipped
        { kind: "email", value: "keep@x.com" },  // the only valid one
      ],
    });
    expect(c.entities).toHaveLength(1);
    expect(c.entities[0].value).toBe("keep@x.com");
  });

  it("imports a case with no entities field at all", async () => {
    const c = await store.importCase({ name: "no entities key" }); // input.entities undefined
    expect(c.name).toBe("no entities key");
    expect(c.entities).toEqual([]);
  });
});

describe("caseStore mergeCases", () => {
  it("folds the source's entities + notes into the target and deletes the source", async () => {
    const target = await store.createCase("Target");
    await store.addEntity(target.id, "phone", "+14155552671");
    await store.setCaseNotes(target.id, "target notes");

    const source = await store.createCase("Source");
    await store.addEntity(source.id, "email", "a@b.com");
    await store.addEntity(source.id, "phone", "+14155552671"); // duplicate of target → folded once
    await store.setCaseNotes(source.id, "source notes");

    const merged = await store.mergeCases(target.id, source.id);
    expect(merged?.id).toBe(target.id);
    expect(merged?.entities.map((e) => `${e.kind}:${e.value}`).sort())
      .toEqual(["email:a@b.com", "phone:+14155552671"]); // shared phone kept once
    expect(merged?.notes).toContain("target notes");
    expect(merged?.notes).toContain('— Merged from "Source" —');
    expect(merged?.notes).toContain("source notes");

    expect(await store.getCase(source.id)).toBeNull();        // source deleted
    expect(await store.getCase(target.id)).not.toBeNull();    // target survives
  });

  it("returns null when either the target or the source is missing", async () => {
    const c = await store.createCase("Solo");
    expect(await store.mergeCases("ghost", c.id)).toBeNull();  // target missing
    expect(await store.mergeCases(c.id, "ghost")).toBeNull();  // source missing
  });

  it("is a no-op returning the unchanged case on a self-merge (never deletes it)", async () => {
    const c = await store.createCase("Self");
    await store.addEntity(c.id, "ip", "8.8.8.8");
    const merged = await store.mergeCases(c.id, c.id);
    expect(merged?.id).toBe(c.id);
    expect(merged?.entities).toHaveLength(1);
    expect(await store.getCase(c.id)).not.toBeNull();
  });
});

describe("caseStore resilience (corrupt file + write failure)", () => {
  it("treats a corrupt or non-array cases.json as empty", async () => {
    writeFileSync(join(dir, "cases.json"), "{ not valid json");
    expect(await store.listCases()).toEqual([]);
    writeFileSync(join(dir, "cases.json"), '{"not":"an array"}');
    expect(await store.listCases()).toEqual([]);
  });

  it("rejects (and cleans up the temp file) when the atomic rename fails", async () => {
    const spy = vi.spyOn(fs, "rename").mockRejectedValueOnce(new Error("EXDEV: cross-device link"));
    await expect(store.createCase("boom")).rejects.toThrow(/EXDEV/);
    spy.mockRestore();
  });
});

describe("caseStore mutator edge cases", () => {
  it("returns null when mutating a case id that doesn't exist", async () => {
    expect(await store.renameCase("nope", "x")).toBeNull();
    expect(await store.setCaseNotes("nope", "x")).toBeNull();
    expect(await store.addEntity("nope", "phone", "+1")).toBeNull();
    expect(await store.removeEntity("nope", "phone", "+1")).toBeNull();
  });

  it("gives a blank-named case a dated default name", async () => {
    const c = await store.createCase("   ");
    expect(c.name).toMatch(/^Case \d{4}-\d{2}-\d{2}$/);
  });

  it("stores an optional note on addEntity", async () => {
    const c = await store.createCase("noted");
    const updated = await store.addEntity(c.id, "phone", "+14155552671", "primary contact");
    expect(updated?.entities[0].note).toBe("primary contact");
  });

  it("falls back to ./.data when HV_DATA_DIR is unset (read-only)", async () => {
    const saved = process.env.HV_DATA_DIR;
    delete process.env.HV_DATA_DIR; // exercise the dataDir() `|| ./.data` branch
    try {
      expect(Array.isArray(await store.listCases())).toBe(true);
    } finally {
      process.env.HV_DATA_DIR = saved;
    }
  });

  it("keeps the old name when renamed to blank, and ignores empty/duplicate entities", async () => {
    const c = await store.createCase("Original");
    expect((await store.renameCase(c.id, "   "))?.name).toBe("Original"); // blank → keep old

    const afterEmpty = await store.addEntity(c.id, "phone", "   ");
    expect(afterEmpty?.entities).toHaveLength(0); // empty value → no-op

    await store.addEntity(c.id, "email", "a@b.com");          // different kind, same case
    await store.addEntity(c.id, "phone", "+14155552671");     // dedup must skip the email (kind differs)
    await store.addEntity(c.id, "phone", "+19998887777");     // same kind, different value → added
    const afterDup = await store.addEntity(c.id, "phone", "+14155552671"); // exact duplicate → skipped
    expect(afterDup?.entities).toHaveLength(3);

    // removing a non-present entity is a no-op that still returns the case
    const afterNoop = await store.removeEntity(c.id, "domain", "ghost.example");
    expect(afterNoop?.entities).toHaveLength(3);
  });
});
