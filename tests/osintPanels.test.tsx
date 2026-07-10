// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import CountryPanel from "@/components/osint/CountryPanel";
import LocationPanel from "@/components/osint/LocationPanel";
import QrCodePanel from "@/components/osint/QrCodePanel";
import type { CountryIntel } from "@/lib/data/countryIntel";
import type { LookupResponse } from "@/lib/types";

// `qrcode` draws to a real canvas, which jsdom has no backend for — swap it for
// a promise we control so both the ready and the failure path are exercised.
const toCanvas = vi.fn();
vi.mock("qrcode", () => ({ default: { toCanvas: (...a: unknown[]) => toCanvas(...a) } }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// ── CountryPanel ─────────────────────────────────────────────────────────────
const intel = (over: Partial<CountryIntel> = {}): CountryIntel => ({
  code: "US", name: "United States", officialName: "United States of America",
  capital: "Washington, D.C.", region: "Americas", subregion: "North America",
  continent: "North America", population: 331_000_000, area: 9_833_520,
  currency: { code: "USD", name: "US Dollar", symbol: "$" },
  languages: ["English"], callingCode: "+1", tld: [".us"], flagEmoji: "🇺🇸",
  drivingSide: "right", timezones: ["America/New_York", "America/Los_Angeles"],
  emergencyNumber: "911", internetUsers: "91%", gdpPerCapita: "$76,398",
  ...over,
});

describe("<CountryPanel>", () => {
  it("renders the country header, every data row and each timezone chip", () => {
    render(<CountryPanel intel={intel()} />);
    expect(screen.getByText("United States")).toBeTruthy();
    expect(screen.getByText("United States of America")).toBeTruthy();
    expect(screen.getByText("Washington, D.C.")).toBeTruthy();
    expect(screen.getByText("Americas — North America")).toBeTruthy();
    expect(screen.getByText("$ USD — US Dollar")).toBeTruthy();
    expect(screen.getByText("→ Right side")).toBeTruthy();
    expect(screen.getByText("America/New_York")).toBeTruthy();
    expect(screen.getByText("America/Los_Angeles")).toBeTruthy();
  });

  it("shows the left-hand-drive label for left-driving countries", () => {
    render(<CountryPanel intel={intel({ drivingSide: "left" })} />);
    expect(screen.getByText("← Left side")).toBeTruthy();
  });

  it("abbreviates population across every magnitude", () => {
    const pop = (n: number) => {
      cleanup();
      render(<CountryPanel intel={intel({ population: n })} />);
      return screen.getByText("Population").nextElementSibling!.textContent;
    };
    expect(pop(1_400_000_000)).toBe("1.4B");
    expect(pop(331_000_000)).toBe("331.0M");
    expect(pop(5_400)).toBe("5K");
    expect(pop(812)).toBe("812");
  });
});

// ── LocationPanel ────────────────────────────────────────────────────────────
type Agg = Partial<LookupResponse["aggregated"]>;
type Ana = { npaInfo: { state: string; stateAbbr: string; region: string } | null };

const lookup = (aggregated: Agg, analysis: Ana, countryIntel: unknown = null): LookupResponse =>
  ({
    input: { countryCallingCode: "+1" },
    aggregated: { countryName: "United States", ...aggregated },
    analysis,
    countryIntel,
  }) as unknown as LookupResponse;

describe("<LocationPanel>", () => {
  it("renders the full geography stack when every row carries distinct information", () => {
    render(<LocationPanel data={lookup(
      { city: "San Francisco", region: "Northern California", areaCode: "415", timezone: ["America/Los_Angeles"], utcOffsets: ["UTC-08:00"] },
      { npaInfo: { state: "California", stateAbbr: "CA", region: "Bay Area" } },
    )} />);
    expect(screen.getByText("United States (+1)")).toBeTruthy();
    expect(screen.getByText("California (CA)")).toBeTruthy();
    expect(screen.getByText("Bay Area")).toBeTruthy();
    expect(screen.getByText("Northern California")).toBeTruthy();
    expect(screen.getByText("San Francisco")).toBeTruthy();
    expect(screen.getByText("415")).toBeTruthy();
    expect(screen.getByText("America/Los_Angeles (UTC-08:00)")).toBeTruthy();
  });

  it("suppresses the API region when it repeats the state name", () => {
    // The state row reads "California (CA)"; a region of "California" is the same
    // place and must not get its own row.
    render(<LocationPanel data={lookup(
      { region: "California" },
      { npaInfo: { state: "California", stateAbbr: "CA", region: "Bay Area" } },
    )} />);
    expect(screen.getByText("California (CA)")).toBeTruthy();
    expect(screen.queryByText("Region (API)")).toBeNull();
  });

  it("suppresses the API region when it repeats the city or the metro", () => {
    const { unmount } = render(<LocationPanel data={lookup({ city: "Reno", region: "Reno" }, { npaInfo: null })} />);
    expect(screen.queryByText("Region (API)")).toBeNull();
    unmount();

    render(<LocationPanel data={lookup({ region: "Bay Area" }, { npaInfo: { state: "California", stateAbbr: "CA", region: "Bay Area" } })} />);
    expect(screen.queryByText("Region (API)")).toBeNull();
  });

  it("suppresses the metro row when it repeats the state name", () => {
    render(<LocationPanel data={lookup({}, { npaInfo: { state: "Alaska", stateAbbr: "AK", region: "Alaska" } })} />);
    expect(screen.getByText("Alaska (AK)")).toBeTruthy();
    expect(screen.queryByText("Metro / Region")).toBeNull();
  });

  it("falls back to the country's timezone, and to a bare UTC offset", () => {
    const { unmount } = render(<LocationPanel data={lookup({}, { npaInfo: null }, { timezones: ["Europe/Paris"] })} />);
    expect(screen.getByText("Europe/Paris")).toBeTruthy();
    unmount();

    render(<LocationPanel data={lookup({ utcOffsets: ["UTC+01:00"] }, { npaInfo: null })} />);
    expect(screen.getByText("UTC+01:00")).toBeTruthy();
  });

  it("says only country-level geography is available rather than showing empty rows", () => {
    render(<LocationPanel data={lookup({}, { npaInfo: null })} />);
    expect(screen.getByText(/only country-level geography available/i)).toBeTruthy();
    expect(screen.queryByText("Timezone")).toBeNull();
  });

  it("keeps the geography rows when some are present, hiding the country-only note", () => {
    render(<LocationPanel data={lookup({ city: "Austin" }, { npaInfo: null })} />);
    expect(screen.queryByText(/only country-level geography available/i)).toBeNull();
  });
});

// ── QrCodePanel ──────────────────────────────────────────────────────────────
describe("<QrCodePanel>", () => {
  const deferred = () => {
    let resolve!: () => void, reject!: () => void;
    const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };

  beforeEach(() => { toCanvas.mockReset(); });

  it("shows a placeholder while generating, then the canvas and a save button", async () => {
    const d = deferred();
    toCanvas.mockReturnValue(d.promise);
    render(<QrCodePanel e164="+14155552671" />);
    expect(screen.getByText(/generating\.\.\./i)).toBeTruthy();
    expect(screen.getByText("tel:+14155552671")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /save png/i })).toBeNull();
    expect(toCanvas).toHaveBeenCalledWith(expect.anything(), "tel:+14155552671", expect.objectContaining({ width: 180 }));

    await act(async () => { d.resolve(); await d.promise; });
    expect(screen.queryByText(/generating\.\.\./i)).toBeNull();
    expect(screen.getByRole("button", { name: /save png/i })).toBeTruthy();
  });

  it("reports a generation failure instead of hanging on the placeholder", async () => {
    const d = deferred();
    toCanvas.mockReturnValue(d.promise);
    render(<QrCodePanel e164="+14155552671" />);
    await act(async () => { d.reject(); await d.promise.catch(() => {}); });
    expect(screen.getByText(/qr generation failed/i)).toBeTruthy();
    expect(screen.queryByText(/generating\.\.\./i)).toBeNull();
    expect(screen.queryByRole("button", { name: /save png/i })).toBeNull();
  });

  it("ignores a resolution that lands after the number changed", async () => {
    const first = deferred();
    const second = deferred();
    toCanvas.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { rerender } = render(<QrCodePanel e164="+14155552671" />);
    rerender(<QrCodePanel e164="+442071838750" />); // cancels the first effect
    await act(async () => { first.resolve(); await first.promise; });
    expect(screen.getByText(/generating\.\.\./i)).toBeTruthy(); // stale result ignored

    await act(async () => { second.resolve(); await second.promise; });
    expect(screen.getByText("tel:+442071838750")).toBeTruthy();
    expect(screen.getByRole("button", { name: /save png/i })).toBeTruthy();
  });

  it("ignores a rejection that lands after the number changed", async () => {
    const first = deferred();
    const second = deferred();
    toCanvas.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { rerender } = render(<QrCodePanel e164="+14155552671" />);
    rerender(<QrCodePanel e164="+442071838750" />);
    await act(async () => { first.reject(); await first.promise.catch(() => {}); });
    expect(screen.queryByText(/qr generation failed/i)).toBeNull();
  });

  it("downloads the QR as a PNG named after the number", async () => {
    const d = deferred();
    toCanvas.mockReturnValue(d.promise);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,AAA");
    const clicks: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this.download);
    });
    render(<QrCodePanel e164="+14155552671" />);
    await act(async () => { d.resolve(); await d.promise; });
    fireEvent.click(screen.getByRole("button", { name: /save png/i }));
    expect(clicks).toEqual(["14155552671_qr.png"]);
  });
});
