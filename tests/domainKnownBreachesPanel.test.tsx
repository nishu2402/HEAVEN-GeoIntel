// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import DomainKnownBreachesPanel from "@/components/network/DomainKnownBreachesPanel";
import type { DomainBreach } from "@/lib/types";

afterEach(cleanup);

const b = (o: Partial<DomainBreach> = {}): DomainBreach => ({
  name: "Adobe", domain: "adobe.com", date: "2013-10-04",
  records: 152_000_000, dataClasses: ["Passwords", "Email addresses"], verified: true, ...o,
});

describe("<DomainKnownBreachesPanel>", () => {
  it("renders nothing when the catalog has no breach for the domain", () => {
    const { container } = render(<DomainKnownBreachesPanel breaches={[]} domain="clean.example" />);
    expect(container.firstChild).toBeNull();
  });

  it("lists a single breach with records, date, verified badge and classes", () => {
    render(<DomainKnownBreachesPanel breaches={[b()]} domain="adobe.com" />);
    expect(screen.getByText(/1 breach in the public catalog is recorded against adobe.com/)).toBeTruthy();
    expect(screen.getByText("Adobe")).toBeTruthy();
    expect(screen.getByText("2013-10-04")).toBeTruthy();
    expect(screen.getByText("VERIFIED")).toBeTruthy();
    expect(screen.getByText(/152,000,000 records/)).toBeTruthy();
    expect(screen.getByText("Passwords")).toBeTruthy();
  });

  it("pluralizes and tolerates a bare breach with no date, records or classes", () => {
    render(
      <DomainKnownBreachesPanel
        breaches={[
          b({ name: "Rich" }),
          b({ name: "Bare", date: null, records: 0, verified: false, dataClasses: [] }),
        ]}
        domain="example.com"
      />,
    );
    expect(screen.getByText(/2 breaches in the public catalog are recorded against example.com/)).toBeTruthy();
    expect(screen.getByText("Bare")).toBeTruthy();
    // The bare breach shows no VERIFIED badge and no records line of its own.
    expect(screen.getAllByText("VERIFIED")).toHaveLength(1); // only the "Rich" one
  });
});
