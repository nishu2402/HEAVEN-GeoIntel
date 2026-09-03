// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import PivotRow, { type PivotRowLink } from "@/components/shared/PivotRow";
import { ACCESS_META, BLOCK_CAVEAT, BLOCK_LIMIT } from "@/lib/osint/accessTier";

const web = (over: Partial<PivotRowLink> = {}): PivotRowLink => ({
  label: "Radaris",
  description: "Reverse phone",
  url: "https://radaris.com/phone/14155552671",
  color: "#00ff41",
  access: "free",
  ...over,
});

afterEach(cleanup);

describe("<PivotRow> web links", () => {
  it("opens in a new tab without handing the opener to the target", () => {
    render(<PivotRow link={web()} />);
    const a = screen.getByRole("link");
    expect(a.getAttribute("target")).toBe("_blank");
    // rel is the whole reason target="_blank" is safe here: these are untrusted
    // third-party OSINT sites, and window.opener would let them navigate the tab
    // the analyst's results are sitting in.
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    expect(a.getAttribute("title")).toBe(ACCESS_META.free.hint);
    expect(screen.getByText("FREE")).toBeTruthy();
    expect(screen.getByText("Reverse phone")).toBeTruthy();
  });

  it("marks a US-only source so a non-US number is not searched in vain", () => {
    render(<PivotRow link={web({ usOnly: true })} />);
    expect(screen.getByText("[US]")).toBeTruthy();
  });

  it("does not carry the [US] marker by default", () => {
    render(<PivotRow link={web()} />);
    expect(screen.queryByText("[US]")).toBeNull();
  });

  it("swaps the tier hint for the vantage caveat on a blocked row", () => {
    render(<PivotRow link={web({ label: "PeekYou", access: "blocked" })} />);
    expect(screen.getByRole("link").getAttribute("title")).toBe(BLOCK_CAVEAT);
    expect(screen.getByText(BLOCK_LIMIT)).toBeTruthy();
  });

  it("leaves the caveat off every other tier", () => {
    for (const access of ["free", "captcha", "login", "paid"] as const) {
      render(<PivotRow link={web({ access })} />);
      expect(screen.queryByText(BLOCK_LIMIT), `${access} must not claim a vantage`).toBeNull();
      cleanup();
    }
  });
});

describe("<PivotRow> app URIs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // copyText only reaches the clipboard API when the context is secure;
    // without this it silently takes the execCommand path and the spy below
    // never fires, which looks like a passing test asserting nothing.
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
  });
  afterEach(() => vi.useRealTimers());

  it("copies instead of navigating, then reverts the label", async () => {
    // Handing tg: to an <a href> is the bug this component exists to fix: a
    // desktop browser with no registered handler answers the click with "can't
    // open this page" and, with target="_blank", leaves a dead tab behind.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    const uri = "tg://resolve?phone=14155552671";
    render(<PivotRow link={web({ label: "Telegram", url: uri, access: "app" })} />);

    const btn = screen.getByRole("button");
    expect(screen.queryByRole("link")).toBeNull();
    expect(btn.getAttribute("title")).toBe(`Copy ${uri}`);

    fireEvent.click(btn);
    expect(writeText).toHaveBeenCalledWith(uri);
    expect(screen.getByText("Copied: paste it on a device with the app")).toBeTruthy();

    // act() because the revert runs inside a timer: React will not flush a state
    // update queued from setTimeout until something asks it to.
    await act(async () => { vi.advanceTimersByTime(1600); });
    expect(screen.getByText("Reverse phone")).toBeTruthy();
  });
});
