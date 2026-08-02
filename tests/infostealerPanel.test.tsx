// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import InfostealerPanel from "@/components/breach/InfostealerPanel";
import type { HudsonRockData, HudsonRockStealer, SourceResult } from "@/lib/types";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const stealer = (over: Partial<HudsonRockStealer> = {}): HudsonRockStealer => ({
  computerName: null, operatingSystem: null, malwareFamily: null, dateCompromised: null,
  ip: null, topPasswords: [], topLogins: [], ...over,
});
const data = (source: SourceResult<HudsonRockData>) => source;

describe("<InfostealerPanel>", () => {
  it("shows a rate-limit message when Hudson Rock is throttled", () => {
    render(<InfostealerPanel subject="phone number" source={data({ ok: false, error: "RATE_LIMITED" })} />);
    expect(screen.getByText(/rate-limited/i)).toBeTruthy();
  });

  it("shows a generic failure with the error, and an 'unknown' fallback", () => {
    const { unmount } = render(<InfostealerPanel subject="phone number" source={data({ ok: false, error: "boom" })} />);
    expect(screen.getByText(/check failed: boom/i)).toBeTruthy();
    unmount();
    render(<InfostealerPanel subject="phone number" source={data({ ok: false } as SourceResult<HudsonRockData>)} />);
    expect(screen.getByText(/check failed: unknown/i)).toBeTruthy();
  });

  it("renders the CLEAN state when there are no infections", () => {
    render(<InfostealerPanel subject="phone number" source={data({ ok: true, data: { total: 0, stealers: [] } })} />);
    expect(screen.getByText("CLEAN")).toBeTruthy();
    expect(screen.getByText(/indexes ~26M infected devices/i)).toBeTruthy();
  });

  it("renders a single infection with singular wording and every stealer field", () => {
    render(<InfostealerPanel subject="phone number" source={data({ ok: true, data: { total: 1, stealers: [stealer({
      malwareFamily: "redline", dateCompromised: "2025-01-02T00:00:00Z", operatingSystem: "Windows 10",
      computerName: "DESKTOP-1", ip: "8.8.8.8", topLogins: ["https://a.com", ""], topPasswords: ["p***d"],
    })] } })} />);
    expect(screen.getByText(/1 INFECTION$/)).toBeTruthy(); // singular, no trailing S
    expect(screen.getByText("REDLINE")).toBeTruthy();       // uppercased family
    expect(screen.getByText("2025-01-02")).toBeTruthy();    // formatted date
    expect(screen.getByText("Windows 10")).toBeTruthy();
    expect(screen.getByText("· DESKTOP-1")).toBeTruthy();
    expect(screen.getByText("8.8.8.8")).toBeTruthy();
    expect(screen.getByText("https://a.com")).toBeTruthy(); // empty login filtered out
    expect(screen.getByText("p***d")).toBeTruthy();
  });

  it("pluralises multiple infections and tolerates a stealer with no detail fields", () => {
    render(<InfostealerPanel subject="phone number" source={data({ ok: true, data: { total: 2, stealers: [stealer(), stealer()] } })} />);
    expect(screen.getByText(/2 INFECTIONS/)).toBeTruthy();
    // no logins/passwords sections rendered for the bare stealers
    expect(screen.queryByText(/Sites this credential/i)).toBeNull();
    expect(screen.queryByText(/Sample captured passwords/i)).toBeNull();
  });

  it("handles a positive total that carries no stealer detail rows", () => {
    render(<InfostealerPanel subject="phone number" source={data({ ok: true, data: { total: 3, stealers: [] } })} />);
    expect(screen.getByText(/3 INFECTIONS/)).toBeTruthy();
    // the detail block only renders when stealers exist
    expect(screen.queryByText(/Each row below/i)).toBeNull();
  });

  it("falls back to the raw date string when it cannot be parsed", () => {
    render(<InfostealerPanel subject="phone number" source={data({ ok: true, data: { total: 1, stealers: [stealer({
      malwareFamily: "x", dateCompromised: "not-a-date",
    })] } })} />);
    expect(screen.getByText("not-a-date")).toBeTruthy();
  });
});
