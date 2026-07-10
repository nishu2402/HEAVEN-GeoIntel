// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, act, within } from "@testing-library/react";
import { installResizeObserver } from "./testUtils";

import LoadingSkeletons from "@/components/dashboard/LoadingSkeletons";
import ScanProgress from "@/components/dashboard/ScanProgress";
import SourceTabs from "@/components/dashboard/SourceTabs";
import type { LookupResponse } from "@/lib/types";

beforeAll(() => { installResizeObserver(); });
afterEach(cleanup);

describe("<LoadingSkeletons>", () => {
  it("renders the labelled skeleton grid", () => {
    render(<LoadingSkeletons />);
    expect(screen.getByLabelText(/loading results/i)).toBeTruthy();
  });
});

describe("<ScanProgress>", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });

  it("shows the per-mode label and ticks the elapsed timer, revealing the slow-source note at 8s", () => {
    render(<ScanProgress mode="username" />);
    expect(screen.getByText(/scanning 29 sites/i)).toBeTruthy();
    expect(screen.getByText("0s")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(8000); });
    expect(screen.getByText("8s")).toBeTruthy();
    expect(screen.getByText(/some free sources are slow/i)).toBeTruthy();
  });

  it("falls back to a generic label for a mode with no specific copy", () => {
    render(<ScanProgress mode="graph" />);
    expect(screen.getByText(/working…/i)).toBeTruthy();
  });
});

describe("<SourceTabs>", () => {
  // The first key (numverify) is the default-active tab, so put the branch under
  // test there. StatusDot's three states are all present in the tablist each time.
  const build = (numverify: unknown) => ({
    numverify,
    ipqs: { ok: false, error: "HTTP 500" },        // red dot
    abstract: { ok: true, data: { valid: true } }, // green dot
    twilio: { ok: false, error: "NOT_CONFIGURED" },// grey dot
    breachDirectory: { ok: true, data: { found: 0 } },
    fullContact: { ok: false, error: "NOT_FOUND" },
    hudsonRock: { ok: true, data: { total: 0 } },
  }) as unknown as LookupResponse["sources"];

  it("renders the not-configured branch with the env-var hint", () => {
    render(<SourceTabs sources={build({ ok: false, error: "NOT_CONFIGURED" })} />);
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText(/not configured/i)).toBeTruthy();
    expect(within(panel).getByText(/NUMVERIFY_API_KEY/)).toBeTruthy();
  });

  it("renders the error branch (falling back to 'Unknown error' when none given)", () => {
    const { rerender } = render(<SourceTabs sources={build({ ok: false, error: "HTTP 502" })} />);
    expect(within(screen.getByRole("tabpanel")).getByText(/HTTP 502/)).toBeTruthy();
    rerender(<SourceTabs sources={build({ ok: false })} />);
    expect(within(screen.getByRole("tabpanel")).getByText(/unknown error/i)).toBeTruthy();
  });

  it("renders the data branch as a JSON dump", () => {
    render(<SourceTabs sources={build({ ok: true, data: { carrier: "T-Mobile" } })} />);
    expect(within(screen.getByRole("tabpanel")).getByText(/"carrier": "T-Mobile"/)).toBeTruthy();
  });
});
