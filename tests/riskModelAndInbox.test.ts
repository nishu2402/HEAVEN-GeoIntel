import { describe, it, expect } from "vitest";
import {
  assessExposure, assessPhoneAbuse, assessEmailAbuse, exposureLabelFor, abuseLabelFor,
} from "@/lib/analysis/riskModel";
import { buildInbox, describeChange } from "@/lib/analysis/changeInbox";
import type { InvestigationCase } from "@/lib/types";

// ── riskModel ────────────────────────────────────────────────────────────────
// One number could not answer two questions. The White House switchboard scored
// 20 / MODERATE purely because a breach index held eleven records mentioning
// it, which is exposure, not danger.

describe("assessExposure", () => {
  it("reports nothing observed when no source found anything", () => {
    expect(assessExposure({})).toEqual({ score: 0, label: "NONE OBSERVED", reasons: [] });
    expect(assessExposure({ breachRecords: 0, stealerInfections: 0 }).score).toBe(0);
  });

  it("ranks an infostealer capture above a decade-old forum dump", () => {
    const stealer = assessExposure({ stealerInfections: 1 });
    const dump = assessExposure({ breachRecords: 3 });
    expect(stealer.score).toBeGreaterThan(dump.score);
    expect(stealer.reasons[0]).toBe("captured by 1 infostealer infection");
    expect(dump.reasons[0]).toBe("3 indexed breach records");
  });

  it("counts credential records, named breaches and a reputation claim", () => {
    const r = assessExposure({
      credentialRecords: 2, namedBreaches: 1, credentialsLeaked: true, breachRecords: 1,
    });
    expect(r.reasons).toEqual([
      "2 credential records recovered",
      "a reputation source reports leaked credentials",
      "named in 1 breach",
      "1 indexed breach record",
    ]);
    expect(r.label).toBe("EXTENSIVE");
  });

  it("singularises every count it prints", () => {
    const r = assessExposure({ stealerInfections: 1, credentialRecords: 1, namedBreaches: 1, breachRecords: 1 });
    expect(r.reasons.join(" ")).not.toMatch(/1 (infostealer infections|credential records|breaches|indexed breach records)/);
  });

  it("never exceeds 100 and bands the score", () => {
    expect(assessExposure({ stealerInfections: 99, credentialRecords: 99, namedBreaches: 99, breachRecords: 99 }).score).toBe(100);
    expect(exposureLabelFor(0)).toBe("NONE OBSERVED");
    expect(exposureLabelFor(10)).toBe("LIMITED");
    expect(exposureLabelFor(30)).toBe("SIGNIFICANT");
    expect(exposureLabelFor(80)).toBe("EXTENSIVE");
  });
});

describe("assessPhoneAbuse", () => {
  it("is clean with nothing adverse, whatever the breach picture", () => {
    expect(assessPhoneAbuse({}).label).toBe("CLEAN");
    expect(assessPhoneAbuse({ fraudScore: null, isRisky: null }).score).toBe(0);
  });

  it("weights each provider signal the way the old combined score did", () => {
    expect(assessPhoneAbuse({ fraudScore: 50 }).score).toBe(30);
    expect(assessPhoneAbuse({ isPremiumRate: true }).score).toBe(60);
    expect(assessPhoneAbuse({ isRisky: true }).score).toBe(55);
    expect(assessPhoneAbuse({ recentAbuse: true }).score).toBe(50);
    expect(assessPhoneAbuse({ active: false }).score).toBe(30);
    expect(assessPhoneAbuse({ isVoip: true }).score).toBe(25);
    expect(assessPhoneAbuse({ active: false, prepaid: true }).score).toBe(35);
  });

  it("ignores a fraud score that is not a usable number", () => {
    for (const fraudScore of [NaN, Infinity, 0, null, undefined]) {
      expect(assessPhoneAbuse({ fraudScore }).score, String(fraudScore)).toBe(0);
    }
  });

  it("bands the score the way the UI colours it", () => {
    expect(abuseLabelFor(0)).toBe("CLEAN");
    expect(abuseLabelFor(5)).toBe("LOW RISK");
    expect(abuseLabelFor(20)).toBe("MODERATE");
    expect(abuseLabelFor(40)).toBe("HIGH RISK");
    expect(abuseLabelFor(70)).toBe("CRITICAL");
  });
});

describe("assessEmailAbuse", () => {
  it("scores reputation signals and nothing else", () => {
    expect(assessEmailAbuse({ blacklisted: true }).score).toBe(60);
    expect(assessEmailAbuse({ maliciousActivity: true }).score).toBe(50);
    expect(assessEmailAbuse({ suspicious: true }).score).toBe(40);
    expect(assessEmailAbuse({ isDisposable: true }).score).toBe(20);
    expect(assessEmailAbuse({ spam: true }).score).toBe(5);
    expect(assessEmailAbuse({ reputation: "LOW" }).score).toBe(30);
    expect(assessEmailAbuse({ reputation: "high" }).score).toBe(0);
    expect(assessEmailAbuse({}).label).toBe("CLEAN");
  });
});

// ── changeInbox ──────────────────────────────────────────────────────────────

const caseOf = (over: Partial<InvestigationCase> = {}): InvestigationCase => ({
  id: "c1", name: "Case One", createdAt: 1, updatedAt: 2, entities: [], ...over,
});

describe("buildInbox", () => {
  it("reports nothing but counts a baseline when there is only one snapshot", () => {
    const inbox = buildInbox([caseOf({
      snapshots: [{ kind: "domain", value: "a.test", takenAt: 10, facts: { subdomains: 3 } }],
    })]);
    expect(inbox.changes).toEqual([]);
    expect(inbox.baselines).toBe(1);
    expect(inbox.unread).toBe(0);
  });

  it("reports every fact that moved, newest first", () => {
    const inbox = buildInbox([caseOf({
      snapshots: [
        { kind: "domain", value: "a.test", takenAt: 10, facts: { subdomains: 3, spf: "present" } },
        { kind: "domain", value: "a.test", takenAt: 20, facts: { subdomains: 9, spf: "present" } },
        { kind: "ip", value: "1.1.1.1", takenAt: 30, facts: { openPorts: 1 } },
        { kind: "ip", value: "1.1.1.1", takenAt: 40, facts: { openPorts: 4 }, fromCache: true },
      ],
    })]);
    expect(inbox.changes.map((c) => [c.fact, c.from, c.to])).toEqual([
      ["openPorts", 1, 4],
      ["subdomains", 3, 9],
    ]);
    expect(inbox.changes[0].cacheInvolved).toBe(true);
    expect(inbox.unread).toBe(2);
    expect(inbox.baselines).toBe(0);
  });

  it("marks anything older than the review mark as read", () => {
    const inbox = buildInbox([caseOf({
      reviewedAt: 25,
      snapshots: [
        { kind: "domain", value: "a.test", takenAt: 10, facts: { n: 1 } },
        { kind: "domain", value: "a.test", takenAt: 20, facts: { n: 2 } },
        { kind: "domain", value: "a.test", takenAt: 30, facts: { n: 3 } },
      ],
    })]);
    expect(inbox.changes.map((c) => c.unread)).toEqual([true, false]);
    expect(inbox.unread).toBe(1);
  });

  it("keeps identifiers apart, case-insensitively", () => {
    const inbox = buildInbox([caseOf({
      snapshots: [
        { kind: "domain", value: "A.test", takenAt: 10, facts: { n: 1 } },
        { kind: "domain", value: "a.test", takenAt: 20, facts: { n: 5 } },
        { kind: "email", value: "a@test", takenAt: 30, facts: { n: 1 } },
      ],
    })]);
    expect(inbox.changes).toHaveLength(1);
    expect(inbox.baselines).toBe(1);   // the email has nothing to compare
  });

  it("handles a case with no snapshots at all", () => {
    expect(buildInbox([caseOf()])).toEqual({ changes: [], unread: 0, baselines: 0 });
  });

  it("describes a change in one line, naming what was not reported", () => {
    const [change] = buildInbox([caseOf({
      snapshots: [
        { kind: "domain", value: "a.test", takenAt: 10, facts: {} },
        { kind: "domain", value: "a.test", takenAt: 20, facts: { dmarcPolicy: "reject" } },
      ],
    })]).changes;
    expect(describeChange(change)).toBe("Case One: domain a.test, dmarcPolicy not reported → reject");
  });
});
