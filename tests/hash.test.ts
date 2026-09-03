import { describe, it, expect } from "vitest";
import { detectHashKind, buildHashFacts, hashReputation, hashPivots } from "@/lib/analysis/hash";

describe("detectHashKind", () => {
  it("classifies MD5, SHA-1 and SHA-256 by length, case-insensitively", () => {
    expect(detectHashKind("8ed4b4ed952526d89899e723f3488de4")).toBe("md5");
    expect(detectHashKind("8ED4B4ED952526D89899E723F3488DE4")).toBe("md5"); // upper-cased
    expect(detectHashKind("da39a3ee5e6b4b0d3255bfef95601890afd80709")).toBe("sha1");
    expect(detectHashKind("  e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  ")).toBe("sha256"); // trimmed
  });
  it("rejects non-hex, wrong lengths and 0x-prefixed (wallet) input", () => {
    expect(detectHashKind("torvalds")).toBeNull();
    expect(detectHashKind("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")).toBeNull(); // ETH address, not a hash
    expect(detectHashKind("abc123")).toBeNull();                                     // too short
    expect(detectHashKind("z".repeat(32))).toBeNull();                               // right length, not hex
    expect(detectHashKind("a".repeat(50))).toBeNull();                               // hex but no known length
  });
});

describe("buildHashFacts", () => {
  const H = "8ed4b4ed952526d89899e723f3488de4";

  it("reads a full known-software record (FileSize as a string, ProductName nested)", () => {
    const f = buildHashFacts("md5", H, 200, {
      FileName: "kernel32.dll", FileSize: "2520",
      ProductCode: { ProductName: "Windows Server 2016" },
      source: "NSRL", db: "nsrl_modern_rds", "hashlookup:trust": 50,
      MD5: H, "SHA-1": "00000079FD7AAC9B2F9C988C50750E1F50B27EB5", "SHA-256": "abc",
    });
    expect(f).toMatchObject({
      kind: "md5", input: H, known: true, fileName: "kernel32.dll", fileSize: 2520,
      productName: "Windows Server 2016", source: "NSRL", database: "nsrl_modern_rds", trust: 50,
    });
    expect(f?.sha1).toBe("00000079FD7AAC9B2F9C988C50750E1F50B27EB5");
  });

  it("reads a record with a numeric FileSize and no ProductCode", () => {
    const f = buildHashFacts("md5", H, 200, { FileName: "a.bin", FileSize: 4096, source: "NSRL" });
    expect(f?.known).toBe(true);
    expect(f?.fileSize).toBe(4096);   // number branch
    expect(f?.productName).toBeNull(); // ProductCode absent
  });

  it("coerces messy fields to null rather than guessing", () => {
    const f = buildHashFacts("md5", H, 200, {
      FileName: "",                      // empty string → null (trim-falsy)
      FileSize: "N/A",                   // non-numeric string → null
      ProductCode: { Language: "English" }, // object without ProductName → null
      // source omitted entirely → null (non-string)
    });
    expect(f?.known).toBe(true);
    expect(f?.fileName).toBeNull();
    expect(f?.fileSize).toBeNull();
    expect(f?.productName).toBeNull();
    expect(f?.source).toBeNull();
    expect(f?.trust).toBeNull(); // hashlookup:trust absent
  });

  it("treats a 404 as a valid negative (known:false), not an error", () => {
    const f = buildHashFacts("sha256", "0".repeat(64), 404, { message: "Non existing SHA-256" });
    expect(f).toMatchObject({ known: false, kind: "sha256", fileName: null });
  });

  it("treats a 200 with a 'Non existing' message as a miss", () => {
    const f = buildHashFacts("md5", H, 200, { message: "Non existing MD5", query: H });
    expect(f?.known).toBe(false);
  });

  it("returns null on an outage or a non-object body", () => {
    expect(buildHashFacts("md5", H, 0, null)).toBeNull();     // network failure
    expect(buildHashFacts("md5", H, 500, {})).toBeNull();     // upstream 5xx
    expect(buildHashFacts("md5", H, 200, null)).toBeNull();   // 200 but no body
    expect(buildHashFacts("md5", H, 200, "nope")).toBeNull(); // 200 but not an object
  });
});

describe("hashReputation", () => {
  const base = {
    kind: "md5" as const, input: "x", fileName: null, fileSize: null, productName: null,
    database: null, trust: null, md5: null, sha1: null, sha256: null,
  };
  it("clears a known hash as benign, naming the source when present", () => {
    const withSource = hashReputation({ ...base, known: true, source: "NSRL" });
    expect(withSource.tone).toBe("good");
    expect(withSource.detail).toContain("(NSRL)");

    const noSource = hashReputation({ ...base, known: true, source: null });
    expect(noSource.tone).toBe("good");
    expect(noSource.detail).not.toContain("("); // no source parenthetical
  });
  it("reports a miss as unknown, never as a detection", () => {
    const r = hashReputation({ ...base, known: false, source: null });
    expect(r.tone).toBe("unknown");
    expect(r.label).toMatch(/not in known-software/i);
  });
});

describe("hashPivots", () => {
  it("offers verdict engines, all over https, keyed by the algorithm", () => {
    const p = hashPivots("sha256", "deadbeef");
    expect(p.map((x) => x.label)).toEqual(
      expect.arrayContaining(["VirusTotal", "MalwareBazaar", "ThreatFox"]),
    );
    expect(p.every((x) => x.url.startsWith("https://"))).toBe(true);
    expect(p.find((x) => x.label === "MalwareBazaar")?.url).toContain("sha256%3A");
  });
});
