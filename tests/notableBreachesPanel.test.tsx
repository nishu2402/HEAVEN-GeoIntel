// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import NotableBreachesPanel from "@/components/shared/NotableBreachesPanel";

// NotableBreachesPanel opens a modal and lazy-loads /api/notable-breaches, then
// filters the vendored reference locally. A faithful fake of that one endpoint
// lets us prove the search, the empty state, the load-failure retry, and the
// class-less "record count + year only" rendering, including the missing-field
// branches (a row with no count or no date, and a snapshot with no revision).

interface NotableBreach { name: string; records: number | null; date: string | null }
interface NotableResponse { source: string; version: string | null; count: number; breaches: NotableBreach[] }

const full: NotableResponse = {
  source: "Wikipedia: List of data breaches",
  version: "1372774724",
  count: 2,
  breaches: [
    { name: "Aadhaar", records: 1_100_000_000, date: "2018" },
    { name: "Capital One", records: 106_000_000, date: "2019" },
  ],
};

let data: NotableResponse = full;
let getStatus = 200;
let getThrows = false;

const res = (body: unknown, status: number) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

async function fakeFetch(input: RequestInfo | URL): Promise<Response> {
  const url = String(input);
  if (url.startsWith("/api/notable-breaches")) {
    if (getThrows) throw new Error("offline");
    return res(data, getStatus);
  }
  /* v8 ignore next -- the panel only calls the one endpoint above */
  throw new Error(`unexpected ${url}`);
}

beforeEach(() => {
  data = full; getStatus = 200; getThrows = false;
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const openPanel = async () => {
  render(<NotableBreachesPanel />);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /notable breaches reference/i })); });
  await act(async () => {}); // let the lazy fetch settle
};

describe("<NotableBreachesPanel>", () => {
  it("lazy-loads the reference the first time it opens, largest first with its count", async () => {
    await openPanel();
    expect(screen.getByText("Aadhaar")).toBeTruthy();
    expect(screen.getByText("Capital One")).toBeTruthy();
    expect(screen.getByText(/2 institutional/i)).toBeTruthy();
    // provenance note carries the snapshot revision
    expect(screen.getByText(/revision 1372774724/i)).toBeTruthy();
    // record counts are formatted with separators
    expect(screen.getByText(/1,100,000,000/)).toBeTruthy();
    // fetched exactly once
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls.filter((c) => String(c[0]).startsWith("/api/notable-breaches"))).toHaveLength(1);
  });

  it("filters by name and reports when nothing matches", async () => {
    await openPanel();
    const box = screen.getByLabelText(/search notable breaches/i);
    fireEvent.change(box, { target: { value: "capital" } });
    expect(screen.getByText("Capital One")).toBeTruthy();
    expect(screen.queryByText("Aadhaar")).toBeNull();

    fireEvent.change(box, { target: { value: "zzz-nope" } });
    expect(screen.getByText(/no notable breach matches/i)).toBeTruthy();
    expect(screen.getByText(/zzz-nope/)).toBeTruthy();
  });

  it("closes on the backdrop and the X, and does not refetch on reopen", async () => {
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    expect(screen.queryByText("Aadhaar")).toBeNull();

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /notable breaches reference/i })); });
    expect(screen.getByText("Aadhaar")).toBeTruthy();
    // clicking inside the dialog keeps it open; the backdrop closes it
    fireEvent.click(screen.getByText("Aadhaar"));
    expect(screen.getByText("Aadhaar")).toBeTruthy();
    fireEvent.click(document.querySelector(".bg-black\\/75")!.parentElement!);
    expect(screen.queryByText("Aadhaar")).toBeNull();

    // still only one call — the list is cached across open/close
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls.filter((c) => String(c[0]).startsWith("/api/notable-breaches"))).toHaveLength(1);
  });

  it("surfaces a load failure with a working retry", async () => {
    getThrows = true;
    await openPanel();
    expect(screen.getByText(/could not load the notable-breaches reference/i)).toBeTruthy();
    getThrows = false;
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /retry/i })); });
    expect(screen.getByText("Aadhaar")).toBeTruthy();
  });

  it("treats a non-OK response as a load failure", async () => {
    getStatus = 503;
    await openPanel();
    expect(screen.getByText(/could not load the notable-breaches reference/i)).toBeTruthy();
  });

  it("renders a row with no record count or date, and omits the revision when absent", async () => {
    data = {
      source: "Wikipedia: List of data breaches",
      version: null,
      count: 3,
      breaches: [
        { name: "HasBoth", records: 999, date: "2020" },
        { name: "NoDate", records: 500, date: null },
        { name: "NoCount", records: null, date: "2015" },
      ],
    };
    await openPanel();
    expect(screen.getByText("HasBoth")).toBeTruthy();
    expect(screen.getByText("NoDate")).toBeTruthy();
    expect(screen.getByText("NoCount")).toBeTruthy();
    // a null-version snapshot shows the source with no "(revision …)" suffix
    expect(screen.queryByText(/revision/i)).toBeNull();
    expect(screen.getByText(/Wikipedia: List of data breaches/)).toBeTruthy();
  });
});
