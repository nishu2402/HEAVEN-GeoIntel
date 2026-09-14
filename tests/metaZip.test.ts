import { describe, it, expect } from "vitest";
import { deflateRawSync } from "node:zlib";
import { extractZip } from "@/lib/analysis/meta/zip";

// ── Minimal but valid ZIP writer ─────────────────────────────────────────────
const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const bytesOf = (s: string) => [...new TextEncoder().encode(s)];

interface Entry {
  name: string;
  data: string;
  method?: 0 | 8 | number;
  encrypted?: boolean;
  date?: number;
  time?: number;
  hostOS?: number;
  corruptDeflate?: boolean;
  badOffset?: boolean;   // central record points past the buffer (no local header)
  bigCompSize?: boolean; // central record overstates the compressed size
}

function buildZip(entries: Entry[], opts: { comment?: string; fakeTotal?: number } = {}): Uint8Array {
  const local: number[] = [];
  const central: number[] = [];
  const offsets: number[] = [];

  for (const e of entries) {
    const raw = bytesOf(e.data);
    const method = e.method ?? 0;
    let stored: number[];
    if (method === 8) stored = e.corruptDeflate ? [0, 1, 2, 3] : [...deflateRawSync(Buffer.from(raw))];
    else stored = raw;
    const flags = e.encrypted ? 1 : 0;
    const date = e.date ?? 0;
    const time = e.time ?? 0;
    const name = bytesOf(e.name);
    offsets.push(local.length);
    local.push(
      0x50, 0x4b, 0x03, 0x04, ...u16(20), ...u16(flags), ...u16(method), ...u16(time), ...u16(date),
      ...u32(0), ...u32(stored.length), ...u32(raw.length), ...u16(name.length), ...u16(0), ...name, ...stored,
    );
  }

  entries.forEach((e, i) => {
    const raw = bytesOf(e.data);
    const method = e.method ?? 0;
    const stored = method === 8 ? (e.corruptDeflate ? 4 : deflateRawSync(Buffer.from(raw)).length) : raw.length;
    const name = bytesOf(e.name);
    central.push(
      0x50, 0x4b, 0x01, 0x02, ...u16((e.hostOS ?? 0) << 8), ...u16(20), ...u16(e.encrypted ? 1 : 0), ...u16(method),
      ...u16(e.time ?? 0), ...u16(e.date ?? 0), ...u32(0), ...u32(e.bigCompSize ? 0xffffff : stored), ...u32(raw.length),
      ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0),
      ...u32(e.badOffset ? 0xffffff : offsets[i]), ...name,
    );
  });

  const cdOffset = local.length;
  const comment = bytesOf(opts.comment ?? "");
  const eocd = [
    0x50, 0x4b, 0x05, 0x06, ...u16(0), ...u16(0), ...u16(entries.length),
    ...u16(opts.fakeTotal ?? entries.length), ...u32(central.length), ...u32(cdOffset), ...u16(comment.length), ...comment,
  ];
  return new Uint8Array([...local, ...central, ...eocd]);
}

// A DOS date/time: 2023-06-15 14:30:00.
const D = ((2023 - 1980) << 9) | (6 << 5) | 15;
const T = (14 << 11) | (30 << 5) | 0;

const core = (creator: string, extra = "") =>
  `<?xml version="1.0"?><cp:coreProperties xmlns:cp="x" xmlns:dc="y" xmlns:dcterms="z">` +
  `<dc:title>My Doc</dc:title><dc:creator>${creator}</dc:creator>` +
  `<cp:lastModifiedBy>editor</cp:lastModifiedBy><dcterms:created>2023-01-01T00:00:00Z</dcterms:created>${extra}` +
  `</cp:coreProperties>`;

const val = (fields: { label: string; value: string }[], label: string) =>
  fields.find((f) => f.label === label)?.value;

describe("meta/zip archive facts", () => {
  it("reports entry count, host OS, newest date and comment", async () => {
    const zip = buildZip([
      { name: "a.txt", data: "hello", hostOS: 3, date: D, time: T },
      { name: "b.txt", data: "world", hostOS: 0, date: D, time: T },
    ], { comment: "packed by tests" });
    const r = await extractZip("zip", zip);
    expect(val(r.fields, "Entries")).toBe("2");
    expect(val(r.fields, "Created on")).toBe("Unix");
    expect(val(r.fields, "Newest member")).toBe("2023-06-15 14:30:00");
    expect(val(r.fields, "Archive comment")).toBe("packed by tests");
  });

  it("flags encrypted entries and omits an unknown host OS", async () => {
    const zip = buildZip([{ name: "s.bin", data: "x", encrypted: true, hostOS: 99 }]);
    const r = await extractZip("zip", zip);
    expect((r.notes ?? []).some((n) => /encrypted/i.test(n))).toBe(true);
    expect(val(r.fields, "Created on")).toBeUndefined(); // host OS 99 is unknown
  });

  it("skips an unset or invalid DOS date", async () => {
    const badMonth = ((2023 - 1980) << 9) | (13 << 5) | 1; // month 13
    const zip = buildZip([{ name: "z.txt", data: "x", date: badMonth }, { name: "y.txt", data: "x", date: 0 }]);
    const r = await extractZip("zip", zip);
    expect(val(r.fields, "Newest member")).toBeUndefined();
  });

  it("returns a note when there is no central directory", async () => {
    const r = await extractZip("zip", new Uint8Array(bytesOf("not a zip at all, no signatures")));
    expect(r.fields).toEqual([]);
    expect((r.notes ?? [])[0]).toMatch(/central directory/i);
  });

  it("stops when a central entry signature is wrong (overstated total)", async () => {
    const zip = buildZip([{ name: "a.txt", data: "x", hostOS: 3 }], { fakeTotal: 2 });
    const r = await extractZip("zip", zip);
    expect(val(r.fields, "Entries")).toBe("1");
  });

  it("survives a truncated central-directory entry", async () => {
    // EOCD (total 1, cdOffset 22) followed by a bare PK\x01\x02 with no fields.
    const trunc = new Uint8Array([
      0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 1, 0, 1, 0, 4, 0, 0, 0, 22, 0, 0, 0, 0, 0,
      0x50, 0x4b, 0x01, 0x02,
    ]);
    const r = await extractZip("zip", trunc);
    expect(val(r.fields, "Entries")).toBe("1");
    expect(val(r.fields, "Newest member")).toBeUndefined(); // no readable date on a truncated entry
  });
});

describe("meta/zip office and e-book properties", () => {
  it("reads DOCX core (stored) and app (deflated) properties", async () => {
    const app = `<Properties><Application>Microsoft Word</Application><Company>Acme &amp; Co&#233;</Company></Properties>`;
    const zip = buildZip([
      { name: "docProps/core.xml", data: core("Jane Author", "<dcterms:modified>2023-02-02T00:00:00Z</dcterms:modified>"), method: 0 },
      { name: "docProps/app.xml", data: app, method: 8 },
    ]);
    const r = await extractZip("docx", zip);
    expect(val(r.fields, "Author")).toBe("Jane Author");
    expect(val(r.fields, "Last saved by")).toBe("editor");
    expect(val(r.fields, "Created")).toBe("2023-01-01T00:00:00Z");
    expect(val(r.fields, "Modified")).toBe("2023-02-02T00:00:00Z");
    expect(val(r.fields, "Application")).toBe("Microsoft Word");
    expect(val(r.fields, "Company")).toBe("Acme & Coé"); // &amp; and &#233; decoded
    expect(r.fields.find((f) => f.label === "Author")?.sensitive).toBe(true);
  });

  it("copes with a DOCX missing app.xml and a corrupt deflated core", async () => {
    const only = await extractZip("docx", buildZip([{ name: "docProps/core.xml", data: core("Bob"), method: 0 }]));
    expect(val(only.fields, "Author")).toBe("Bob");
    const corrupt = await extractZip("docx", buildZip([{ name: "docProps/core.xml", data: core("Bob"), method: 8, corruptDeflate: true }]));
    expect(corrupt.fields.find((f) => f.label === "Author")).toBeUndefined();
  });

  it("reads OpenDocument meta.xml", async () => {
    const meta = `<office:meta xmlns:office="o" xmlns:meta="m" xmlns:dc="d">` +
      `<meta:initial-creator>Odt Writer</meta:initial-creator><meta:generator>LibreOffice/7</meta:generator>` +
      `<meta:creation-date>2022-05-05T09:00:00</meta:creation-date></office:meta>`;
    const r = await extractZip("odt", buildZip([{ name: "meta.xml", data: meta, method: 0 }]));
    expect(val(r.fields, "Author")).toBe("Odt Writer");
    expect(val(r.fields, "Application")).toBe("LibreOffice/7");
    // ODF without meta.xml -> no document fields.
    const none = await extractZip("odt", buildZip([{ name: "content.xml", data: "<x/>", method: 0 }]));
    expect(none.fields.filter((f) => f.group === "Document")).toEqual([]);
  });

  it("follows an EPUB container to its OPF metadata", async () => {
    const container = `<container><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>`;
    const opf = `<package xmlns:dc="d"><metadata><dc:title>The Book</dc:title>` +
      `<dc:creator>A Novelist</dc:creator><dc:publisher>Press</dc:publisher></metadata></package>`;
    const r = await extractZip("epub", buildZip([
      { name: "META-INF/container.xml", data: container, method: 0 },
      { name: "OEBPS/book.opf", data: opf, method: 8 },
    ]));
    expect(val(r.fields, "Title")).toBe("The Book");
    expect(val(r.fields, "Author")).toBe("A Novelist");
    expect(val(r.fields, "Publisher")).toBe("Press");
  });

  it("degrades on EPUBs with a missing container, path or OPF", async () => {
    const noContainer = await extractZip("epub", buildZip([{ name: "mimetype", data: "application/epub+zip" }]));
    expect(noContainer.fields.filter((f) => f.group === "Document")).toEqual([]);

    const noPath = await extractZip("epub", buildZip([{ name: "META-INF/container.xml", data: "<container/>" }]));
    expect(noPath.fields.filter((f) => f.group === "Document")).toEqual([]);

    const missingOpf = await extractZip("epub", buildZip([
      { name: "META-INF/container.xml", data: `<rootfile full-path="gone.opf"/>` },
    ]));
    expect(missingOpf.fields.filter((f) => f.group === "Document")).toEqual([]);
  });

  it("handles unsupported compression, an absent tag, and a non-document kind", async () => {
    // Method 99 -> readMember returns null -> no core fields.
    const weird = await extractZip("docx", buildZip([{ name: "docProps/core.xml", data: core("x"), method: 99 }]));
    expect(weird.fields.filter((f) => f.group === "Document")).toEqual([]);
    // An entry present but the tag missing -> that field is skipped.
    const noTag = await extractZip("docx", buildZip([{ name: "docProps/core.xml", data: `<cp:coreProperties xmlns:cp="x"></cp:coreProperties>`, method: 0 }]));
    expect(noTag.fields.filter((f) => f.group === "Document")).toEqual([]);
    // A ZIP that is not an office or e-book kind gets no document properties.
    const plain = await extractZip("zip", buildZip([{ name: "readme.txt", data: "hello" }]));
    expect(plain.fields.every((f) => f.group === "Archive")).toBe(true);
  });

  it("refuses a decompression-bomb member instead of buffering it whole", async () => {
    // One member declaring 33 MB uncompressed, from a few KB of DEFLATE'd 'A's.
    // The output overruns the 32 MB inflate cap, so the member yields nothing
    // while the archive-level facts still read.
    const uncompressed = 33 * 1024 * 1024;
    const compressed = [...deflateRawSync(Buffer.alloc(uncompressed, 0x41))];
    const name = bytesOf("docProps/core.xml");
    const local = [
      0x50, 0x4b, 0x03, 0x04, ...u16(20), ...u16(0), ...u16(8), ...u16(0), ...u16(0),
      ...u32(0), ...u32(compressed.length), ...u32(uncompressed), ...u16(name.length), ...u16(0), ...name, ...compressed,
    ];
    const central = [
      0x50, 0x4b, 0x01, 0x02, ...u16(0), ...u16(20), ...u16(0), ...u16(8), ...u16(0), ...u16(0),
      ...u32(0), ...u32(compressed.length), ...u32(uncompressed),
      ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(0), ...name,
    ];
    const cdOffset = local.length;
    const eocd = [
      0x50, 0x4b, 0x05, 0x06, ...u16(0), ...u16(0), ...u16(1), ...u16(1),
      ...u32(central.length), ...u32(cdOffset), ...u16(0),
    ];
    const zip = new Uint8Array([...local, ...central, ...eocd]);

    const r = await extractZip("docx", zip);
    expect(val(r.fields, "Entries")).toBe("1");
    expect(r.fields.filter((f) => f.group === "Document")).toEqual([]);
  });

  it("skips empty tags, absent core, and unreadable ODF/EPUB members", async () => {
    // Tag present but empty -> value is dropped; a sibling tag still reads.
    const emptyTag = await extractZip("docx", buildZip([
      { name: "docProps/core.xml", data: `<cp:coreProperties xmlns:cp="c" xmlns:dc="d"><dc:creator>  </dc:creator><dc:title>Kept</dc:title></cp:coreProperties>`, method: 0 },
    ]));
    expect(val(emptyTag.fields, "Author")).toBeUndefined();
    expect(val(emptyTag.fields, "Title")).toBe("Kept");

    // A DOCX with neither core nor app member.
    const noCore = await extractZip("docx", buildZip([{ name: "word/document.xml", data: "<x/>" }]));
    expect(noCore.fields.filter((f) => f.group === "Document")).toEqual([]);

    // ODF meta.xml present but unreadable (unsupported method).
    const odtBad = await extractZip("odt", buildZip([{ name: "meta.xml", data: "<office:meta/>", method: 99 }]));
    expect(odtBad.fields.filter((f) => f.group === "Document")).toEqual([]);

    // EPUB container unreadable, and container OK but OPF unreadable.
    const epubBadContainer = await extractZip("epub", buildZip([{ name: "META-INF/container.xml", data: "x", method: 99 }]));
    expect(epubBadContainer.fields.filter((f) => f.group === "Document")).toEqual([]);
    const epubBadOpf = await extractZip("epub", buildZip([
      { name: "META-INF/container.xml", data: `<rootfile full-path="b.opf"/>`, method: 0 },
      { name: "b.opf", data: "<package/>", method: 99 },
    ]));
    expect(epubBadOpf.fields.filter((f) => f.group === "Document")).toEqual([]);

    // app.xml present but unreadable (its local header/data cannot be reached).
    const appNull = await extractZip("docx", buildZip([
      { name: "docProps/core.xml", data: core("C"), method: 0 },
      { name: "docProps/app.xml", data: "<Properties><Company>X</Company></Properties>", method: 0, bigCompSize: true },
    ]));
    expect(val(appNull.fields, "Author")).toBe("C");
    expect(val(appNull.fields, "Company")).toBeUndefined();

    // A member whose local header itself is out of range -> readMember returns null.
    const badLocal = await extractZip("docx", buildZip([{ name: "docProps/core.xml", data: core("C"), badOffset: true }]));
    expect(badLocal.fields.filter((f) => f.group === "Document")).toEqual([]);
  });
});

describe("meta/zip archive-level facts", () => {
  const at = (r: { fields: { label: string; value: string }[] }, label: string) =>
    r.fields.find((f) => f.label === label)?.value;

  it("reports folders, sizes, the compression it achieved and a sample of names", async () => {
    const r = await extractZip("zip", buildZip([
      { name: "docs/", data: "" },
      { name: "docs/notes.txt", data: "n".repeat(2048), method: 8 },
      { name: "docs/data.csv", data: "c".repeat(2048), method: 8 },
    ]));
    expect(at(r, "Entries")).toBe("3");
    expect(at(r, "Folders")).toBe("1");
    expect(at(r, "Uncompressed")).toBe("4.0 KB");
    expect(at(r, "Compression")).toMatch(/^9\d\.\d% smaller packed$/);
    expect(at(r, "Contents")).toBe("docs/notes.txt, docs/data.csv");
  });

  it("lists no contents for an archive that holds only folders", async () => {
    const r = await extractZip("zip", buildZip([{ name: "empty/", data: "" }]));
    expect(at(r, "Entries")).toBe("1");
    expect(at(r, "Folders")).toBe("1");
    expect(at(r, "Contents")).toBeUndefined();
    expect(at(r, "Uncompressed")).toBeUndefined();
  });

  it("truncates a long content list rather than printing the whole inventory", async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `f${i}.txt`, data: "x" }));
    expect(at(await extractZip("zip", buildZip(many)), "Contents")).toMatch(/, and 12 more$/);
  });

  it("gives the oldest member only when it differs from the newest", async () => {
    const oneDate = { date: 0x5885, time: 0x4800 }; // 2024-04-05 09:00:00
    const older = { date: 0x3021, time: 0x4800 };   // 2004-01-01 09:00:00
    const spread = await extractZip("zip", buildZip([
      { name: "a.txt", data: "a", ...oneDate },
      { name: "b.txt", data: "b", ...older },
    ]));
    expect(at(spread, "Oldest member")).toBe("2004-01-01 09:00:00");
    expect(at(spread, "Newest member")).toBe("2024-04-05 09:00:00");
    const single = await extractZip("zip", buildZip([{ name: "a.txt", data: "a", ...oneDate }]));
    expect(at(single, "Oldest member")).toBeUndefined();
    expect(at(single, "Newest member")).toBe("2024-04-05 09:00:00");
  });

  it("names executable members and members that escape the extraction folder", async () => {
    const r = await extractZip("zip", buildZip([
      { name: "invoice.pdf.exe", data: "x" },
      { name: "setup.msi", data: "x" },
      { name: "../../etc/cron.d/backdoor", data: "x" },
      { name: "/etc/passwd", data: "x" },
      { name: "nested/../../escape.txt", data: "x" },
    ]));
    expect(at(r, "Executable members")).toBe("invoice.pdf.exe, setup.msi");
    expect(at(r, "Paths outside the archive")).toBe("../../etc/cron.d/backdoor, /etc/passwd, nested/../../escape.txt");
    expect((r.notes ?? []).some((n) => /zip-slip/.test(n))).toBe(true);
  });

  it("caps the lists of risky members", async () => {
    const lots = Array.from({ length: 10 }, (_, i) => ({ name: `../out${i}.exe`, data: "x" }));
    const r = await extractZip("zip", buildZip(lots));
    expect(at(r, "Executable members")?.split(", ")).toHaveLength(6);
    expect(at(r, "Paths outside the archive")?.split(", ")).toHaveLength(6);
  });

  it("reads the build machine out of a Java manifest and reports the signing", async () => {
    const manifest = [
      "Manifest-Version: 1.0",
      "Built-By: jenkins-agent-04",
      "Created-By: Apache Maven 3.9.6",
      "Build-Jdk: 17.0.9",
      "Main-Class: com.example.Main",
      "Implementation-Title: billing-service",
      "Implementation-Version: 2.4.1",
      "Implementation-Vendor: Northgate Ltd",
      "Bundle-SymbolicName: com.example.billing",
    ].join("\n");
    const r = await extractZip("jar", buildZip([
      { name: "META-INF/MANIFEST.MF", data: manifest },
      { name: "META-INF/CERT.RSA", data: "sig" },
    ]));
    expect(at(r, "Built by")).toBe("jenkins-agent-04");
    expect(at(r, "Created by")).toBe("Apache Maven 3.9.6");
    expect(at(r, "Build JDK")).toBe("17.0.9");
    expect(at(r, "Main class")).toBe("com.example.Main");
    expect(at(r, "Implementation title")).toBe("billing-service");
    expect(at(r, "Implementation version")).toBe("2.4.1");
    expect(at(r, "Vendor")).toBe("Northgate Ltd");
    expect(at(r, "Bundle name")).toBe("com.example.billing");
    expect(at(r, "Signed")).toBe("yes (signature block present)");
    expect(r.fields.find((f) => f.label === "Built by")?.sensitive).toBe(true);
  });

  it("keeps the first spelling when a manifest declares a key twice", async () => {
    const manifest = "Build-Jdk: 17.0.9\nBuild-Jdk-Spec: 21";
    const r = await extractZip("jar", buildZip([{ name: "META-INF/MANIFEST.MF", data: manifest }]));
    expect(r.fields.filter((f) => f.label === "Build JDK")).toHaveLength(1);
    expect(at(r, "Build JDK")).toBe("17.0.9");
  });

  it("reports an unsigned jar and one with no manifest at all", async () => {
    const unsigned = await extractZip("jar", buildZip([{ name: "META-INF/MANIFEST.MF", data: "Manifest-Version: 1.0" }]));
    expect(at(unsigned, "Signed")).toBe("no signature block");
    const bare = await extractZip("jar", buildZip([{ name: "a.class", data: "x" }]));
    expect(at(bare, "Signed")).toBe("no signature block");
    expect(at(bare, "Built by")).toBeUndefined();
  });

  it("reads an Android package's architectures and DEX files", async () => {
    const r = await extractZip("apk", buildZip([
      { name: "AndroidManifest.xml", data: "x" },
      { name: "classes.dex", data: "x" },
      { name: "classes2.dex", data: "x" },
      { name: "lib/arm64-v8a/libnative.so", data: "x" },
      { name: "lib/x86_64/libnative.so", data: "x" },
      { name: "lib/arm64-v8a/libother.so", data: "x" },
    ]));
    expect(at(r, "Native ABIs")).toBe("arm64-v8a, x86_64");
    expect(at(r, "DEX files")).toBe("2");
  });

  it("omits the architecture and DEX lines from a package that has neither", async () => {
    const r = await extractZip("apk", buildZip([{ name: "resources.arsc", data: "x" }]));
    expect(at(r, "Native ABIs")).toBeUndefined();
    expect(at(r, "DEX files")).toBeUndefined();
  });
});

describe("meta/zip deeper document properties", () => {
  const at = (r: { fields: { label: string; value: string }[] }, label: string) =>
    r.fields.find((f) => f.label === label)?.value;

  it("reads the Office extended properties, statistics included", async () => {
    const app = `<Properties><Application>Microsoft Office Word</Application><AppVersion>16.0000</AppVersion>` +
      `<Company>Northgate</Company><Manager>R. Alvarez</Manager><Template>Normal.dotm</Template>` +
      `<HyperlinkBase>\\\\fileserver\\shared</HyperlinkBase><TotalTime>184</TotalTime><DocSecurity>0</DocSecurity>` +
      `<Pages>12</Pages><Slides>0</Slides><Notes>0</Notes><HiddenSlides>0</HiddenSlides><Words>3120</Words>` +
      `<Characters>17800</Characters><CharactersWithSpaces>20900</CharactersWithSpaces>` +
      `<Lines>148</Lines><Paragraphs>41</Paragraphs></Properties>`;
    const r = await extractZip("docx", buildZip([{ name: "docProps/app.xml", data: app, method: 8 }]));
    expect(at(r, "Application version")).toBe("16.0000");
    expect(at(r, "Template")).toBe("Normal.dotm");
    expect(at(r, "Hyperlink base")).toBe("\\\\fileserver\\shared");
    expect(at(r, "Editing time (min)")).toBe("184");
    expect(at(r, "Pages")).toBe("12");
    expect(at(r, "Words")).toBe("3120");
    expect(at(r, "Characters with spaces")).toBe("20900");
    expect(at(r, "Lines")).toBe("148");
    expect(at(r, "Paragraphs")).toBe("41");
    expect(r.fields.find((f) => f.label === "Template")?.sensitive).toBe(true);
  });

  it("reads OpenDocument's print history and its statistics attributes", async () => {
    const meta = `<office:meta><dc:title>Budget</dc:title><dc:subject>FY25</dc:subject>` +
      `<meta:printed-by>k.osei</meta:printed-by><meta:print-date>2024-02-11T08:30:00</meta:print-date>` +
      `<meta:editing-duration>PT1H24M</meta:editing-duration><meta:keyword>internal</meta:keyword>` +
      `<meta:document-statistic meta:page-count="9" meta:word-count="1204" meta:character-count="7010" ` +
      `meta:paragraph-count="63" meta:image-count="4" meta:table-count="2" meta:object-count="1"/></office:meta>`;
    const r = await extractZip("ods", buildZip([{ name: "meta.xml", data: meta }]));
    expect(at(r, "Last printed by")).toBe("k.osei");
    expect(at(r, "Last printed")).toBe("2024-02-11T08:30:00");
    expect(at(r, "Editing time")).toBe("PT1H24M");
    expect(at(r, "Keywords")).toBe("internal");
    expect(at(r, "Pages")).toBe("9");
    expect(at(r, "Words")).toBe("1204");
    expect(at(r, "Characters")).toBe("7010");
    expect(at(r, "Paragraphs")).toBe("63");
    expect(at(r, "Images")).toBe("4");
    expect(at(r, "Tables")).toBe("2");
    expect(at(r, "Embedded objects")).toBe("1");
  });

  it("skips the statistics when the element is absent or its attributes are blank", async () => {
    const none = await extractZip("odt", buildZip([{ name: "meta.xml", data: `<office:meta><dc:title>t</dc:title></office:meta>` }]));
    expect(at(none, "Pages")).toBeUndefined();
    const blank = await extractZip("odt", buildZip([{ name: "meta.xml", data: `<office:meta><meta:document-statistic meta:page-count=""/></office:meta>` }]));
    expect(at(blank, "Pages")).toBeUndefined();
  });

  it("reads the fuller e-book record", async () => {
    const opf = `<package><metadata><dc:title>The Coast Road</dc:title><dc:creator>H. Nakamura</dc:creator>` +
      `<dc:contributor>Trans. by L. Park</dc:contributor><dc:publisher>Sable Press</dc:publisher>` +
      `<dc:identifier>urn:isbn:9781234567897</dc:identifier><dc:language>en</dc:language>` +
      `<dc:rights>All rights reserved</dc:rights><dc:description>A novel.</dc:description></metadata></package>`;
    const r = await extractZip("epub", buildZip([
      { name: "META-INF/container.xml", data: `<rootfile full-path="OEBPS/content.opf"/>` },
      { name: "OEBPS/content.opf", data: opf, method: 8 },
    ]));
    expect(at(r, "Contributor")).toBe("Trans. by L. Park");
    expect(at(r, "Identifier")).toBe("urn:isbn:9781234567897");
    expect(at(r, "Rights")).toBe("All rights reserved");
    expect(at(r, "Description")).toBe("A novel.");
  });
});
