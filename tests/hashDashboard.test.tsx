// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { installMemoryLocalStorage } from "./testUtils";
import HashResultsDashboard from "@/components/hash/HashResultsDashboard";
import type { HashLookupResponse } from "@/lib/types";

beforeAll(() => { installMemoryLocalStorage(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => localStorage.clear());

const pivots = [{ label: "VirusTotal", url: "https://www.virustotal.com/gui/file/x", note: "verdict" }];

describe("<HashResultsDashboard>", () => {
  it("renders a known-good match with file details, trust and the source name", () => {
    const data: HashLookupResponse = {
      input: "8ed4b4ed952526d89899e723f3488de4", kind: "md5",
      facts: {
        kind: "md5", input: "8ed4b4ed952526d89899e723f3488de4", known: true,
        fileName: "kernel32.dll", fileSize: 2520, productName: "Windows Server 2016",
        source: "NSRL", database: "nsrl_modern_rds", trust: 50,
        md5: "8ed4b4ed952526d89899e723f3488de4", sha1: "0000abcd", sha256: null, // sha256 null → Row hidden
      },
      pivots,
      sourceHealth: [{ source: "circl-hashlookup", ok: true, ms: 88, fetchedAt: 0 }],
    };
    render(<HashResultsDashboard data={data} />);
    expect(screen.getByText("Known software")).toBeTruthy();
    expect(screen.getByText(/Catalogued as legitimate.*\(NSRL\)/)).toBeTruthy();
    expect(screen.getByText("trust 50/100")).toBeTruthy();
    expect(screen.getByText("kernel32.dll")).toBeTruthy();
    expect(screen.getByText("2,520 bytes")).toBeTruthy();
    expect(screen.getByText(/circl-hashlookup · 88ms/)).toBeTruthy();
    expect(screen.queryByText("SHA-256")).toBeNull(); // null value → row not rendered
  });

  it("hides the file-size row when a known record has no size", () => {
    const data: HashLookupResponse = {
      input: "8ed4b4ed952526d89899e723f3488de4", kind: "md5",
      facts: {
        kind: "md5", input: "8ed4b4ed952526d89899e723f3488de4", known: true,
        fileName: "thing.dll", fileSize: null, productName: null,
        source: "NSRL", database: null, trust: null,
        md5: "8ed4b4ed952526d89899e723f3488de4", sha1: null, sha256: null,
      },
      pivots,
      sourceHealth: [{ source: "circl-hashlookup", ok: true, ms: 12, fetchedAt: 0 }],
    };
    render(<HashResultsDashboard data={data} />);
    expect(screen.getByText("thing.dll")).toBeTruthy();
    expect(screen.queryByText("File size")).toBeNull(); // fileSize null → row hidden
  });

  it("renders a miss as unknown, with no file grid and a failed source flag", () => {
    const data: HashLookupResponse = {
      input: "0".repeat(64), kind: "sha256",
      facts: {
        kind: "sha256", input: "0".repeat(64), known: false,
        fileName: null, fileSize: null, productName: null, source: null, database: null, trust: null,
        md5: null, sha1: null, sha256: null,
      },
      pivots,
      sourceHealth: [{ source: "circl-hashlookup", ok: false, ms: 5, fetchedAt: 0, error: "timeout" }],
    };
    render(<HashResultsDashboard data={data} />);
    expect(screen.getByText("Not in known-software databases")).toBeTruthy();
    expect(screen.queryByText("File name")).toBeNull(); // no known-file grid on a miss
    expect(screen.getByText(/circl-hashlookup · 5ms · timeout/)).toBeTruthy();
  });

  it("shows an honest error when the source was unreachable", () => {
    render(<HashResultsDashboard data={{
      input: "8ed4b4ed952526d89899e723f3488de4", kind: "md5", facts: null,
      error: "CIRCL hashlookup was unreachable.", pivots,
      sourceHealth: [{ source: "circl-hashlookup", ok: false, ms: 5, fetchedAt: 0, error: "unreachable" }],
    }} />);
    expect(screen.getByText(/CIRCL hashlookup was unreachable/)).toBeTruthy();
  });

  it("falls back to a generic message and hides the badge and sources when nothing is present", () => {
    render(<HashResultsDashboard data={{ input: "x", kind: null, facts: null, pivots: [] }} />);
    expect(screen.getByText("No reputation data.")).toBeTruthy();
    expect(screen.queryByText("Sources:")).toBeNull(); // no sourceHealth → block hidden
  });
});
