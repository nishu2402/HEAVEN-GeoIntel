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

describe("meta/pdf structure, active content and XMP", () => {
  it("counts pages, names the sheet and reads the save history", () => {
    const doc =
      "%PDF-1.7\n" +
      "1 0 obj<< /Type /Pages /Count 2 >>endobj\n" +
      "2 0 obj<< /Type /Page /MediaBox [0 0 595.28 841.89] >>endobj\n" +
      "3 0 obj<< /Type /Page >>endobj\n" +
      "%%EOF\n4 0 obj<< /Type /Page >>endobj\n%%EOF\n";
    const r = pdf(doc);
    const at = (label: string) => r.fields.find((f) => f.label === label)?.value;
    // /Pages must not be counted as a page, and /Count is not trusted over the objects.
    expect(at("Pages")).toBe("3");
    expect(at("Page size")).toBe("595 × 842 pt (A4 portrait, 210 × 297 mm)");
    expect(at("Saved")).toBe("2 times (1 incremental update)");
    expect((r.notes ?? []).some((n) => /saved 2 times/.test(n))).toBe(true);
  });

  it("pluralises a longer revision chain and reports landscape and unnamed sheets", () => {
    const three = pdf("%PDF-1.4 /MediaBox [0 0 842 595]\n%%EOF\n%%EOF\n%%EOF");
    expect(three.fields.find((f) => f.label === "Saved")?.value).toBe("3 times (2 incremental updates)");
    expect(three.fields.find((f) => f.label === "Page size")?.value).toBe("842 × 595 pt (A4 landscape, 297 × 210 mm)");
    // A size no standard sheet matches is stated in points and millimetres only.
    const odd = pdf("%PDF-1.4 /MediaBox [0 0 200 400]");
    expect(odd.fields.find((f) => f.label === "Page size")?.value).toBe("200 × 400 pt (71 × 141 mm)");
  });

  it("omits a page size that is absent or degenerate", () => {
    expect(pdf("%PDF-1.4 no boxes").fields.find((f) => f.label === "Page size")).toBeUndefined();
    expect(pdf("%PDF-1.4 /MediaBox [0 0 0 800]").fields.find((f) => f.label === "Page size")).toBeUndefined();
  });

  it("omits the save line for a file written exactly once", () => {
    const r = pdf("%PDF-1.4 /Type /Page\n%%EOF");
    expect(r.fields.find((f) => f.label === "Saved")).toBeUndefined();
    expect((r.notes ?? []).some((n) => /saved/i.test(n))).toBe(false);
  });

  it("reports linearization, tagging, images, language and the typeface list", () => {
    const doc =
      "%PDF-1.6 /Linearized 1 /MarkInfo<</Marked true>> /Lang (en-GB)\n" +
      "/Subtype /Image /Subtype /Image\n" +
      "/BaseFont /ABCDEF+Calibri /BaseFont /Helvetica /BaseFont /XYZWVU+Calibri";
    const at = (label: string) => pdf(doc).fields.find((f) => f.label === label)?.value;
    expect(at("Linearized")).toBe("yes (optimised for web viewing)");
    expect(at("Tagged PDF")).toBe("yes (accessibility structure present)");
    expect(at("Embedded images")).toBe("2");
    expect(at("Language")).toBe("en-GB");
    // The six-letter subset tag is stripped, so one typeface is listed once.
    expect(at("Embedded fonts")).toBe("Calibri, Helvetica");
  });

  it("caps the typeface list rather than inventorying a generated file", () => {
    const many = "%PDF-1.4 " + Array.from({ length: 40 }, (_, i) => `/BaseFont /Face${i}`).join(" ");
    expect(pdf(many).fields.find((f) => f.label === "Embedded fonts")?.value.split(", ")).toHaveLength(24);
  });

  it("names the active content a document declares and warns about it", () => {
    const doc = "%PDF-1.7 /OpenAction<</S/JavaScript/JS(app.alert\\(1\\))>> /AcroForm 3 0 R /EmbeddedFiles 4 0 R";
    const r = pdf(doc);
    const value = r.fields.find((f) => f.label === "Active content");
    expect(value?.value).toBe("JavaScript, Open action (runs on open), Embedded file attachment, Fillable form");
    expect(value?.sensitive).toBe(true);
    expect((r.notes ?? []).some((n) => /sandbox/.test(n))).toBe(true);
  });

  it("covers the remaining active-content keys", () => {
    const doc = "%PDF-1.7 /XFA 1 0 R /RichMedia 2 0 R /GoToR 3 0 R /SubmitForm 4 0 R /Launch 5 0 R";
    expect(pdf(doc).fields.find((f) => f.label === "Active content")?.value)
      .toBe("Launch action (starts a program), XFA form, Rich media (video / Flash), Remote go-to action, Form submission action");
  });

  it("says nothing about active content when a document declares none", () => {
    const r = pdf("%PDF-1.4 /Type /Page");
    expect(r.fields.find((f) => f.label === "Active content")).toBeUndefined();
    expect((r.notes ?? []).some((n) => /sandbox/.test(n))).toBe(false);
  });

  it("reads XMP properties in both the attribute and the element form", () => {
    const doc =
      "%PDF-1.6\n<x:xmpmeta xmlns:x='adobe:ns:meta/'><rdf:RDF>" +
      '<rdf:Description xmp:CreatorTool="Adobe InDesign 19.0" xmpMM:InstanceID="uuid:instance-1">' +
      "<xmp:CreateDate>2024-03-02T11:20:00+01:00</xmp:CreateDate>" +
      "<xmpMM:DocumentID><rdf:Alt><rdf:li>xmp.did:9f8b &amp; 1</rdf:li></rdf:Alt></xmpMM:DocumentID>" +
      "</rdf:Description></rdf:RDF></x:xmpmeta>";
    const r = pdf(doc);
    const at = (label: string) => r.fields.find((f) => f.label === label);
    expect(at("Authoring tool")?.value).toBe("Adobe InDesign 19.0");
    expect(at("Authoring tool")?.sensitive).toBe(true);
    expect(at("Instance ID")?.value).toBe("uuid:instance-1");
    expect(at("XMP created")?.value).toBe("2024-03-02T11:20:00+01:00");
    // rdf:Alt/rdf:li wrappers are stripped and entities decoded.
    expect(at("Document ID")?.value).toBe("xmp.did:9f8b & 1");
    expect(at("Pages")).toBeUndefined(); // a packet is not a page
    expect((r.notes ?? []).some((n) => /revisions of each other/.test(n))).toBe(true);
  });

  it("reads a packet whose trailer was truncated, and reports an empty one honestly", () => {
    const cut = '%PDF-1.6 <?xpacket begin=""?><rdf:Description pdf:Producer="Ghostscript 10.0"/>';
    expect(pdf(cut).fields.find((f) => f.label === "XMP producer")?.value).toBe("Ghostscript 10.0");
    const empty = pdf("%PDF-1.6 <x:xmpmeta></x:xmpmeta>");
    expect((empty.notes ?? []).some((n) => /none of its standard properties/.test(n))).toBe(true);
  });

  it("decodes the numeric and named entity forms in an XMP value", () => {
    const doc = '%PDF-1.6 <x:xmpmeta><dc:format>a&#38;b &lt;c&gt; &quot;d&quot; &apos;e&apos;</dc:format></x:xmpmeta>';
    expect(pdf(doc).fields.find((f) => f.label === "Declared format")?.value).toBe(`a&b <c> "d" 'e'`);
  });

  it("skips an XMP property whose value is blank in either form", () => {
    const doc = '%PDF-1.6 <x:xmpmeta><rdf:Description xmp:CreatorTool="  "><dc:format>  </dc:format></rdf:Description></x:xmpmeta>';
    const r = pdf(doc);
    expect(r.fields.find((f) => f.label === "Authoring tool")).toBeUndefined();
    expect(r.fields.find((f) => f.label === "Declared format")).toBeUndefined();
    expect((r.notes ?? []).some((n) => /none of its standard properties/.test(n))).toBe(true);
  });

  it("reads the PDF/A claim and the remaining XMP identifiers", () => {
    const doc = '%PDF-1.6 <x:xmpmeta><rdf:Description xmpMM:OriginalDocumentID="xmp.did:orig" ' +
      'xmp:ModifyDate="2024-03-03T09:00:00Z" xmp:MetadataDate="2024-03-04T09:00:00Z" ' +
      'pdfaid:part="2" dc:format="application/pdf"/></x:xmpmeta>';
    const at = (label: string) => pdf(doc).fields.find((f) => f.label === label)?.value;
    expect(at("Original document ID")).toBe("xmp.did:orig");
    expect(at("XMP modified")).toBe("2024-03-03T09:00:00Z");
    expect(at("XMP metadata touched")).toBe("2024-03-04T09:00:00Z");
    expect(at("PDF/A conformance")).toBe("2");
    expect(at("Declared format")).toBe("application/pdf");
  });

  it("names the encryption algorithm rather than only flagging it", () => {
    const aes256 = pdf("%PDF-1.7 /Encrypt 9 0 R\n9 0 obj<</Filter/Standard/V 5/CF<</StdCF<</CFM/AESV3>>>>>>");
    expect(aes256.fields.find((f) => f.label === "Encryption")?.value).toBe("AES-256");
    expect(pdf("%PDF-1.6 /Encrypt 9 0 R /CFM /AESV2").fields.find((f) => f.label === "Encryption")?.value).toBe("AES-128");
    expect(pdf("%PDF-1.3 /Encrypt<</V 1/R 2>>").fields.find((f) => f.label === "Encryption")?.value).toBe("RC4 40-bit");
    expect(pdf("%PDF-1.4 /Encrypt<</V 2/Length 128>>").fields.find((f) => f.label === "Encryption")?.value).toBe("RC4 128-bit");
    expect(pdf("%PDF-1.4 /Encrypt<</V 2>>").fields.find((f) => f.label === "Encryption")?.value).toBe("RC4");
    expect(pdf("%PDF-1.4 /Encrypt 9 0 R").fields.find((f) => f.label === "Encryption")?.value).toBe("undeclared algorithm");
  });
});
