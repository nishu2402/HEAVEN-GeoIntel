import { describe, it, expect } from "vitest";
import {
  detectHash,
  CRACK_DIFFICULTY_LABEL,
  CRACK_DIFFICULTY_COLOR,
} from "@/lib/analysis/hashDetect";

// Locks hash-type identification — a wrong algorithm label is a false verdict.
// Includes the regression guard for the MySQL 4.1 bug: a "*"+40-hex string was
// swallowed by the generic partial-plaintext ("*") branch and mislabelled.

describe("detectHash: crypt-scheme prefixes", () => {
  const cases: [string, string][] = [
    ["$2a$12$R9h/cIPz0gi.URNNX3kh2Oea3.abcdefghijklmnopqrstuvwxyzABCD", "bcrypt"],
    ["$2b$10$abcdefghijklmnopqrstuv", "bcrypt"],
    ["$2y$10$abcdefghijklmnopqrstuv", "bcrypt"],
    ["$1$abc$defghijklmnop", "MD5crypt"],
    ["$5$rounds=5000$abc$def", "SHA-256crypt"],
    ["$6$rounds=5000$abc$def", "SHA-512crypt"],
    ["$s1$abc", "scrypt"],
    ["$argon2id$v=19$m=65536,t=3,p=4$abc$def", "Argon2"],
    ["pbkdf2_sha256$260000$abc$def", "PBKDF2"],
  ];
  it.each(cases)("identifies %s as %s", (hash, algo) => {
    expect(detectHash(hash).algorithm).toBe(algo);
  });
});

describe("detectHash: hex by length", () => {
  const byLen: [number, string][] = [
    [32, "MD5 / NTLM"],
    [40, "SHA-1"],
    [56, "SHA-224"],
    [64, "SHA-256"],
    [96, "SHA-384"],
    [128, "SHA-512"],
  ];
  it.each(byLen)("classifies %i hex chars as %s", (len, algo) => {
    expect(detectHash("a".repeat(len)).algorithm).toBe(algo);
  });
});

describe("detectHash: MySQL 4.1 regression (was swallowed by '*' branch)", () => {
  it("identifies '*'+40 uppercase hex as MySQL, NOT Partial Plaintext", () => {
    const info = detectHash("*" + "A".repeat(40));
    expect(info.algorithm).toBe("MySQL 4.1+");
    expect(info.algorithm).not.toBe("Partial Plaintext");
  });

  it("still treats a genuinely masked password as Partial Plaintext", () => {
    expect(detectHash("p****d").algorithm).toBe("Partial Plaintext");
    expect(detectHash("secr*t").algorithm).toBe("Partial Plaintext");
  });
});

describe("detectHash: DES crypt", () => {
  it("identifies exactly 13 chars from the DES alphabet as DES crypt", () => {
    expect("Kk7oULU.Ql3.6").toHaveLength(13);
    expect(detectHash("Kk7oULU.Ql3.6").algorithm).toBe("DES crypt");
    expect(detectHash("Kk7oULU.Ql3.6X").algorithm).not.toBe("DES crypt"); // 14 chars
  });
});

describe("detectHash: non-matches", () => {
  it("returns Unknown for empty/whitespace/garbage", () => {
    for (const s of ["", "   ", "not a hash", "xyz@definitely-not"]) {
      expect(detectHash(s).algorithm, JSON.stringify(s)).toBe("Unknown");
    }
  });
});

describe("crack-difficulty lookup tables", () => {
  it("cover every crackable level for both label and colour maps", () => {
    for (const k of ["trivial", "easy", "hard", "infeasible", "unknown"] as const) {
      expect(CRACK_DIFFICULTY_LABEL[k]).toBeTruthy();
      expect(CRACK_DIFFICULTY_COLOR[k]).toMatch(/^#[0-9a-f]{3,6}$/i);
    }
  });
});
