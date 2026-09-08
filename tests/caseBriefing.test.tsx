// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import CaseBriefing from "@/components/cases/CaseBriefing";
import type { InvestigationCase } from "@/lib/types";

afterEach(() => cleanup());

const caseOf = (over: Partial<InvestigationCase>): InvestigationCase => ({
  id: "c1", name: "Case", createdAt: 0, updatedAt: 0, entities: [], ...over,
});

describe("<CaseBriefing>", () => {
  it("renders count chips and grounded lines for a populated case", () => {
    render(<CaseBriefing caseData={caseOf({
      entities: [
        { kind: "email", value: "a@b.com", addedAt: 0 },
        { kind: "domain", value: "b.com", addedAt: 0 },
      ],
      notes: "credential dump for victim@example.com",
    })} />);
    expect(screen.getByText(/AI Case Briefing/i)).toBeTruthy();
    expect(screen.getByText(/email ×1/i)).toBeTruthy();
    expect(screen.getByText(/This case holds 2 identifiers/i)).toBeTruthy();
  });

  it("renders no count chips for an empty case", () => {
    render(<CaseBriefing caseData={caseOf({})} />);
    expect(screen.getByText(/no identifiers pinned yet/i)).toBeTruthy();
    expect(screen.queryByText(/×/)).toBeNull();
  });
});
