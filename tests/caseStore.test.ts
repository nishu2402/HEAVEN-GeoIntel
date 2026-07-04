import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
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
