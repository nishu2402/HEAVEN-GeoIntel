import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearOverlays,
  overlayList,
  overlayLookup,
  overlayMeta,
  overlayRemovals,
  setListOverlay,
  setRecordOverlay,
} from "@/lib/data/overlay";
import { datasetStatus, ensureDatasets, reloadDatasets } from "@/lib/server/datasets";
import { getNpaInfo } from "@/lib/data/usNpaDatabase";
import { getCountryIntel } from "@/lib/data/countryIntel";
import { lookupMccMnc } from "@/lib/data/mccMnc";
import { isDisposableDomain } from "@/lib/data/disposableEmailDomains";
import { activeUsernameSites, USERNAME_SITES } from "@/lib/data/usernameSites";
import { analyzeEmail } from "@/lib/analysis/emailAnalysis";

// Overlays let an operator correct or extend a bundled dataset at runtime,
// which is the difference between "an area code changed" being a rebuild and
// being a file drop. The rules that matter: an overlay wins over bundled data,
// a removal is honoured, and a malformed overlay is IGNORED rather than
// breaking the tool or — worse — producing a bogus username "found".

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hv-datasets-"));
  process.env.HV_DATA_DIR = dir;
  clearOverlays();
});
afterEach(async () => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.HV_DATA_DIR;
  clearOverlays();
  await reloadDatasets(); // leave the module with no overlay for other suites
});

function writeOverlay(name: string, body: unknown): void {
  const d = join(dir, "datasets");
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, `${name}.json`), typeof body === "string" ? body : JSON.stringify(body));
}

describe("overlay registry (pure)", () => {
  it("returns undefined for a dataset with no overlay", () => {
    expect(overlayLookup("usNpa", "415")).toBeUndefined();
    expect(overlayList("usernameSites")).toEqual([]);
    expect(overlayRemovals("usernameSites")).toEqual([]);
    expect(overlayMeta("usNpa")).toBeNull();
  });

  it("records entry counts and version in the metadata", () => {
    setRecordOverlay("usNpa", { "999": { state: "Testland" } }, { version: "v1", path: "/x" });
    expect(overlayMeta("usNpa")).toEqual({ version: "v1", path: "/x", entries: 1 });

    setListOverlay("disposableDomains", ["a.test", "b.test"], { version: "v2" });
    expect(overlayMeta("disposableDomains")).toEqual({ version: "v2", entries: 2 });
  });

  it("distinguishes a removal (null) from no opinion (undefined)", () => {
    setRecordOverlay("usNpa", {}, {}, ["415"]);
    expect(overlayLookup("usNpa", "415")).toBeNull();
    expect(overlayLookup("usNpa", "212")).toBeUndefined();
  });

  it("clearOverlays drops everything", () => {
    setRecordOverlay("usNpa", { "999": {} }, {});
    clearOverlays();
    expect(overlayMeta("usNpa")).toBeNull();
  });
});

describe("dataset lookups consult the overlay first", () => {
  it("overrides an NPA entry without a rebuild", async () => {
    const bundled = getNpaInfo("4155551234");
    expect(bundled?.state).toBe("California");

    writeOverlay("usNpa", { version: "2026-07-01", entries: { "415": { country: "US", state: "Relocated", stateAbbr: "ZZ", region: "Test", timezone: "UTC" } } });
    await reloadDatasets();
    expect(getNpaInfo("4155551234")?.state).toBe("Relocated");
  });

  it("removes an NPA entry when the overlay says to", async () => {
    writeOverlay("usNpa", { remove: ["415"], entries: {} });
    await reloadDatasets();
    expect(getNpaInfo("4155551234")).toBeNull();
  });

  it("overrides country intel", async () => {
    writeOverlay("countryIntel", { entries: { US: { code: "US", name: "Overridden" } } });
    await reloadDatasets();
    expect(getCountryIntel("us")?.name).toBe("Overridden");
  });

  it("falls back to bundled country intel for keys the overlay doesn't mention", async () => {
    writeOverlay("countryIntel", { entries: { ZZ: { code: "ZZ", name: "Nowhere" } } });
    await reloadDatasets();
    expect(getCountryIntel("ZZ")?.name).toBe("Nowhere");
    expect(getCountryIntel("US")?.name).toBe("United States");
    expect(getCountryIntel("QQ")).toBeNull();
  });

  it("overrides and removes MCC/MNC operators", async () => {
    writeOverlay("mccMnc", { entries: { "310-260": { operator: "New Operator", country: "US" } } });
    await reloadDatasets();
    expect(lookupMccMnc("310", "260")?.operator).toBe("New Operator");

    writeOverlay("mccMnc", { entries: {}, remove: ["310-260"] });
    await reloadDatasets();
    expect(lookupMccMnc("310", "260")).toBeNull();
  });

  it("adds and removes disposable domains, and feeds through email analysis", async () => {
    expect(isDisposableDomain("brand-new-burner.test")).toBe(false);
    writeOverlay("disposableDomains", { entries: ["brand-new-burner.test"], remove: ["10minutemail.com"] });
    await reloadDatasets();

    expect(isDisposableDomain("brand-new-burner.test")).toBe(true);
    expect(isDisposableDomain("BRAND-NEW-BURNER.TEST")).toBe(true); // case-insensitive
    expect(isDisposableDomain("10minutemail.com")).toBe(false); // false positive retired
    expect(analyzeEmail("x@brand-new-burner.test").isDisposable).toBe(true);
  });

  it("appends a username site, and replaces a bundled one of the same name", async () => {
    const before = activeUsernameSites().length;
    expect(before).toBe(USERNAME_SITES.length);

    writeOverlay("usernameSites", {
      entries: [
        { name: "NewSite", category: "social", url: "https://new.test/{u}", check: "status" },
        { name: "Replit", category: "developer", url: "https://replit.com/@{u}", check: "status" },
      ],
    });
    await reloadDatasets();

    const sites = activeUsernameSites();
    expect(sites.length).toBe(before + 1); // one new, one replacement
    expect(sites.find((s) => s.name === "NewSite")).toBeTruthy();
    expect(sites.find((s) => s.name === "Replit")?.check).toBe("status"); // was "manual"
  });

  it("removes a bundled username site", async () => {
    writeOverlay("usernameSites", { entries: [], remove: ["Replit"] });
    await reloadDatasets();
    expect(activeUsernameSites().find((s) => s.name === "Replit")).toBeUndefined();
  });
});

describe("a bad overlay degrades to bundled data instead of breaking the tool", () => {
  it("ignores invalid JSON and reports it", async () => {
    writeOverlay("usNpa", "{ not json");
    const warnings = await reloadDatasets();
    expect(warnings).toEqual(["usNpa: not valid JSON"]);
    expect(getNpaInfo("4155551234")?.state).toBe("California");
  });

  it("ignores a JSON file that isn't an object", async () => {
    writeOverlay("usNpa", null);
    expect(await reloadDatasets()).toEqual(["usNpa: expected a JSON object"]);
  });

  it("rejects a list payload for a keyed dataset and vice versa", async () => {
    writeOverlay("usNpa", { entries: ["nope"] });
    expect(await reloadDatasets()).toEqual(['usNpa: "entries" must be an object']);

    rmSync(join(dir, "datasets", "usNpa.json"));
    writeOverlay("disposableDomains", { entries: { nope: true } });
    expect(await reloadDatasets()).toEqual(['disposableDomains: "entries" must be an array']);
  });

  it("skips malformed username-site entries rather than trusting the file", async () => {
    // Each of these would otherwise risk a fabricated "found" claim.
    writeOverlay("usernameSites", {
      entries: [
        null,
        "a string",
        { name: "", url: "https://x.test/{u}", category: "social", check: "status" },   // blank name
        { name: "NoPlaceholder", url: "https://x.test/", category: "social", check: "status" },
        { name: "BadCheck", url: "https://x.test/{u}", category: "social", check: "guess" },
        { name: "NoCategory", url: "https://x.test/{u}", check: "status" },
        { name: "BodyNoMarker", url: "https://x.test/{u}", category: "social", check: "body" },
        { name: "Good", url: "https://good.test/{u}", category: "social", check: "status" },
        { name: "GoodBody", url: "https://gb.test/{u}", category: "social", check: "body", absence: "not found" },
      ],
    });
    await reloadDatasets();

    const added = activeUsernameSites().filter((s) => ["Good", "GoodBody"].includes(s.name));
    expect(added.length).toBe(2);
    for (const bad of ["NoPlaceholder", "BadCheck", "NoCategory", "BodyNoMarker"]) {
      expect(activeUsernameSites().find((s) => s.name === bad), bad).toBeUndefined();
    }
  });

  it("ignores non-string entries in a string list", async () => {
    writeOverlay("disposableDomains", { entries: ["ok.test", 42, null] });
    await reloadDatasets();
    expect(isDisposableDomain("ok.test")).toBe(true);
  });

  it("treats a non-string version and non-array remove as absent", async () => {
    writeOverlay("usNpa", { version: 7, remove: "415", entries: { "999": { state: "X" } } });
    await reloadDatasets();
    expect(overlayMeta("usNpa")?.version).toBeUndefined();
    expect(getNpaInfo("4155551234")?.state).toBe("California"); // remove ignored
  });
});

describe("ensureDatasets / datasetStatus", () => {
  it("loads once per process and reuses the result", async () => {
    const first = await ensureDatasets();
    const second = await ensureDatasets();
    expect(second).toBe(first); // same array identity → same promise, no re-read
  });

  it("reports every dataset, with an overlay only where one exists", async () => {
    writeOverlay("disposableDomains", { version: "2026-07", entries: ["z.test"] });
    await reloadDatasets();

    const status = await datasetStatus();
    expect(status.dir).toBe(join(dir, "datasets"));
    expect(status.warnings).toEqual([]);
    expect(status.datasets.map((d) => d.name)).toEqual([
      "countryIntel", "usNpa", "mccMnc", "disposableDomains", "usernameSites",
    ]);
    expect(status.datasets.find((d) => d.name === "disposableDomains")?.overlay)
      .toEqual({ version: "2026-07", path: join(dir, "datasets", "disposableDomains.json"), entries: 1 });
    expect(status.datasets.find((d) => d.name === "usNpa")?.overlay).toBeNull();
  });

  it("reports no overlays at all when the directory is absent", async () => {
    const status = await datasetStatus();
    expect(status.datasets.every((d) => d.overlay === null)).toBe(true);
    expect(status.warnings).toEqual([]);
  });
});
