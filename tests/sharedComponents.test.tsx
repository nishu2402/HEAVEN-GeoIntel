// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

import SimpleLookupInput from "@/components/shared/SimpleLookupInput";
import PanelErrorBoundary from "@/components/shared/PanelErrorBoundary";
import HelpPopover from "@/components/shared/HelpPopover";
import ShareButton from "@/components/shared/ShareButton";
import CopyLinkButton from "@/components/shared/CopyLinkButton";
import SourceStrip, { type SourceStat } from "@/components/shared/SourceStrip";
import Tilt3D from "@/components/shared/Tilt3D";

// Interaction + branch coverage for the small shared components. jsdom supplies
// the DOM; clipboard is stubbed so copyText resolves without touching a real one.

afterEach(cleanup);

describe("<SimpleLookupInput>", () => {
  it("blocks an empty submit with an inline error", () => {
    const onLookup = vi.fn();
    render(<SimpleLookupInput placeholder="ip" onLookup={onLookup} />);
    fireEvent.click(screen.getByRole("button", { name: /execute/i }));
    expect(screen.getByText(/enter a value to look up/i)).toBeTruthy();
    expect(onLookup).not.toHaveBeenCalled();
  });

  it("blocks submit when validate returns an error, then clears the error on typing", () => {
    const onLookup = vi.fn();
    render(
      <SimpleLookupInput
        placeholder="user" onLookup={onLookup}
        validate={(v) => (v.length < 3 ? "too short" : null)}
      />,
    );
    const input = screen.getByPlaceholderText("user");
    fireEvent.change(input, { target: { value: "ab" } });
    fireEvent.keyDown(input, { key: "a" }); // non-Enter keydown is a no-op
    expect(screen.queryByText("too short")).toBeNull();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("too short")).toBeTruthy();
    expect(onLookup).not.toHaveBeenCalled();
    // typing while an error is shown clears it
    fireEvent.change(input, { target: { value: "abc" } });
    expect(screen.queryByText("too short")).toBeNull();
  });

  it("submits a trimmed valid value (validate returning null / undefined both pass)", () => {
    const onLookup = vi.fn();
    const { rerender } = render(<SimpleLookupInput placeholder="ip" onLookup={onLookup} validate={() => null} />);
    fireEvent.change(screen.getByPlaceholderText("ip"), { target: { value: "  8.8.8.8  " } });
    fireEvent.click(screen.getByRole("button", { name: /execute/i }));
    expect(onLookup).toHaveBeenCalledWith("8.8.8.8");

    // no validate prop → the `?? null` fallback path
    onLookup.mockClear();
    rerender(<SimpleLookupInput placeholder="ip" onLookup={onLookup} />);
    fireEvent.change(screen.getByPlaceholderText("ip"), { target: { value: "1.1.1.1" } });
    fireEvent.click(screen.getByRole("button", { name: /execute/i }));
    expect(onLookup).toHaveBeenCalledWith("1.1.1.1");
  });

  it("renders an icon + hint, and shows SCANNING and a disabled button while loading", () => {
    const { rerender } = render(
      <SimpleLookupInput placeholder="ip" hint="free, no key" icon={<svg data-testid="ic" />} onLookup={() => {}} />,
    );
    expect(screen.getByTestId("ic")).toBeTruthy();
    expect(screen.getByText("free, no key")).toBeTruthy();

    rerender(<SimpleLookupInput placeholder="ip" hint="free, no key" onLookup={() => {}} loading />);
    expect(screen.getByText(/scanning/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: /scanning/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the clear button only when onClear is given, and resets on click", () => {
    const onClear = vi.fn();
    const { rerender } = render(<SimpleLookupInput placeholder="ip" onLookup={() => {}} />);
    expect(screen.queryByRole("button", { name: /^clear$/i })).toBeNull();

    rerender(<SimpleLookupInput placeholder="ip" onLookup={() => {}} onClear={onClear} />);
    const input = screen.getByPlaceholderText("ip") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /^clear$/i }));
    expect(onClear).toHaveBeenCalled();
    expect(input.value).toBe("");
  });
});

describe("<PanelErrorBoundary>", () => {
  const Boom = () => { throw new Error("kaboom"); };

  it("renders children when nothing throws", () => {
    render(<PanelErrorBoundary label="X"><div>safe child</div></PanelErrorBoundary>);
    expect(screen.getByText("safe child")).toBeTruthy();
  });

  it("catches a render error, shows the labelled fallback, and recovers on Try again", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let shouldThrow = true;
    const Maybe = () => (shouldThrow ? <Boom /> : <div>recovered</div>);
    render(<PanelErrorBoundary label="Phone results"><Maybe /></PanelErrorBoundary>);

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(/panel error — phone results/i)).toBeTruthy();

    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(screen.getByText("recovered")).toBeTruthy();
    spy.mockRestore();
  });
});

describe("<HelpPopover>", () => {
  it("opens the dialog, closes via the X button", () => {
    render(<HelpPopover />);
    fireEvent.click(screen.getByRole("button", { name: /help — what can i do here/i }));
    expect(screen.getByText(/what can i do here\?/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    expect(screen.queryByText(/one console, eight modes/i)).toBeNull();
  });

  it("closes on backdrop click but not when clicking the panel body", () => {
    const { container } = render(<HelpPopover />);
    fireEvent.click(screen.getByRole("button", { name: /help — what can i do here/i }));
    // clicking inside the panel is stopped from closing
    fireEvent.click(screen.getByText(/one console, eight modes/i));
    expect(screen.getByText(/one console, eight modes/i)).toBeTruthy();
    // clicking the outer overlay closes it
    const overlay = container.querySelector(".fixed.inset-0") as HTMLElement;
    fireEvent.click(overlay);
    expect(screen.queryByText(/one console, eight modes/i)).toBeNull();
  });
});

describe("<ShareButton> / <CopyLinkButton>", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true,
    });
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
  });
  afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });

  it("ShareButton copies a q= URL and flips to COPIED, then back after 2s", () => {
    render(<ShareButton e164="+14155552671" />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText(/url copied/i)).toBeTruthy();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("q=%2B14155552671"));
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByText(/share link/i)).toBeTruthy();
  });

  it("CopyLinkButton copies the current URL, and honours a custom className", () => {
    const { rerender } = render(<CopyLinkButton />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText(/link copied/i)).toBeTruthy();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByText(/copy link/i)).toBeTruthy();

    rerender(<CopyLinkButton className="my-custom" />);
    expect(document.querySelector("button.my-custom")).toBeTruthy();
  });
});

describe("<SourceStrip>", () => {
  it("renders nothing for an empty source list", () => {
    const { container } = render(<SourceStrip sources={[]} />);
    expect(container.textContent).toBe("");
  });

  it("renders a chip per source across every state, honouring a custom label + detail title", () => {
    const sources: SourceStat[] = [
      { source: "ip-api", state: "ok" },
      { source: "Shodan", state: "empty" },
      { source: "GreyNoise", state: "error", detail: "HTTP 500" },
      { source: "Twilio", state: "off" },
    ];
    render(<SourceStrip sources={sources} label="Providers" />);
    expect(screen.getByText(/providers:/i)).toBeTruthy();
    for (const s of sources) expect(screen.getByText(s.source)).toBeTruthy();
    // detail wins over the default state label for the tooltip
    expect(screen.getByText("GreyNoise").closest("span")!.getAttribute("title")).toBe("HTTP 500");
    // default label used when no detail
    expect(screen.getByText("ip-api").closest("span")!.getAttribute("title")).toBe("answered");
  });
});

describe("<Tilt3D>", () => {
  it("sets tilt CSS vars on mouse move and resets them on leave", () => {
    const { container } = render(<Tilt3D className="card"><span>inner</span></Tilt3D>);
    const el = container.querySelector(".tilt-card") as HTMLDivElement;
    el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => {} });
    fireEvent.mouseMove(el, { clientX: 200, clientY: 0 });
    expect(el.style.getPropertyValue("--ry")).toBe("6deg");   // (1.0-0.5)*6*2
    expect(el.style.getPropertyValue("--rx")).toBe("6deg");   // (0.5-0.0)*6*2
    fireEvent.mouseLeave(el);
    expect(el.style.getPropertyValue("--rx")).toBe("0deg");
    expect(el.style.getPropertyValue("--ry")).toBe("0deg");
    expect(screen.getByText("inner")).toBeTruthy();
  });
});
