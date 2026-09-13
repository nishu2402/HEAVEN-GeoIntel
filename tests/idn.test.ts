import { describe, it, expect } from "vitest";
import {
  punycodeDecode, toAsciiHost, toUnicodeHost, isIdnHost, isValidAsciiHost,
  toAsciiLabel, normalizeEmail, isValidEmailFormat,
} from "@/lib/analysis/idn";

// Internationalised names were rejected outright: `münchen.de` and
// `test@münchen.de` both 400'd while their punycode spelling worked. Homoglyph
// domains are a large share of real phishing, so the name an analyst pastes has
// to be the name the tool looks up.

describe("punycodeDecode", () => {
  it("decodes the A-label payloads browsers actually show", () => {
    expect(punycodeDecode("mnchen-3ya")).toBe("münchen");
    expect(punycodeDecode("e1afmkfd")).toBe("пример");
    expect(punycodeDecode("wgv71a")).toBe("日本");
  });

  it("returns null for a payload that is not punycode", () => {
    expect(punycodeDecode("")).toBeNull();
    expect(punycodeDecode("-")).toBeNull();
    expect(punycodeDecode("!!!")).toBeNull();
    expect(punycodeDecode("münchen")).toBeNull();     // not ASCII
    // A trailing delimiter means "basic code points only", which decodes back
    // to those code points rather than failing.
    expect(punycodeDecode("abc-")).toBe("abc");
    expect(punycodeDecode("a-zzzzzzzzzzzzzzzz")).toBeNull(); // overflows
  });
});

describe("toAsciiHost", () => {
  it("normalises Unicode, punycode, URLs, ports and the root dot to one form", () => {
    expect(toAsciiHost("münchen.de")).toBe("xn--mnchen-3ya.de");
    expect(toAsciiHost("MÜNCHEN.DE")).toBe("xn--mnchen-3ya.de");
    expect(toAsciiHost("xn--mnchen-3ya.de")).toBe("xn--mnchen-3ya.de");
    expect(toAsciiHost("https://WordPress.org:443/path?x=1")).toBe("wordpress.org");
    expect(toAsciiHost("wordpress.org.")).toBe("wordpress.org");
  });

  it("refuses anything that is not a hostname", () => {
    expect(toAsciiHost("")).toBeNull();
    expect(toAsciiHost("   ")).toBeNull();
    expect(toAsciiHost("localhost")).toBeNull();        // single label
    expect(toAsciiHost("exa mple.com")).toBeNull();
    expect(toAsciiHost("[::1]")).toBeNull();
    expect(toAsciiHost("https:///onlypath")).toBeNull();
    expect(toAsciiHost("-bad.com")).toBeNull();
  });

  it("refuses credentials rather than silently looking up the host half", () => {
    // `new URL` reads a@b.com as credentials plus the host b.com, so accepting
    // it would look up a different name than the one that was typed.
    expect(toAsciiHost("a@b.com")).toBeNull();
  });
});

describe("toUnicodeHost", () => {
  it("decodes A-labels for display and leaves the rest alone", () => {
    expect(toUnicodeHost("xn--mnchen-3ya.de")).toBe("münchen.de");
    expect(toUnicodeHost("wordpress.org")).toBe("wordpress.org");
  });

  it("keeps a label it cannot decode verbatim rather than inventing one", () => {
    expect(toUnicodeHost("xn--.com")).toBe("xn--.com");
  });
});

describe("isIdnHost / isValidAsciiHost / toAsciiLabel", () => {
  it("spots an internationalised label", () => {
    expect(isIdnHost("xn--mnchen-3ya.de")).toBe(true);
    expect(isIdnHost("example.com")).toBe(false);
  });

  it("bounds a hostname by label and total length", () => {
    expect(isValidAsciiHost("example.com")).toBe(true);
    expect(isValidAsciiHost("a".repeat(64) + ".com")).toBe(false);
    expect(isValidAsciiHost(`${"a".repeat(60)}.`.repeat(5) + "com")).toBe(false);
    expect(isValidAsciiHost("example")).toBe(false);
  });

  it("encodes a single Unicode label for the typosquat generator", () => {
    expect(toAsciiLabel("аpple")).toBe("xn--pple-43d");   // Cyrillic а
    expect(toAsciiLabel("wordpress")).toBe("wordpress");
    expect(toAsciiLabel("--")).toBeNull();
  });
});

describe("normalizeEmail", () => {
  it("punycodes the domain half and keeps the local part as typed", () => {
    expect(normalizeEmail("Test@münchen.de")).toEqual({
      email: "Test@xn--mnchen-3ya.de",
      local: "Test",
      domain: "xn--mnchen-3ya.de",
      domainUnicode: "münchen.de",
    });
  });

  it("returns null for anything that is not an address", () => {
    expect(normalizeEmail("nope")).toBeNull();
    expect(normalizeEmail("@example.com")).toBeNull();
    expect(normalizeEmail("user@")).toBeNull();
    expect(normalizeEmail("user@not a host")).toBeNull();
  });
});

describe("isValidEmailFormat", () => {
  it("accepts an internationalised TLD, which the old pattern could not", () => {
    // `[a-zA-Z]{2,}` as the final group cannot match an A-label, so every
    // address at an internationalised TLD was reported malformed. `.рф` alone
    // has millions of registrations.
    expect(isValidEmailFormat("a@пример.рф")).toBe(true);
    expect(isValidEmailFormat("a@xn--e1afmkfd.xn--p1ai")).toBe(true);
    expect(isValidEmailFormat("a@例え.テスト")).toBe(true);
    expect(isValidEmailFormat("test@münchen.de")).toBe(true);
    expect(isValidEmailFormat("ceo@acmecorp.io")).toBe(true);
  });

  it("still refuses what is not an address", () => {
    for (const bad of ["notanemail", "no@domain", "@nope.com", "", "a@b", "a b@x.com", "a@@b.com"]) {
      expect(isValidEmailFormat(bad), bad).toBe(false);
    }
  });
});
