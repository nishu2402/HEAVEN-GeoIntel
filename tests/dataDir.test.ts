import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import { dataDir, dataFile } from "@/lib/server/dataDir";

// One shared definition of where runtime state lives, used by the audit log,
// case store, key store and dataset overlays. It previously existed as four
// identical copies, so this is also the regression guard against them drifting.

const original = process.env.HV_DATA_DIR;
afterEach(() => {
  if (original === undefined) delete process.env.HV_DATA_DIR;
  else process.env.HV_DATA_DIR = original;
});

describe("dataDir", () => {
  it("defaults to ./.data relative to the working directory", () => {
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
