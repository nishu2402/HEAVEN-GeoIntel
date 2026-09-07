import { describe, it, expect } from "vitest";
import { extractPdf } from "@/lib/analysis/meta/pdf";

const pdf = (s: string) => extractPdf(new TextEncoder().encode(s));
const get = (s: string, label: string) => pdf(s).fields.find((f) => f.label === label)?.value;

describe("meta/pdf document information", () => {
  it("reads literal, hex/UTF-16, octal, escapes and dates from the Info dictionary", () => {
    const doc =
      "%PDF-1.7\n" +
      "1 0 obj<< " +
      "/Title <FEFF00480049> " +               // UTF-16BE "HI"
      "/Author (John \\(J\\) Doe) " +           // escaped parens
      "/Creator (Acme\\251Writer) " +           // octal escape \251 = ©
      "/Producer (lib\\\npdf) " +               // line continuation -> "libpdf"
      "/CreationDate (D:20230115094500Z) " +
      "/ModDate (not a date) " +
      ">>endobj\n" +
      "5 0 obj<< /Author (Jane Q) >>endobj\n" + // later occurrence wins
      "trailer<< /Info 1 0 R /Encrypt 9 0 R >>\n<?xpacket begin?>%%EOF";
    expect(get(doc, "PDF version")).toBe("1.7");
    expect(get(doc, "Title")).toBe("HI");
    expect(get(doc, "Author")).toBe("Jane Q");
    expect(get(doc, "Creator")).toBe("Acme©Writer");
    expect(get(doc, "Producer")).toBe("libpdf");
    expect(get(doc, "Created")).toBe("2023-01-15 09:45:00");
    expect(get(doc, "Modified")).toBe("not a date");
    const notes = pdf(doc).notes ?? [];
    expect(notes.some((n) => /encrypted/i.test(n))).toBe(true);
    expect(notes.some((n) => /XMP/.test(n))).toBe(true);
  });

  it("handles nested parentheses, simple and unknown escapes", () => {
    const v = get("%PDF-1.4 /Subject (a\\nb\\tc\\\\d (nested) e\\q)", "Subject");
    expect(v).toBe("a\nb\tc\\d (nested) eq"); // \q -> literal q
  });

  it("marks author and creator as sensitive attribution", () => {
    const f = pdf("%PDF-1.5 /Author (Real Name) /Producer (tool)").fields;
    expect(f.find((x) => x.label === "Author")?.sensitive).toBe(true);
    expect(f.find((x) => x.label === "Producer")?.sensitive).toBeUndefined();
  });

  it("reads hex strings with whitespace and odd length, defaults partial dates", () => {
    expect(get("%PDF-1.6 /Keywords <48 49 4>", "Keywords")).toBe("HI@");
    expect(get("%PDF-1.6 /CreationDate (D:2024)", "Created")).toBe("2024-01-01 00:00:00");
  });

  it("skips non-string values, empty strings and dictionary-open tokens", () => {
    expect(get("%PDF-1.4 /Author /NameToken", "Author")).toBeUndefined();
    expect(get("%PDF-1.4 /Title ()", "Title")).toBeUndefined();
    expect(get("%PDF-1.4 /Title <>", "Title")).toBeUndefined();
    expect(get("%PDF-1.4 /Author << /X 1 >>", "Author")).toBeUndefined();
    expect(get("%PDF-1.4 /Producer 12", "Producer")).toBeUndefined();
  });

  it("stops safely at a trailing backslash and reports the XMP-packet form", () => {
    expect(get("%PDF-1.4 /Title (ab\\", "Title")).toBe("ab");
    expect((pdf("%PDF-1.4 <x:xmpmeta></x:xmpmeta>").notes ?? []).some((n) => /XMP/.test(n))).toBe(true);
  });

  it("bounds a giant value and a key repeated to excess (no quadratic scan)", () => {
    // An unterminated literal is capped at MAX_PDF_VALUE (64 KiB) characters.
    const litTitle = get(`%PDF-1.4 /Title (${"a".repeat(70000)}`, "Title");
    expect(litTitle?.length).toBe(65536);
    // An unterminated hex string reads 64 KiB of hex digits -> 32 KiB of bytes.
    const hexKw = get(`%PDF-1.4 /Keywords <${"41".repeat(70000)}`, "Keywords");
    expect(hexKw?.length).toBe(32768);
    // A key flooded past the 256-match cap still resolves to a real value.
    expect(get("%PDF-1.4 " + "/Author (a) ".repeat(300), "Author")).toBe("a");
  });

  it("omits the version when the header is absent (direct, non-pdf input)", () => {
    const r = extractPdf(new TextEncoder().encode("no header here /Author (x)"));
    expect(r.fields.find((f) => f.label === "PDF version")).toBeUndefined();
    expect(r.fields.find((f) => f.label === "Author")?.value).toBe("x");
  });
});
