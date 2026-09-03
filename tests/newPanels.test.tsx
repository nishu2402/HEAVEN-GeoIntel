// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import LeakCheckPanel from "@/components/breach/LeakCheckPanel";
import AutoPivots from "@/components/shared/AutoPivots";
import CaseChanges from "@/components/cases/CaseChanges";
import type { CaseSnapshot, LeakCheckData, SourceResult } from "@/lib/types";
import type { PivotSuggestion } from "@/lib/analysis/autoPivot";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// ── LeakCheckPanel ───────────────────────────────────────────────────────────

const lc = (data: Partial<LeakCheckData>): SourceResult<LeakCheckData> =>
  ({ ok: true, data: { found: 0, fields: [], sources: [], ...data } });

describe("<LeakCheckPanel>", () => {
  it("renders a hit with the record count, named breaches and field types", () => {
    render(<LeakCheckPanel subject="email address" source={lc({
      found: 1345,
      fields: ["password", "first_name", "ssn"],
      sources: [{ name: "Trello.com", date: "2024-01" }, { name: "Vivagames.com", date: null }],
    })} />);
    expect(screen.getByText("1,345 RECORDS")).toBeTruthy();
    expect(screen.getByText("Trello.com")).toBeTruthy();
    expect(screen.getByText("· 2024-01")).toBeTruthy();
    expect(screen.getByText("Vivagames.com")).toBeTruthy();
    expect(screen.getByText("first name")).toBeTruthy();   // underscore prettified
    expect(screen.getByText(/2 high-sensitivity field types were exposed/)).toBeTruthy();
  });

  it("uses singular wording for one record and one risky field", () => {
    render(<LeakCheckPanel subject="username" source={lc({ found: 1, fields: ["password"], sources: [{ name: "X", date: null }] })} />);
    expect(screen.getByText("1 RECORD")).toBeTruthy();
    expect(screen.getByText(/1 high-sensitivity field type was exposed/)).toBeTruthy();
  });

  it("renders NOT INDEXED for a clean answer: never as an error", () => {
    render(<LeakCheckPanel subject="phone number" source={lc({ found: 0 })} />);
    expect(screen.getByText("NOT INDEXED")).toBeTruthy();
    expect(screen.getByText(/no breach records for this phone number/)).toBeTruthy();
  });

  it("omits the breach and field sections when a hit carries neither", () => {
    render(<LeakCheckPanel subject="email address" source={lc({ found: 3 })} />);
    expect(screen.queryByText(/Named breaches/)).toBeNull();
    expect(screen.queryByText(/Exposed field types/)).toBeNull();
  });

  it("does not present a rate-limit as a clean result", () => {
    render(<LeakCheckPanel subject="email address" source={{ ok: false, error: "RATE_LIMITED" }} />);
    expect(screen.getByText(/This is not a clean result/)).toBeTruthy();
    expect(screen.queryByText("NOT INDEXED")).toBeNull();
  });

  it("shows a generic failure, with an 'unknown' fallback", () => {
    const { unmount } = render(<LeakCheckPanel subject="email address" source={{ ok: false, error: "HTTP 503" }} />);
    expect(screen.getByText(/check failed: HTTP 503/)).toBeTruthy();
    unmount();
    render(<LeakCheckPanel subject="email address" source={{ ok: false } as SourceResult<LeakCheckData>} />);
    expect(screen.getByText(/check failed: unknown/)).toBeTruthy();
  });
});

// ── AutoPivots ───────────────────────────────────────────────────────────────

const pv = (over: Partial<PivotSuggestion> = {}): PivotSuggestion =>
  ({ kind: "domain", value: "example.com", reason: "Email domain", strength: "related", ...over });

describe("<AutoPivots>", () => {
  it("renders nothing at all when there is nothing to pivot to", () => {
    const { container } = render(<AutoPivots pivots={[]} onRun={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("separates confirmed links from related ones", () => {
    render(<AutoPivots
      pivots={[pv({ strength: "confirmed", kind: "username", value: "ada", reason: "Gravatar: profile handle" }), pv()]}
      onRun={() => {}}
    />);
    expect(screen.getByText("Confirmed links (1)")).toBeTruthy();
    expect(screen.getByText("Related (1)")).toBeTruthy();
    expect(screen.getByText(/2 identifiers this result handed us/)).toBeTruthy();
  });

  it("hides a group that has no members", () => {
    render(<AutoPivots pivots={[pv()]} onRun={() => {}} />);
    expect(screen.queryByText(/Confirmed links/)).toBeNull();
    expect(screen.getByText("Related (1)")).toBeTruthy();
    expect(screen.getByText(/1 identifier this result handed us/)).toBeTruthy();
  });

  it("runs the right mode and value when a chip is clicked", () => {
    const onRun = vi.fn();
    render(<AutoPivots pivots={[pv({ kind: "ip", value: "8.8.8.8", reason: "DNS: A/AAAA record" })]} onRun={onRun} />);
    fireEvent.click(screen.getByRole("button", { name: /Run IP lookup on 8\.8\.8\.8/ }));
    expect(onRun).toHaveBeenCalledWith("ip", "8.8.8.8");
  });

  it("labels every kind for screen readers", () => {
    render(<AutoPivots
      pivots={(["phone", "email", "username", "ip", "domain"] as const).map((kind, i) =>
        pv({ kind, value: `v${i}`, reason: "r" }))}
      onRun={() => {}}
    />);
    for (const label of ["Phone", "Email", "Username", "IP", "Domain"]) {
      expect(screen.getByRole("button", { name: new RegExp(`Run ${label} lookup`) })).toBeTruthy();
    }
  });

  it("states that nothing shown was guessed", () => {
    render(<AutoPivots pivots={[pv()]} onRun={() => {}} />);
    expect(screen.getByText(/Nothing here is guessed or/)).toBeTruthy();
  });
});

// ── CaseChanges ──────────────────────────────────────────────────────────────

const sn = (over: Partial<CaseSnapshot> = {}): CaseSnapshot =>
  ({ kind: "domain", value: "example.com", takenAt: 1_700_000_000_000, facts: {}, ...over });

describe("<CaseChanges>", () => {
  it("explains the loop when there are no snapshots yet", () => {
    render(<CaseChanges snapshots={[]} />);
    expect(screen.getByText(/CHANGE HISTORY: 0 snapshots/)).toBeTruthy();
    expect(screen.getByText(/Pin a lookup to this case/)).toBeTruthy();
  });

  it("calls a lone snapshot a baseline rather than 'no change'", () => {
    render(<CaseChanges snapshots={[sn({ facts: { subdomains: 3 } })]} />);
    expect(screen.getByText(/CHANGE HISTORY: 1 snapshot$/)).toBeTruthy();
    expect(screen.getByText(/Baseline recorded/)).toBeTruthy();
  });

  it("lists what moved, newest first", () => {
    render(<CaseChanges snapshots={[
      sn({ takenAt: 1_700_000_000_000, facts: { subdomains: 3, spf: "present" } }),
      sn({ takenAt: 1_700_000_100_000, facts: { subdomains: 7, spf: "present" } }),
      sn({ takenAt: 1_700_000_200_000, facts: { subdomains: 9, spf: "present" } }),
    ]} />);
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("9")).toBeTruthy();
    // spf never changed, so it is not a row
    expect(screen.queryByText("spf")).toBeNull();
    const facts = screen.getAllByText("subdomains");
    expect(facts).toHaveLength(2);
  });

  it("says so when several snapshots produced no change", () => {
    render(<CaseChanges snapshots={[
      sn({ takenAt: 1, facts: { n: 1 } }),
      sn({ takenAt: 2, facts: { n: 1 } }),
    ]} />);
    expect(screen.getByText(/Nothing changed across 2 snapshots/)).toBeTruthy();
  });

  it("renders an em-dash for a fact that appeared or disappeared", () => {
    render(<CaseChanges snapshots={[
      sn({ takenAt: 1, facts: { gone: "x" } }),
      sn({ takenAt: 2, facts: { added: "y" } }),
    ]} />);
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("groups by identifier and colours each kind", () => {
    const { container } = render(<CaseChanges snapshots={[
      sn({ kind: "domain", value: "a.com", takenAt: 1 }),
      sn({ kind: "ip", value: "8.8.8.8", takenAt: 2 }),
    ]} />);
    expect(screen.getByText("a.com")).toBeTruthy();
    expect(screen.getByText("8.8.8.8")).toBeTruthy();
    // jsdom normalises the hex to rgb() — assert on the resolved value.
    expect(container.innerHTML).toContain("rgb(251, 146, 60)"); // ip colour
  });
});
