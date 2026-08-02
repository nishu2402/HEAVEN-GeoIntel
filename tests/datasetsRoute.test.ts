import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET, POST } from "@/app/api/datasets/route";
import { reloadDatasets } from "@/lib/server/datasets";
import { clearOverlays } from "@/lib/data/overlay";
import { USERNAME_SITES } from "@/lib/data/usernameSites";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hv-datasetsroute-"));
  process.env.HV_DATA_DIR = dir;
});
afterEach(async () => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.HV_DATA_DIR;
  clearOverlays();
  await reloadDatasets();
});

function writeOverlay(name: string, body: unknown): void {
  const d = join(dir, "datasets");
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, `${name}.json`), JSON.stringify(body));
}

describe("GET /api/datasets", () => {
  it("lists every dataset with no overlay on a stock install", async () => {
    await reloadDatasets();
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    const json = await res.json();
    expect(json.datasets).toHaveLength(5);
    expect(json.datasets.every((d: { overlay: unknown }) => d.overlay === null)).toBe(true);
    expect(json.usernameSites).toEqual({
      bundled: USERNAME_SITES.length,
      active: USERNAME_SITES.length,
    });
  });

  it("reports an installed overlay's version and row count", async () => {
    writeOverlay("disposableDomains", { version: "2026-07-15", entries: ["a.test", "b.test"] });
    await reloadDatasets();

    const json = await (await GET()).json();
    const entry = json.datasets.find((d: { name: string }) => d.name === "disposableDomains");
    expect(entry.overlay).toMatchObject({ version: "2026-07-15", entries: 2 });
  });

  it("surfaces a bad overlay as a warning instead of failing", async () => {
    writeOverlay("usNpa", ["not an object"]);
    await reloadDatasets();
    const json = await (await GET()).json();
    expect(json.warnings).toEqual(['usNpa: "entries" must be an object']);
  });

  it("never returns dataset contents, only counts", async () => {
    writeOverlay("disposableDomains", { entries: ["secret-internal.test"] });
    await reloadDatasets();
    expect(JSON.stringify(await (await GET()).json())).not.toContain("secret-internal.test");
  });
});

describe("POST /api/datasets (reload)", () => {
  it("picks up a newly written overlay without a restart", async () => {
    await reloadDatasets();
    expect((await (await GET()).json()).usernameSites.active).toBe(USERNAME_SITES.length);

    writeOverlay("usernameSites", {
      entries: [{ name: "AddedLive", category: "social", url: "https://live.test/{u}", check: "status" }],
    });

    const json = await (await POST()).json();
    expect(json.usernameSites.active).toBe(USERNAME_SITES.length + 1);
    expect(json.datasets.find((d: { name: string }) => d.name === "usernameSites").overlay.entries).toBe(1);
  });

  it("drops an overlay once its file is removed", async () => {
    writeOverlay("disposableDomains", { entries: ["x.test"] });
    await POST();
    rmSync(join(dir, "datasets", "disposableDomains.json"));

    const json = await (await POST()).json();
    expect(json.datasets.find((d: { name: string }) => d.name === "disposableDomains").overlay).toBeNull();
  });
});
