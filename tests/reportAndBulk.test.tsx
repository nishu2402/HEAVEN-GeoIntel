// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import BulkLookup from "@/components/dashboard/BulkLookup";

// BulkLookup talks to /api/bulk-lookup and downloads a formula-safe CSV. The
// download harness below captures each Blob's text and the anchor's filename,
// since jsdom cannot actually navigate a download.

// ── download capture (jsdom can't navigate) ──────────────────────────────────
const downloads: { name: string; type: string; body: string }[] = [];
let lastBlobText = "";
const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;

beforeEach(() => {
  downloads.length = 0;
  URL.createObjectURL = vi.fn((blob: Blob) => {
    (blob as Blob & { _capture?: boolean })._capture = true;
    return "blob:mock";
  });
  URL.revokeObjectURL = vi.fn();
  // Grab the text passed to each new Blob by wrapping the constructor.
  const RealBlob = globalThis.Blob;
  vi.stubGlobal("Blob", class extends RealBlob {
    constructor(parts: BlobPart[], opts?: BlobPropertyBag) {
      super(parts, opts);
      lastBlobText = parts.map(String).join("");
    }
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ name: this.download, type: this.href, body: lastBlobText });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  URL.createObjectURL = realCreate;
  URL.revokeObjectURL = realRevoke;
});

// ── BulkLookup ───────────────────────────────────────────────────────────────
//
// Bulk is a queued JOB now: POST starts it and returns an id, GET reports
// progress until the job stops. The component polls, so the fetch stub answers
// both shapes.

interface FakeRow {
  mode: string; input: string; ok: boolean; status: number; error?: string;
  summary: Record<string, string | number | boolean | null>;
  sources: { source: string; ok: boolean }[]; ms: number;
}

const fakeRow = (over: Partial<FakeRow> = {}): FakeRow => ({
  mode: "domain", input: "wordpress.org", ok: true, status: 200,
  summary: { domain: "wordpress.org", registrar: "MarkMonitor Inc." },
  sources: [{ source: "dns", ok: true }], ms: 12,
  ...over,
});

/** A fetch that starts a job and then reports it finished with `rows`. */
function stubJob(rows: FakeRow[], startOver: Record<string, unknown> = {}) {
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
    const s = String(url);
    if (init?.method === "POST") {
      return { ok: true, status: 200, json: async () => ({ id: "job-1", total: rows.length, state: "running", skipped: [], ...startOver }) } as Response;
    }
    if (s.includes("format=csv")) {
      return { ok: true, status: 200, text: async () => "mode,input\ndomain,wordpress.org" } as unknown as Response;
    }
    return {
      ok: true, status: 200,
      json: async () => ({ id: "job-1", state: "done", total: rows.length, done: rows.length, rows, startedAt: 1, finishedAt: 2 }),
    } as Response;
  }));
}

describe("<BulkLookup>", () => {
  const type = (text: string) => fireEvent.change(screen.getByLabelText(/bulk identifier input/i), { target: { value: text } });
  const runBtn = () => screen.getByRole("button", { name: /run bulk lookup/i });

  it("disables RUN until something is pasted", () => {
    render(<BulkLookup />);
    expect(runBtn()).toHaveProperty("disabled", true);
    type("wordpress.org");
    expect(runBtn()).toHaveProperty("disabled", false);
  });

  it("runs a job, renders the rows as they land, and downloads a formula-safe CSV", async () => {
    stubJob([
      fakeRow(),
      fakeRow({ mode: "phone", input: "+14155552671", summary: { e164: "+14155552671", carrier: "carrier, inc" } }),
      fakeRow({ mode: "ip", input: "nope", ok: false, status: 400, error: "Not a valid IPv4 / IPv6 address", summary: {} }),
    ]);
    render(<BulkLookup />);
    type("wordpress.org\n+14155552671\nnope");
    await act(async () => { fireEvent.click(runBtn()); });

    expect(screen.getByText(/DONE: 3\/3/)).toBeTruthy();
    expect(screen.getByText(/2 answered · 1 failed/)).toBeTruthy();
    expect(screen.getByText(/registrar=MarkMonitor Inc./)).toBeTruthy();
    expect(screen.getByText("Not a valid IPv4 / IPv6 address")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /download bulk results as csv/i }));
    const csv = downloads[0]!.body;
    expect(csv.split("\n")[0]).toMatch(/^mode,input,ok,status,error/);
    expect(csv).toContain("'+14155552671");   // leading + escaped against formula injection
    expect(csv).toContain('"carrier, inc"');  // comma-bearing cell gets quoted
  });

  it("lists rows the server could not classify", async () => {
    stubJob([fakeRow()], { skipped: [{ input: "???", reason: 'no bulk lookup for mode "file"' }] });
    render(<BulkLookup />);
    type("wordpress.org\n???");
    await act(async () => { fireEvent.click(runBtn()); });
    expect(screen.getByText(/SKIPPED: 1/)).toBeTruthy();
    expect(screen.getByText(/no bulk lookup for mode "file"/)).toBeTruthy();
  });

  it("shows a server-provided error message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 429, json: async () => ({ error: "Rate limited" }) }) as Response));
    render(<BulkLookup />);
    type("wordpress.org");
    await act(async () => { fireEvent.click(runBtn()); });
    expect(screen.getByText("Rate limited")).toBeTruthy();
  });

  it("falls back to its own message when the error body omits one", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response));
    render(<BulkLookup />);
    type("wordpress.org");
    await act(async () => { fireEvent.click(runBtn()); });
    expect(screen.getByText(/could not be started/)).toBeTruthy();
  });

  it("reports a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    render(<BulkLookup />);
    type("wordpress.org");
    await act(async () => { fireEvent.click(runBtn()); });
    expect(screen.getByText(/could not be started/)).toBeTruthy();
  });

  it("reports a job whose progress cannot be read", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) =>
      (init?.method === "POST"
        ? { ok: true, status: 200, json: async () => ({ id: "job-2", total: 1, state: "running", skipped: [] }) }
        : { ok: false, status: 500, json: async () => ({}) }) as Response));
    render(<BulkLookup />);
    type("wordpress.org");
    await act(async () => { fireEvent.click(runBtn()); });
    expect(screen.getByText(/could not be read/)).toBeTruthy();
  });

  it("refuses to start with an empty box", () => {
    render(<BulkLookup />);
    type("   ");
    expect(runBtn()).toHaveProperty("disabled", true);
  });
});
