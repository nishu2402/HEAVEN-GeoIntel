// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import SourcesPanel from "@/components/shared/SourcesPanel";

// SourcesPanel opens a modal, lazy-loads /api/sources, and posts/deletes keys via
// /api/keys. A faithful fake of both endpoints lets us prove the panel never
// clears a typed key on a rejected save and surfaces load/save/clear failures.

interface SourceInfo {
  id: string; name: string; tier: "free" | "key"; configured: boolean;
  via?: "ui" | "env" | null; keys?: string[]; unlocks: string; modes: string[]; signup?: string;
}

const free = (over: Partial<SourceInfo> = {}): SourceInfo =>
  ({ id: "ipapi", name: "ip-api", tier: "free", configured: true, unlocks: "IP geo", modes: ["ip"], ...over });
const keyed = (over: Partial<SourceInfo> = {}): SourceInfo =>
  ({ id: "ipqs", name: "IPQualityScore", tier: "key", configured: false, via: null, keys: ["IPQS_API_KEY"],
     unlocks: "Fraud score", modes: ["phone"], signup: "https://ipqualityscore.com", ...over });

let sources: SourceInfo[] = [];
let keyActive = 0;
let getStatus = 200;
let postStatus = 200;
let deleteStatus = 200;
let getThrows = false;
const posted: { name: string; value: string }[] = [];
const deleted: string[] = [];

const res = (body: unknown, status: number) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const method = init?.method ?? "GET";
  if (url.startsWith("/api/sources")) {
    if (getThrows) throw new Error("offline");
    return res({ sources, keyActive, keyTotal: sources.filter((s) => s.tier === "key").length }, getStatus);
  }
  if (url.startsWith("/api/keys")) {
    if (method === "POST") {
      const body = JSON.parse(String(init!.body));
      posted.push(body);
      return res(postStatus === 200 ? { ok: true } : { error: "bad" }, postStatus);
    }
    if (method === "DELETE") {
      deleted.push(new URL(url, "http://x").searchParams.get("name")!);
      return res(deleteStatus === 200 ? { ok: true } : { error: "bad" }, deleteStatus);
    }
  }
  /* v8 ignore next -- the panel only calls the two endpoints above */
  throw new Error(`unexpected ${method} ${url}`);
}

beforeEach(() => {
  sources = [free(), keyed()];
  keyActive = 0; getStatus = postStatus = deleteStatus = 200; getThrows = false;
  posted.length = 0; deleted.length = 0;
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const openPanel = async () => {
  render(<SourcesPanel />);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /data sources and api keys/i })); });
  await act(async () => {}); // let the lazy fetch settle
};

describe("<SourcesPanel>", () => {
  it("lazy-loads the source list the first time it opens", async () => {
    await openPanel();
    expect(screen.getByText("ip-api")).toBeTruthy();
    expect(screen.getByText("IPQualityScore")).toBeTruthy();
    expect(screen.getByText(/always on — no key needed/i)).toBeTruthy();
    // the free source shows its ON badge; the keyed one shows "not set"
    expect(screen.getByText("ON")).toBeTruthy();
    expect(screen.getByText("not set")).toBeTruthy();
    // fetched exactly once
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls.filter((c) => String(c[0]).startsWith("/api/sources"))).toHaveLength(1);
  });

  it("closes on the backdrop and the X, and does not refetch on reopen", async () => {
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    expect(screen.queryByText("IPQualityScore")).toBeNull();

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /data sources and api keys/i })); });
    expect(screen.getByText("IPQualityScore")).toBeTruthy();
    // still only one /api/sources call — the list is cached
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls.filter((c) => String(c[0]).startsWith("/api/sources"))).toHaveLength(1);

    // clicking the backdrop closes it; clicking inside the dialog does not
    fireEvent.click(screen.getByText("IPQualityScore")); // inside → stays open
    expect(screen.getByText("IPQualityScore")).toBeTruthy();
    fireEvent.click(document.querySelector(".bg-black\\/75")!.parentElement!);
    expect(screen.queryByText("IPQualityScore")).toBeNull();
  });

  it("keeps the panel open with a Save button disabled until a key is typed", async () => {
    await openPanel();
    const save = screen.getByRole("button", { name: /save/i });
    expect(save).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("IPQS_API_KEY"), { target: { value: "  " } }); // whitespace only
    expect(save).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("IPQS_API_KEY"), { target: { value: "secret" } });
    expect(save).toHaveProperty("disabled", false);
  });

  it("saves a typed key, clears the field, and refreshes", async () => {
    await openPanel();
    fireEvent.change(screen.getByLabelText("IPQS_API_KEY"), { target: { value: "secret-key" } });
    // once saved, the server reports it configured
    sources = [free(), keyed({ configured: true, via: "ui" })];
    keyActive = 1;
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /save/i })); });
    expect(posted).toEqual([{ name: "IPQS_API_KEY", value: "secret-key" }]);
    expect((screen.getByLabelText("IPQS_API_KEY") as HTMLInputElement).value).toBe(""); // cleared
    expect(screen.getByText("active")).toBeTruthy();
    expect(screen.getByText(/1\/1 keys active/)).toBeTruthy();
  });

  it("does NOT clear the typed key when the server rejects the save", async () => {
    await openPanel();
    fireEvent.change(screen.getByLabelText("IPQS_API_KEY"), { target: { value: "secret-key" } });
    postStatus = 400;
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /save/i })); });
    // the regression: a rejected POST used to wipe the field as if it had worked
    expect((screen.getByLabelText("IPQS_API_KEY") as HTMLInputElement).value).toBe("secret-key");
    expect(screen.getByRole("alert").textContent).toMatch(/could not save/i);
  });

  it("reports a save that never reaches the server", async () => {
    await openPanel();
    fireEvent.change(screen.getByLabelText("IPQS_API_KEY"), { target: { value: "secret-key" } });
    (fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => { throw new Error("down"); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /save/i })); });
    expect(screen.getByRole("alert").textContent).toMatch(/server unreachable/i);
    expect((screen.getByLabelText("IPQS_API_KEY") as HTMLInputElement).value).toBe("secret-key");
  });

  it("clears a UI-configured key and refreshes", async () => {
    sources = [free(), keyed({ configured: true, via: "ui" })];
    keyActive = 1;
    await openPanel();
    sources = [free(), keyed({ configured: false, via: null })];
    keyActive = 0;
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /clear ipqualityscore key/i })); });
    expect(deleted).toEqual(["IPQS_API_KEY"]);
    expect(screen.getByText("not set")).toBeTruthy();
  });

  it("reports a failed clear", async () => {
    sources = [free(), keyed({ configured: true, via: "ui" })];
    await openPanel();
    deleteStatus = 500;
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /clear ipqualityscore key/i })); });
    expect(screen.getByRole("alert").textContent).toMatch(/could not clear/i);
  });

  it("shows an env-configured key as read-only (no clear button) and labels it via .env", async () => {
    sources = [free(), keyed({ configured: true, via: "env" })];
    await openPanel();
    expect(screen.getByText("via .env")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /clear ipqualityscore key/i })).toBeNull();
  });

  it("labels multi-key sources per field and swaps the single-key placeholder when configured", async () => {
    sources = [
      keyed({ id: "twilio", name: "Twilio", keys: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"] }),
      keyed({ id: "rapid", name: "BreachDirectory", keys: ["RAPIDAPI_KEY"], configured: true, via: "ui" }),
    ];
    await openPanel();
    // multi-key → each field is labelled with its pretty name (RapidAPI acronym preserved)
    expect(screen.getByPlaceholderText(/account sid…/i)).toBeTruthy();
    expect(screen.getByPlaceholderText(/auth token…/i)).toBeTruthy();
    // single configured key → "replace key…" rather than "paste key…"
    expect(screen.getByPlaceholderText(/replace key…/i)).toBeTruthy();
  });

  it("posts only the filled fields of a multi-key source, skipping the blank ones", async () => {
    sources = [keyed({ id: "twilio", name: "Twilio", keys: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"] })];
    await openPanel();
    fireEvent.change(screen.getByLabelText("TWILIO_ACCOUNT_SID"), { target: { value: "AC123" } });
    // leave TWILIO_AUTH_TOKEN empty → it must be skipped, not posted as ""
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /save/i })); });
    expect(posted).toEqual([{ name: "TWILIO_ACCOUNT_SID", value: "AC123" }]);
  });

  it("renders a key-tier source with no key fields without crashing", async () => {
    // Defensive: the render coalesces a missing `keys` to []. Save stays disabled.
    sources = [keyed({ id: "weird", name: "Weird", keys: undefined })];
    await openPanel();
    expect(screen.getByText("Weird")).toBeTruthy();
    expect(screen.getByRole("button", { name: /save/i })).toHaveProperty("disabled", true);
  });

  it("reports a clear that never reaches the server", async () => {
    sources = [free(), keyed({ configured: true, via: "ui" })];
    await openPanel();
    (fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => { throw new Error("down"); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /clear ipqualityscore key/i })); });
    expect(screen.getByRole("alert").textContent).toMatch(/could not clear .* server unreachable/i);
  });

  it("surfaces a load failure with a working retry", async () => {
    getThrows = true;
    await openPanel();
    expect(screen.getByText(/could not load the source list/i)).toBeTruthy();
    getThrows = false;
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /retry/i })); });
    expect(screen.getByText("IPQualityScore")).toBeTruthy();
  });

  it("treats a non-OK sources response as a load failure", async () => {
    getStatus = 503;
    await openPanel();
    expect(screen.getByText(/could not load the source list/i)).toBeTruthy();
  });
});
