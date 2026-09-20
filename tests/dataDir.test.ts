import { describe, it, expect, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { dataDir, dataFile } from "@/lib/server/dataDir";
import { SUITE_DATA_DIR } from "./testUtils";

// One shared definition of where runtime state lives, used by the audit log,
// case store, key store and dataset overlays. It previously existed as four
// identical copies, so this is also the regression guard against them drifting.

const original = process.env.HV_DATA_DIR;
afterEach(() => {
  if (original === undefined) process.env.HV_DATA_DIR = SUITE_DATA_DIR;
  else process.env.HV_DATA_DIR = original;
});

describe("dataDir", () => {
  it("defaults to ./.data relative to the working directory", () => {
    // The one suite that must unset it: this is the behaviour under test. The
    // afterEach above puts the suite's throwaway directory straight back, and
    // nothing here writes a file. Everywhere else restores instead of deleting
    // (see SUITE_DATA_DIR), because a late audit write would land in ./.data.
    delete process.env.HV_DATA_DIR;
    expect(dataDir()).toBe(path.join(process.cwd(), ".data"));
  });

  it("honours HV_DATA_DIR so all state can be relocated", () => {
    process.env.HV_DATA_DIR = "/tmp/hv-relocated";
    expect(dataDir()).toBe("/tmp/hv-relocated");
  });

  it("reads the environment on every call, never capturing it at import", () => {
    process.env.HV_DATA_DIR = "/tmp/one";
    expect(dataDir()).toBe("/tmp/one");
    process.env.HV_DATA_DIR = "/tmp/two";
    expect(dataDir()).toBe("/tmp/two");
  });

  it("treats an empty value as unset", () => {
    process.env.HV_DATA_DIR = "";
    expect(dataDir()).toBe(path.join(process.cwd(), ".data"));
  });

  it("builds file paths inside the data directory", () => {
    process.env.HV_DATA_DIR = "/tmp/hv-files";
    expect(dataFile("cases.json")).toBe("/tmp/hv-files/cases.json");
    expect(dataFile("datasets")).toBe("/tmp/hv-files/datasets");
  });
});

// ── The suite must not write into the real ./.data ───────────────────────────
// vitest.config.ts points HV_DATA_DIR at a throwaway directory precisely so a
// test run cannot touch the developer's cases, keys or audit log. Thirty-six
// route suites then set their own temp dir and DELETED the variable in
// teardown, which does not restore that default — it unsets it. Route handlers
// fire their audit write and never await it, so a write that landed after
// teardown resolved ./.data and appended to the real audit log: a measured 40
// junk entries in one run. Teardown restores SUITE_DATA_DIR instead.

describe("no suite may unset HV_DATA_DIR", () => {
  it("every teardown restores the throwaway directory rather than deleting it", () => {
    const dir = path.join(__dirname);
    const offenders = readdirSync(dir)
      .filter((f) => /\.test\.tsx?$/.test(f))
      // This file is the exception: unsetting it IS the behaviour under test,
      // it is restored immediately, and nothing here writes a file.
      .filter((f) => f !== "dataDir.test.ts")
      .filter((f) => readFileSync(path.join(dir, f), "utf8").includes("delete process.env.HV_DATA_DIR"));
    expect(offenders).toEqual([]);
  });
});
