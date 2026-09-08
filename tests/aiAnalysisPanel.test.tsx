// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import AiAnalysisPanel from "@/components/shared/AiAnalysisPanel";
import type { EmailLookupResponse, HashLookupResponse } from "@/lib/types";

afterEach(() => cleanup());

// The panel is a thin, deterministic view over analyzeLookup(): a clean subject
// shows the reassuring state and no anomalies; a badly exposed one shows scored
// factors and flagged patterns. Both branches, plus the always-on narrative.

const cleanHash = { input: "deadbeef", facts: { known: true, trust: 90, source: "NSRL", productName: "Windows" } } as unknown as HashLookupResponse;

const exposedEmail = {
  email: "victim@example.com",
  analysis: { domain: "example.com", providerName: "Example", isDisposable: false, isRoleAddress: false },
  emailrep: { ok: false },
  breachAggregate: {
    breaches: [], total: 5, sourcesReporting: ["XposedOrNot", "LeakCheck"], sourcesAnswered: ["XposedOrNot"],
    withPassword: 3, verified: 1, dataClasses: [], firstBreach: null, lastBreach: null, timeline: [], enrichedCount: 0, passwordFieldsSeen: true,
  },
  credentialExposure: { distinctPasswords: 4, pairs: 9, capped: false, samples: [], passwordBreaches: 3, stealerLogs: 2, stealerPasswords: 5, exposed: true, reuse: "likely" },
} as unknown as EmailLookupResponse;

describe("<AiAnalysisPanel>", () => {
  it("shows the reassuring state for a clean subject (no factors, no anomalies)", () => {
    render(<AiAnalysisPanel input={{ kind: "hash", data: cleanHash }} />);
    expect(screen.getByText(/AI Analysis/i)).toBeTruthy();
    // appears both as the structured reassurance line and in the rationale prose
    expect(screen.getAllByText(/No positive-risk signals/i).length).toBeGreaterThan(0);
    // no "Flagged patterns" section for a clean subject
    expect(screen.queryByText(/Flagged patterns/i)).toBeNull();
    // the always-on narrative is present
    expect(screen.getByText(/Narrative/i)).toBeTruthy();
  });

  it("renders scored factors and flagged patterns for an exposed subject", () => {
    render(<AiAnalysisPanel input={{ kind: "email", data: exposedEmail }} />);
    expect(screen.getByText(/Contributing factors/i)).toBeTruthy();
    expect(screen.getByText(/Flagged patterns/i)).toBeTruthy();
    // a factor label and a flagged-pattern title both surface (structured + narrative)
    expect(screen.getAllByText(/Plaintext credentials leaked/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/malware-captured/i).length).toBeGreaterThan(0);
    // the score renders with its /100 unit
    expect(screen.getByText("/100")).toBeTruthy();
  });
});
