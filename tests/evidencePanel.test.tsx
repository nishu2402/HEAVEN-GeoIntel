// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react";
import EvidencePanel from "@/components/cases/EvidencePanel";
import type { EvidenceCheck, EvidenceEntry } from "@/lib/server/evidenceStore";

// The locker's whole claim is "this is the response the report was written
// from". So the panel has to show the recorded hash, let the analyst recompute
// it on demand, and be unambiguous when a recomputation disagrees — a quiet
// failure here would leave a tampered artifact looking preserved.

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const entry = (over: Partial<EvidenceEntry> = {}): EvidenceEntry => ({
  id: "a1b2c3",
  mode: "domain",
  identifier: "example.com",
  sha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  bytes: 20480,
  capturedAt: Date.UTC(2026, 8, 14, 9, 0),
  sources: [],
  ...over,
});

const check = (over: Partial<EvidenceCheck> = {}): EvidenceCheck => ({
  id: "a1b2c3", state: "ok", expected: "9f86", actual: "9f86", ...over,
});

/** Render with both ports injected, so nothing reaches the network. */
const mount = (entries: EvidenceEntry[], checks: EvidenceCheck[] = []) =>
  act(async () => {
    render(<EvidencePanel caseId="case-1" load={async () => entries} check={async () => checks} />);
  });

describe("<EvidencePanel> with nothing preserved", () => {
  it("explains how to put something in the locker", async () => {
    await mount([]);
    expect(screen.getByText(/No preserved responses yet/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Verify hashes/i })).toBeNull();
  });
});

describe("<EvidencePanel> listing artifacts", () => {
  it("shows what was captured, when, how big, and under which hash", async () => {
    await mount([entry()]);
    expect(screen.getByText(/EVIDENCE: 1 preserved/)).toBeTruthy();
    expect(screen.getByText("domain")).toBeTruthy();
    expect(screen.getByText("example.com")).toBeTruthy();
    expect(screen.getByText("20.0 KB")).toBeTruthy();
    expect(screen.getByText(/sha256 9f86d081/)).toBeTruthy();
  });

  it("links each artifact to its own bytes, scoped to the case", async () => {
    await mount([entry()]);
    const link = screen.getByRole("link", { name: /open/i });
    expect(link.getAttribute("href")).toBe("/api/evidence?caseId=case-1&id=a1b2c3");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("names the sources behind an artifact, and which of them said nothing", async () => {
    await mount([entry({
      sources: [
        { source: "rdap", ok: true, ms: 120, fetchedAt: 1 },
        { source: "crtsh", ok: false, ms: 900, fetchedAt: 1 },
      ],
    })]);
    // A source that failed is still provenance; dropping it would overstate what
    // the artifact rests on.
    expect(screen.getByText("sources: rdap, crtsh (no answer)")).toBeTruthy();
  });

  it("omits the sources line when the response carried none", async () => {
    await mount([entry({ sources: [] })]);
    expect(screen.queryByText(/^sources:/)).toBeNull();
  });

  it("carries the analyst's note when there is one", async () => {
    await mount([entry({ note: "pre-takedown snapshot" })]);
    expect(screen.getByText("note: pre-takedown snapshot")).toBeTruthy();
  });

  it("shows no note line when none was written", async () => {
    await mount([entry()]);
    expect(screen.queryByText(/^note:/)).toBeNull();
  });
});

describe("<EvidencePanel> verifying", () => {
  it("says every artifact still hashes to its recorded value", async () => {
    await mount([entry()], [check()]);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Verify hashes/i })); });
    expect(screen.getByText("all 1 artifacts hash to their recorded value")).toBeTruthy();
    expect(screen.getByText("ok")).toBeTruthy();
  });

  it("counts the artifacts that no longer match, and marks the row", async () => {
    await mount(
      [entry(), entry({ id: "d4e5f6", identifier: "other.test" })],
      [check(), check({ id: "d4e5f6", state: "modified", actual: "0000" })],
    );
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Verify hashes/i })); });
    expect(screen.getByText("1 of 2 artifacts no longer match their recorded hash")).toBeTruthy();
    expect(screen.getByText("modified")).toBeTruthy();
  });

  it("leaves a row unmarked when the verification did not cover it", async () => {
    // A check list that omits an entry says nothing about it, which is not the
    // same as saying it is fine.
    await mount([entry(), entry({ id: "zz", identifier: "unchecked.test" })], [check()]);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Verify hashes/i })); });
    expect(screen.getAllByText("ok")).toHaveLength(1);
  });

  it("says nothing about hashes until asked", async () => {
    await mount([entry()], [check()]);
    expect(screen.queryByText(/hash to their recorded value/)).toBeNull();
  });

  it("disables the button while a verification is in flight", async () => {
    let release: (v: EvidenceCheck[]) => void = () => {};
    const pending = new Promise<EvidenceCheck[]>((r) => { release = r; });
    await act(async () => {
      render(<EvidencePanel caseId="c" load={async () => [entry()]} check={() => pending} />);
    });
    const button = screen.getByRole("button", { name: /Verify hashes/i }) as HTMLButtonElement;
    await act(async () => { fireEvent.click(button); });
    expect(button.disabled).toBe(true);
    await act(async () => { release([check()]); await pending; });
    expect(button.disabled).toBe(false);
  });
});

describe("<EvidencePanel> talking to the endpoint", () => {
  const jsonRes = (body: unknown, ok = true) =>
    ({ ok, status: ok ? 200 : 500, json: async () => body }) as Response;

  it("reads the manifest and verifies through /api/evidence", async () => {
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) =>
      init?.method === "POST"
        ? jsonRes({ checks: [check()] })
        : jsonRes({ entries: [entry()] }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => { render(<EvidencePanel caseId="case 1/x" />); });
    await waitFor(() => expect(screen.getByText(/EVIDENCE: 1 preserved/)).toBeTruthy());
    // The case id reaches the query string encoded, not raw.
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/evidence?caseId=case%201%2Fx");

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Verify hashes/i })); });
    expect(screen.getByText("all 1 artifacts hash to their recorded value")).toBeTruthy();
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]!.body))).toEqual({ action: "verify", caseId: "case 1/x" });
  });

  it("treats a refused manifest as an empty locker rather than a crash", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonRes({ error: "nope" }, false)));
    await act(async () => { render(<EvidencePanel caseId="c" />); });
    expect(screen.getByText(/No preserved responses yet/)).toBeTruthy();
  });

  it("tolerates a manifest and a verification that carry no list at all", async () => {
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) =>
      init?.method === "POST" ? jsonRes({}) : jsonRes({}));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => { render(<EvidencePanel caseId="c" />); });
    expect(screen.getByText(/No preserved responses yet/)).toBeTruthy();
  });

  it("reports a refused verification as no checks, not as success", async () => {
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) =>
      init?.method === "POST" ? jsonRes({ error: "nope" }, false) : jsonRes({ entries: [entry()] }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => { render(<EvidencePanel caseId="c" />); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Verify hashes/i })); });
    // Zero checks is vacuously "all ok"; what matters is that no row is marked.
    expect(screen.getByText("all 0 artifacts hash to their recorded value")).toBeTruthy();
    expect(screen.queryByText("ok")).toBeNull();
  });

  it("tolerates a verification response with no checks key", async () => {
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) =>
      init?.method === "POST" ? jsonRes({}) : jsonRes({ entries: [entry()] }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => { render(<EvidencePanel caseId="c" />); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Verify hashes/i })); });
    expect(screen.getByText("all 0 artifacts hash to their recorded value")).toBeTruthy();
  });
});
