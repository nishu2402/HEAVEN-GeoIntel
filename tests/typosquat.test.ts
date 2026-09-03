import { describe, it, expect } from "vitest";
import { generateTyposquats, splitDomain } from "@/lib/analysis/typosquat";

describe("splitDomain", () => {
  it("splits a plain registrable domain", () => {
    expect(splitDomain("example.com")).toEqual({ prefix: "", label: "example", suffix: "com" });
  });

  it("recognises a two-label public suffix and mutates the right label", () => {
    expect(splitDomain("example.co.uk")).toEqual({ prefix: "", label: "example", suffix: "co.uk" });
  });

  it("keeps a subdomain prefix", () => {
    expect(splitDomain("mail.example.com")).toEqual({ prefix: "mail", label: "example", suffix: "com" });
    expect(splitDomain("a.b.example.co.uk")).toEqual({ prefix: "a.b", label: "example", suffix: "co.uk" });
  });

  it("strips scheme and path", () => {
    expect(splitDomain("https://example.com/login?x=1")).toEqual({ prefix: "", label: "example", suffix: "com" });
  });

  it("rejects inputs without a dot or with empty labels", () => {
    expect(splitDomain("localhost")).toBeNull();
    expect(splitDomain("example.")).toBeNull();
    expect(splitDomain(".com")).toBeNull();
    expect(splitDomain("")).toBeNull();
  });
});

describe("generateTyposquats", () => {
  const variants = generateTyposquats("example.com");
  const domains = variants.map((v) => v.domain);
  const byTech = (t: string) => variants.filter((v) => v.technique === t).map((v) => v.domain);

  it("returns [] for an unparseable domain", () => {
    expect(generateTyposquats("nope")).toEqual([]);
  });

  it("never includes the original domain", () => {
    expect(domains).not.toContain("example.com");
  });

  it("emits deduplicated, syntactically valid domains only", () => {
    expect(new Set(domains).size).toBe(domains.length);
    for (const d of domains) {
      const label = d.split(".")[0];
      expect(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label), d).toBe(true);
    }
  });

  it("produces each technique with recognisable examples", () => {
    expect(byTech("omission")).toContain("exmple.com");       // drop the 'a'
    expect(byTech("repetition")).toContain("eexample.com");   // double the 'e'
    expect(byTech("transposition")).toContain("exmaple.com"); // swap a/m
    expect(byTech("homoglyph")).toContain("exampl3.com");     // e → 3
    expect(byTech("homoglyph")).toContain("examp1e.com");     // l → 1
    expect(byTech("vowel-swap")).toContain("exomple.com");    // a → o
    expect(byTech("hyphenation")).toContain("e-xample.com");
    expect(byTech("replacement")).toContain("wxample.com");   // e→w (adjacent key)
    expect(byTech("tld-swap")).toContain("example.net");
    expect(byTech("tld-swap")).not.toContain("example.com");
  });

  it("preserves a two-label suffix but still swaps TLDs", () => {
    const v = generateTyposquats("example.co.uk");
    const doms = v.map((x) => x.domain);
    expect(doms).toContain("exmple.co.uk");          // label mutated, suffix kept
    expect(doms).toContain("example.com");           // tld-swap replaces the whole suffix
    expect(v.find((x) => x.domain === "example.co.uk")).toBeUndefined();
  });

  it("re-attaches a subdomain prefix", () => {
    const doms = generateTyposquats("mail.example.com").map((x) => x.domain);
    expect(doms).toContain("mail.exmple.com");
    expect(doms).toContain("mail.example.net");
  });

  it("handles a hyphenated label: skips non-keyboard chars and drops invalid mutations", () => {
    const v = generateTyposquats("a-b.com");
    const doms = v.map((x) => x.domain);
    // omission of the hyphen gives the valid "ab.com"...
    expect(doms).toContain("ab.com");
    // ...but omissions that leave a leading/trailing hyphen are dropped.
    expect(doms).not.toContain("-b.com");
    expect(doms).not.toContain("a-.com");
    // every emitted label is still valid
    for (const d of doms) expect(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(d.split(".")[0]), d).toBe(true);
  });

  it("includes bitsquat and insertion neighbours", () => {
    expect(byTech("bitsquatting").length).toBeGreaterThan(0);
    expect(byTech("insertion").length).toBeGreaterThan(0);
    // a bitsquat flips one bit of a character; every result stays a valid label
    for (const d of byTech("bitsquatting")) expect(/^[a-z0-9-]+$/.test(d.split(".")[0])).toBe(true);
  });
});
