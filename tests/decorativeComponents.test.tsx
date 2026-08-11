// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { installMemoryLocalStorage } from "./testUtils";
import BootSequence from "@/components/shared/BootSequence";
import MatrixRain from "@/components/shared/MatrixRain";
import { FX_KEY, FX_EVENT } from "@/lib/client/effects";
import { APP_VERSION } from "@/lib/version";

beforeAll(() => {
  installMemoryLocalStorage();
  // jsdom has no matchMedia; every real browser does. MatrixRain uses it to
  // react to the OS reduced-motion preference.
  const listeners = new Set<() => void>();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
      dispatch: () => listeners.forEach((fn) => fn()),
    }),
  });
});
beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("<BootSequence>", () => {
  it("renders every boot line, styling the ready line and the spacer distinctly", () => {
    const { container } = render(<BootSequence onDone={() => {}} />);
    // Asserted against the version module, not a literal — a release bump must
    // not have to remember this file.
    expect(screen.getByText(new RegExp(`HEAVEN-GeoIntel v${APP_VERSION}`))).toBeTruthy();
    expect(screen.getByText(/SYSTEM READY/).className).toMatch(/glow-green/);
    // the blank line renders a non-breaking space rather than collapsing
    const spacer = container.querySelector(".h-3")!;
    expect(spacer.textContent).toBe(" ");
    expect(container.firstElementChild!.children).toHaveLength(11);
  });
});

describe("<MatrixRain>", () => {
  type Ctx = Record<string, unknown>;
  let ctx: Ctx | null;
  const fills: string[] = [];

  const fakeCtx = (): Ctx => ({
    fillStyle: "", font: "",
    fillRect: vi.fn(), clearRect: vi.fn(),
    fillText: vi.fn((c: string) => { fills.push(c); }),
  });

  beforeEach(() => {
    fills.length = 0;
    ctx = fakeCtx();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ctx as never);
    vi.useFakeTimers();
  });
  afterEach(() => { vi.useRealTimers(); });

  it("bails out when the 2D context is unavailable", () => {
    ctx = null;
    render(<MatrixRain />);
    act(() => { vi.advanceTimersByTime(200); });
    expect(fills).toHaveLength(0);
  });

  it("draws on an interval while effects are on, and stops + clears when turned off", () => {
    render(<MatrixRain />);
    act(() => { vi.advanceTimersByTime(60); });
    expect(fills.length).toBeGreaterThan(0);
    const drawn = fills.length;

    localStorage.setItem(FX_KEY, "0");
    act(() => { window.dispatchEvent(new CustomEvent(FX_EVENT)); });
    expect(ctx!.clearRect).toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(200); });
    expect(fills).toHaveLength(drawn); // no further frames

    // …and turning them back on restarts the interval
    localStorage.setItem(FX_KEY, "1");
    act(() => { window.dispatchEvent(new CustomEvent(FX_EVENT)); });
    act(() => { vi.advanceTimersByTime(60); });
    expect(fills.length).toBeGreaterThan(drawn);
  });

  it("never starts when effects are already off, and unmounts cleanly", () => {
    localStorage.setItem(FX_KEY, "0");
    const { unmount } = render(<MatrixRain />);
    act(() => { vi.advanceTimersByTime(200); });
    expect(fills).toHaveLength(0);
    unmount(); // cleanup with interval === null
  });

  it("only resets a drop past the bottom edge when the random roll clears the threshold", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5); // 0.5 < 0.975 → no reset
    render(<MatrixRain />);
    // A drop starts at 1 and advances one row (13px) per 55ms frame, so ~60
    // frames carry it past the 768px-tall canvas.
    act(() => { vi.advanceTimersByTime(55 * 70); });
    const yBeforeReset = lastDrawnY();
    expect(yBeforeReset).toBeGreaterThan(768); // fell past the edge, still not reset

    random.mockReturnValue(0.99); // now the roll clears 0.975 → reset to the top
    act(() => { vi.advanceTimersByTime(55 * 2); });
    expect(lastDrawnY()).toBeLessThan(yBeforeReset);
  });

  /** The y coordinate of the most recent fillText call. */
  function lastDrawnY(): number {
    const calls = (ctx!.fillText as ReturnType<typeof vi.fn>).mock.calls;
    return calls[calls.length - 1]![2] as number;
  }

  it("resizes the drop columns with the window", () => {
    render(<MatrixRain />);
    act(() => { vi.advanceTimersByTime(60); });
    const perFrame = fills.length;

    // Double the width: the redraw must cover roughly twice as many columns.
    Object.defineProperty(window, "innerWidth", { value: 2048, configurable: true });
    act(() => { window.dispatchEvent(new Event("resize")); });
    fills.length = 0;
    act(() => { vi.advanceTimersByTime(60); });
    expect(fills.length).toBeGreaterThan(perFrame);
  });
});
