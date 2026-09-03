import { describe, it, expect } from "vitest";
import {
  assessReuse, assessCredentialExposure, stealerCredentialSummary,
} from "@/lib/analysis/credentialExposure";
import type { CombExposure, HudsonRockData, HudsonRockStealer } from "@/lib/types";

const comb = (o: Partial<CombExposure> = {}): CombExposure => ({
  pairs: 0, distinctPasswords: 0, capped: false, samples: [], ...o,
});

const stealer = (o: Partial<HudsonRockStealer> = {}): HudsonRockStealer => ({
  computerName: null, operatingSystem: null, malwareFamily: null,
  dateCompromised: null, ip: null, topPasswords: [], topLogins: [], ...o,
});
const hr = (stealers: HudsonRockStealer[]): HudsonRockData => ({ total: stealers.length, stealers });

describe("assessReuse", () => {
  it("is 'none' when there is no password evidence at all", () => {
    expect(assessReuse(0, 0)).toBe("none");
  });
  it("is 'likely' when few distinct passwords span more password-breaches", () => {
    expect(assessReuse(1, 5)).toBe("likely");
  });
  it("is only 'exposed' when the breach count does not exceed the distinct set", () => {
    expect(assessReuse(3, 3)).toBe("exposed");
  });
  it("never claims reuse without at least one visible password", () => {
    expect(assessReuse(0, 4)).toBe("exposed");
  });
  it("needs at least two breaches before calling it reuse", () => {
    expect(assessReuse(1, 1)).toBe("exposed");
  });
});

describe("stealerCredentialSummary", () => {
  it("is empty for a missing or infection-free result", () => {
    expect(stealerCredentialSummary(null)).toEqual({ logs: 0, distinctPasswords: 0 });
    expect(stealerCredentialSummary(undefined)).toEqual({ logs: 0, distinctPasswords: 0 });
    expect(stealerCredentialSummary(hr([]))).toEqual({ logs: 0, distinctPasswords: 0 });
  });

  it("counts logs that captured a password and the distinct set across them", () => {
    const s = stealerCredentialSummary(hr([
      stealer({ topPasswords: ["I********6", "a***b"] }),
      stealer({ topPasswords: ["a***b"] }),          // duplicate masked password
    ]));
    expect(s).toEqual({ logs: 2, distinctPasswords: 2 });
  });

  it("ignores blank passwords and a log that captured none", () => {
    const s = stealerCredentialSummary(hr([
      stealer({ topPasswords: ["", "  "] }),         // all blank → not a credential log
      stealer({ topPasswords: ["p***q"] }),
    ]));
    expect(s).toEqual({ logs: 1, distinctPasswords: 1 });
  });
});

describe("assessCredentialExposure", () => {
  it("treats a missing COMB result as no visible passwords", () => {
    const e = assessCredentialExposure(null, 2);
    expect(e.distinctPasswords).toBe(0);
    expect(e.pairs).toBe(0);
    expect(e.passwordBreaches).toBe(2);
    expect(e.stealerLogs).toBe(0);
    expect(e.stealerPasswords).toBe(0);
    expect(e.exposed).toBe(true);   // password-exposing breaches alone count
    expect(e.reuse).toBe("exposed");
  });

  it("fuses COMB samples with the breach count into a reuse verdict", () => {
    const e = assessCredentialExposure(
      comb({ pairs: 4, distinctPasswords: 1, capped: true, samples: ["h*****2"] }),
      6,
    );
    expect(e).toEqual({
      distinctPasswords: 1, pairs: 4, capped: true, samples: ["h*****2"],
      passwordBreaches: 6, stealerLogs: 0, stealerPasswords: 0,
      exposed: true, reuse: "likely",
    });
  });

  it("is exposed on infostealer captures alone, without COMB or a breach", () => {
    const e = assessCredentialExposure(null, 0, { logs: 2, distinctPasswords: 1 });
    expect(e.exposed).toBe(true);
    expect(e.stealerLogs).toBe(2);
    expect(e.stealerPasswords).toBe(1);
    // Masked stealer passwords never drive the strong reuse verdict on their own.
    expect(e.reuse).toBe("none");
  });

  it("is not exposed when no source has anything", () => {
    const e = assessCredentialExposure(comb(), 0);
    expect(e.exposed).toBe(false);
    expect(e.reuse).toBe("none");
    expect(e.stealerLogs).toBe(0);
  });
});
