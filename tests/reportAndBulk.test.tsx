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
interface BulkRow {
  input: string; ok: boolean; error?: string; e164?: string; country?: string | null;
  type?: string | null; carrier?: string | null; utcOffset?: string | null;
  npaState?: string | null; npaRegion?: string | null; cached?: boolean;
}
const row = (over: Partial<BulkRow> = {}): BulkRow => ({
  input: "+14155552671", ok: true, e164: "+14155552671", country: "US",
  type: "mobile", carrier: "Verizon", utcOffset: "UTC-08:00", npaState: "CA", npaRegion: "Bay Area",
  ...over,
});

describe("<BulkLookup>", () => {
  const type = (text: string) => fireEvent.change(screen.getByLabelText(/bulk phone-number input/i), { target: { value: text } });
  const runBtn = () => screen.getByRole("button", { name: /run bulk/i });

  it("disables RUN until at least one number is present", () => {
    render(<BulkLookup />);
    expect(runBtn()).toHaveProperty("disabled", true);
    type("+14155552671");
    expect(runBtn()).toHaveProperty("disabled", false);
    expect(screen.getByText(/run bulk \(1\)/i)).toBeTruthy();
  });

  it("blocks and warns past the 25-number cap", () => {
    render(<BulkLookup />);
    type(Array.from({ length: 26 }, (_, i) => `+1415555${String(i).padStart(4, "0")}`).join("\n"));
    expect(screen.getByText(/26 pasted: max is 25/i)).toBeTruthy();
    expect(runBtn()).toHaveProperty("disabled", true);
  });

  it("runs a batch, renders the results table, and downloads a formula-safe CSV", async () => {
    const rows = [
      // an all-null row exercises every `?? "—"` cell fallback and the region-less branch
      row({ input: "carrier, inc", type: null, carrier: null, utcOffset: null, npaRegion: null, npaState: null }),
      row({ input: "+14155552672" }), // full NPA → "Bay Area, CA" (region + state)
      row({ input: "bad", ok: false, error: "invalid", e164: undefined, country: null, npaRegion: "Metro only", npaState: null, cached: true }),
    ];
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ count: 3, rows }) }) as Response));
    render(<BulkLookup />);
    type("+14155552671\n+14155552672\nbad");
    await act(async () => { fireEvent.click(runBtn()); });

    expect(screen.getByText(/✓ 2 OK/)).toBeTruthy();
    expect(screen.getByText(/✗ 1 failed/)).toBeTruthy();
    expect(screen.getByText("Bay Area, CA")).toBeTruthy(); // region + state
    expect(screen.getByText("Metro only")).toBeTruthy();   // npaRegion without npaState
    expect(screen.getByText("[c]")).toBeTruthy();           // cached marker
    expect(screen.getByText("invalid")).toBeTruthy();       // per-row error

    fireEvent.click(screen.getByRole("button", { name: /download csv/i }));
    const csv = downloads[0]!.body;
    expect(csv.split("\n")[0]).toMatch(/^input,ok,error,e164/);
    expect(csv).toContain("'+14155552671");    // leading + escaped against formula injection
    expect(csv).toContain('"carrier, inc"');    // comma-bearing cell gets quoted
  });

  it("shows a server-provided error message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 429, json: async () => ({ error: "Rate limited" }) }) as Response));
    render(<BulkLookup />);
    type("+14155552671");
    await act(async () => { fireEvent.click(runBtn()); });
    expect(screen.getByText("Rate limited")).toBeTruthy();
  });

  it("falls back to the HTTP status when the error body omits a message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response));
    render(<BulkLookup />);
    type("+14155552671");
    await act(async () => { fireEvent.click(runBtn()); });
    expect(screen.getByText(/HTTP 500/)).toBeTruthy();
  });

  it("reports a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    render(<BulkLookup />);
    type("+14155552671");
    await act(async () => { fireEvent.click(runBtn()); });
    expect(screen.getByText(/network error/i)).toBeTruthy();
  });

  it("handles a 200 response that omits the rows array", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ count: 0 }) }) as Response));
    render(<BulkLookup />);
    type("+14155552671");
    await act(async () => { fireEvent.click(runBtn()); });
    expect(screen.getByText(/HTTP 200/)).toBeTruthy();
  });
});
