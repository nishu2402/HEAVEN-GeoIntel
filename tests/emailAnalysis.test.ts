import { describe, it, expect } from "vitest";
import { analyzeEmail } from "@/lib/analysis/emailAnalysis";

// Locks the email classifier — the code that decides the DISPOSABLE / PRIVACY /
// WEBMAIL / GOV / EDU / CORPORATE badge and feeds the email threat score. The
// project's core rule is "no false positives", so the name-guesser in particular
// must stay conservative (only an explicit first.last pattern yields a name).

describe("analyzeEmail — field extraction", () => {
  it("splits username/domain/tld and normalises case + whitespace", () => {
    const a = analyzeEmail("  John.Doe@Example.COM  ");
    expect(a.email).toBe("john.doe@example.com");
    expect(a.username).toBe("john.doe");
    expect(a.domain).toBe("example.com");
    expect(a.tld).toBe("com");
    expect(a.isValidFormat).toBe(true);
  });
});

describe("analyzeEmail — provider classification", () => {
  it("flags disposable domains", () => {
    for (const d of ["mailinator.com", "guerrillamail.com", "10minutemail.com"]) {
      const a = analyzeEmail(`x@${d}`);
      expect(a.providerType, d).toBe("disposable");
      expect(a.isDisposable, d).toBe(true);
    }
  });

  it("flags privacy-focused providers", () => {
    for (const d of ["proton.me", "protonmail.com", "tutanota.com"]) {
      const a = analyzeEmail(`x@${d}`);
      expect(a.providerType, d).toBe("privacy");
      expect(a.isPrivacyFocused, d).toBe(true);
    }
  });

  it("flags free webmail", () => {
    for (const d of ["gmail.com", "yahoo.com", "outlook.com"]) {
      const a = analyzeEmail(`x@${d}`);
      expect(a.providerType, d).toBe("free");
      expect(a.isWebmail, d).toBe(true);
    }
  });

  it("classifies government and educational by TLD", () => {
    const gov = analyzeEmail("agent@fbi.gov");
    expect(gov.providerType).toBe("government");
    expect(gov.providerName).toBe("Government");

    expect(analyzeEmail("x@police.gov.uk").providerType).toBe("government");

    const edu = analyzeEmail("student@mit.edu");
    expect(edu.providerType).toBe("educational");
    expect(edu.providerName).toBe("Educational Institution");

    expect(analyzeEmail("x@ox.ac.uk").providerType).toBe("educational");
  });

  it("treats an unknown non-webmail domain as corporate", () => {
    const a = analyzeEmail("ceo@acmecorp.io");
    expect(a.providerType).toBe("corporate");
    expect(a.providerName).toContain("(Corporate)");
    expect(a.isDisposable).toBe(false);
    expect(a.isWebmail).toBe(false);
  });

  it("marks malformed input unknown (never throws)", () => {
    for (const bad of ["notanemail", "no@domain", "@nope.com", "", "a@b"]) {
      const a = analyzeEmail(bad);
      expect(a.isValidFormat, bad).toBe(false);
      expect(a.providerType, bad).toBe("unknown");
    }
  });
});

describe("analyzeEmail — role addresses & name guessing (no false positives)", () => {
  it("detects role addresses and never guesses a name for them", () => {
    for (const p of ["support", "admin", "info", "noreply"]) {
      const a = analyzeEmail(`${p}@example.io`);
      expect(a.isRoleAddress, p).toBe(true);
      expect(a.guessedName, p).toBeNull();
    }
  });

  it("infers a name ONLY from an explicit first.last pattern", () => {
    expect(analyzeEmail("john.doe@example.io").guessedName).toBe("John Doe");
    expect(analyzeEmail("jane_smith@example.io").guessedName).toBe("Jane Smith");
    expect(analyzeEmail("john.doe2@example.io").guessedName).toBe("John Doe"); // trailing digits stripped
  });

  it("refuses to guess from a single word or ambiguous handle", () => {
    for (const u of ["dragonslayer", "newsletter", "qwerty", "j.d", "a.b.c"]) {
      expect(analyzeEmail(`${u}@example.io`).guessedName, u).toBeNull();
    }
  });
});
