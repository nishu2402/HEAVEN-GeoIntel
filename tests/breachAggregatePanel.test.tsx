// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import BreachAggregatePanel from "@/components/breach/BreachAggregatePanel";
import type { BreachAggregate, AggregatedBreach } from "@/lib/analysis/breachAggregate";

afterEach(cleanup);

const breach = (o: Partial<AggregatedBreach> = {}): AggregatedBreach => ({
  name: "LinkedIn", key: "linkedin", domain: "linkedin.com", date: "2013-10-04",
  dataClasses: ["Passwords", "Email addresses"], records: 164_000_000,
  password: true, verified: true, reportedBy: ["LeakCheck", "XposedOrNot"],
  enriched: false, ...o,
});

const agg = (o: Partial<BreachAggregate> = {}): BreachAggregate => ({
  breaches: [breach()], total: 1, sourcesReporting: ["LeakCheck", "XposedOrNot"],
  sourcesAnswered: ["LeakCheck", "XposedOrNot"], withPassword: 1, verified: 1,
  dataClasses: ["Passwords", "Email addresses"], firstBreach: "2013-10-04",
  lastBreach: "2013-10-04", timeline: [{ year: "2013", count: 1 }], enrichedCount: 0,
  passwordFieldsSeen: true, ...o,
});

describe("<BreachAggregatePanel>", () => {
  it("shows the union count, the sources, and the merged breach row", () => {
    render(<BreachAggregatePanel aggregate={agg()} subject="email address" />);
    expect(screen.getByText(/1 BREACH/)).toBeTruthy();
    expect(screen.getByText(/across 2 sources: LeakCheck, XposedOrNot/)).toBeTruthy();
    expect(screen.getByText("passwords in 1")).toBeTruthy();
    expect(screen.getByText("1 verified")).toBeTruthy();
    expect(screen.getByText("2013-10-04 → 2013-10-04")).toBeTruthy();
    expect(screen.getByText("LinkedIn")).toBeTruthy();
    // provider attribution chips on the row
    expect(screen.getAllByText("XposedOrNot").length).toBeGreaterThan(0);
    expect(screen.getByText(/164,000,000 records/)).toBeTruthy();
  });

  it("pluralizes correctly and notes password fields when no breach is pinned", () => {
    render(
      <BreachAggregatePanel
        aggregate={agg({
          total: 2, sourcesReporting: ["LeakCheck"],
          breaches: [breach({ password: false }), breach({ name: "Adobe", key: "adobe", password: false, verified: false, records: 0, date: null, dataClasses: [] })],
          withPassword: 0, verified: 0, passwordFieldsSeen: true,
          firstBreach: null, lastBreach: null,
        })}
        subject="username"
      />,
    );
    expect(screen.getByText(/2 BREACHES/)).toBeTruthy();
    expect(screen.getByText(/across 1 source:/)).toBeTruthy();
    expect(screen.getByText("password fields seen in this set")).toBeTruthy();
    // Adobe row: no date, no records, no data classes
    expect(screen.getByText("Adobe")).toBeTruthy();
  });

  it("collapses a long list behind a show-more control", () => {
    const many = Array.from({ length: 42 }, (_, i) =>
      breach({ name: `Breach${i}`, key: `b${i}` }));
    render(
      <BreachAggregatePanel
        aggregate={agg({ breaches: many, total: 42 })}
        subject="email address"
      />,
    );
    expect(screen.queryByText("Breach41")).toBeNull(); // beyond the initial 30
    fireEvent.click(screen.getByText(/Show 12 more breaches/));
    expect(screen.getByText("Breach41")).toBeTruthy();
  });


  it("uses the singular when exactly one breach is hidden", () => {
    const many = Array.from({ length: 31 }, (_, i) => breach({ name: `B${i}`, key: `b${i}` }));
    render(
      <BreachAggregatePanel aggregate={agg({ breaches: many, total: 31 })} subject="email address" />,
    );
    expect(screen.getByText("Show 1 more breach")).toBeTruthy();
  });

  it("reads clean when a source answered with nothing", () => {
    render(
      <BreachAggregatePanel
        aggregate={agg({ breaches: [], total: 0, sourcesReporting: [], sourcesAnswered: ["XposedOrNot"], withPassword: 0, verified: 0, dataClasses: [], firstBreach: null, lastBreach: null, passwordFieldsSeen: false })}
        subject="email address"
      />,
    );
    expect(screen.getByText(/No breach records matched/)).toBeTruthy();
    expect(screen.getByText(/1 index answering clean/)).toBeTruthy();
  });

  it("pluralizes the clean note for several answering sources", () => {
    render(
      <BreachAggregatePanel
        aggregate={agg({ breaches: [], total: 0, sourcesReporting: [], sourcesAnswered: ["LeakCheck", "XposedOrNot"], dataClasses: [], firstBreach: null, lastBreach: null, passwordFieldsSeen: false, withPassword: 0, verified: 0 })}
        subject="phone number"
      />,
    );
    expect(screen.getByText(/2 indexes answering clean/)).toBeTruthy();
  });

  it("says so plainly when no source answered at all", () => {
    render(
      <BreachAggregatePanel
        aggregate={agg({ breaches: [], total: 0, sourcesReporting: [], sourcesAnswered: [], dataClasses: [], firstBreach: null, lastBreach: null, passwordFieldsSeen: false, withPassword: 0, verified: 0 })}
        subject="email address"
      />,
    );
    expect(screen.getByText(/No breach source answered/)).toBeTruthy();
  });

  it("draws the year timeline and notes catalog-enriched rows", () => {
    render(
      <BreachAggregatePanel
        aggregate={agg({
          total: 3,
          breaches: [
            breach({ name: "New", key: "new", date: "2019-01-01", enriched: true }),
            breach({ name: "Mid", key: "mid", date: "2013-06-01" }),
            breach({ name: "Old", key: "old", date: "2013-01-01" }),
          ],
          timeline: [{ year: "2013", count: 2 }, { year: "2019", count: 1 }],
          firstBreach: "2013-01-01", lastBreach: "2019-01-01",
          enrichedCount: 1,
        })}
        subject="email address"
      />,
    );
    // Timeline header + year labels
    expect(screen.getByText(/Breach timeline \(2013-01-01 → 2019-01-01\)/)).toBeTruthy();
    expect(screen.getByText("2013")).toBeTruthy();
    expect(screen.getByText("2019")).toBeTruthy();
    // The enriched row carries the catalog chip, and the footer counts it (singular)
    expect(screen.getByText("catalog")).toBeTruthy();
    expect(screen.getByText(/1 row was described from the offline breach catalog/)).toBeTruthy();
  });

  it("pluralizes the catalog-enrichment note", () => {
    render(
      <BreachAggregatePanel
        aggregate={agg({ enrichedCount: 4, breaches: [breach({ enriched: true })] })}
        subject="email address"
      />,
    );
    expect(screen.getByText(/4 rows were described from the offline breach catalog/)).toBeTruthy();
    expect(screen.getAllByText("catalog").length).toBeGreaterThan(0);
  });

  it("states the keyless union is a floor and points to paid indexes", () => {
    render(<BreachAggregatePanel aggregate={agg()} subject="email address" />);
    expect(screen.getByText(/union of the free, keyless indexes, so it is a floor/)).toBeTruthy();
    expect(screen.getByText(/Use the OSINT matrix below/)).toBeTruthy();
  });
});
