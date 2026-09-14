import { describe, it, expect } from "vitest";
import { extractOle } from "@/lib/analysis/meta/ole";
import { sniff } from "@/lib/analysis/meta/sniff";
import { extractFileMeta } from "@/lib/analysis/meta/fileMeta";

// ── A real OLE2 compound file, assembled byte by byte ────────────────────────
//
// There is no way to test a container parser honestly without a container, so
// this writes one: header, FAT, directory, mini FAT and mini stream, laid out
// exactly as [MS-CFB] specifies. Streams under the 4 KiB cutoff go into the
// mini stream; larger ones get their own sector chain, so both read paths are
// exercised by real files rather than by stubs.

const SECTOR = 512;
const MINI = 64;
const FREE = 0xffffffff;
const EOC = 0xfffffffe;
const FATSECT = 0xfffffffd;

const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const BYTE = BigInt(255);
const u64 = (n: bigint) => Array.from({ length: 8 }, (_, i) => Number((n >> BigInt(8 * i)) & BYTE));
const utf16 = (s: string) => [...s].flatMap((c) => u16(c.charCodeAt(0)));
const pad = (arr: number[], to: number) => [...arr, ...new Array(Math.max(0, to - arr.length)).fill(0)];

interface StreamSpec { name: string; data: number[]; storage?: boolean }

/** One 128-byte directory entry. */
function dirEntry(name: string, type: number, start: number, size: number): number[] {
  const nameBytes = pad(utf16(name), 64);
  return [
    ...nameBytes,
    ...u16(name.length * 2 + 2), // name length counts the terminating NUL
    type, 1,                      // object type, colour
    ...u32(FREE), ...u32(FREE), ...u32(FREE), // left, right, child
    ...new Array(16).fill(0),     // CLSID
    ...u32(0),                    // state bits
    ...u64(BigInt(0)), ...u64(BigInt(0)), // creation, modification time
    ...u32(start), ...u32(size), ...u32(0),
  ];
}

interface OleOptions {
  sectorShift?: number;
  miniShift?: number;
  truncateTo?: number;
  difat?: "dangling" | "present";
}

function buildOle(streams: StreamSpec[], opts: OleOptions = {}): Uint8Array {
  const small = streams.filter((s) => !s.storage && s.data.length < 4096);
  const large = streams.filter((s) => !s.storage && s.data.length >= 4096);

  // The mini stream: every small stream padded up to a whole mini sector.
  const miniStream: number[] = [];
  const miniStart = new Map<string, number>();
  for (const s of small) {
    miniStart.set(s.name, miniStream.length / MINI);
    miniStream.push(...pad(s.data, Math.ceil(s.data.length / MINI) * MINI));
  }

  // Sector 0 is the FAT, 1 the directory, 2 the mini FAT; payload follows.
  const payload: number[][] = [];
  let nextSector = 3;
  const alloc = (data: number[]) => {
    const start = nextSector;
    const count = Math.max(1, Math.ceil(data.length / SECTOR));
    for (let i = 0; i < count; i++) payload.push(pad(data.slice(i * SECTOR, (i + 1) * SECTOR), SECTOR));
    nextSector += count;
    return { start, count };
  };
  const miniAlloc = alloc(miniStream);
  const largeAlloc = new Map<string, { start: number; count: number }>();
  for (const s of large) largeAlloc.set(s.name, alloc(s.data));

  // A DIFAT sector: it names the one real FAT sector again, then a free slot
  // ends the list, and its final word ends the chain. This is the second route
  // the format allows for finding the FAT, and a real file over ~7 MB needs it.
  let difatSector = 90; // "dangling": a sector number past the end of the file
  if (opts.difat === "present") {
    difatSector = nextSector;
    const slots = new Array(SECTOR / 4).fill(FREE);
    slots[0] = 0;
    slots[SECTOR / 4 - 1] = EOC;
    payload.push(slots.flatMap((n) => u32(n)));
    nextSector++;
  }

  // Directory: the root entry, then one entry per stream or storage.
  const dir: number[] = [
    ...dirEntry("Root Entry", 5, miniAlloc.start, miniStream.length),
    ...streams.map((s) =>
      s.storage
        ? dirEntry(s.name, 1, FREE, 0)
        : dirEntry(s.name, 2, largeAlloc.get(s.name)?.start ?? miniStart.get(s.name) ?? 0, s.data.length),
    ).flat(),
  ];

  // Mini FAT: each small stream is a run of consecutive mini sectors.
  const miniFat: number[] = [];
  for (const s of small) {
    const count = Math.max(1, Math.ceil(s.data.length / MINI));
    for (let i = 0; i < count; i++) miniFat.push(i === count - 1 ? EOC : miniFat.length + 1);
  }

  // FAT: 0 is itself, 1 the directory, 2 the mini FAT, then the payload runs.
  const fat: number[] = [FATSECT, EOC, EOC];
  const runEnd = (start: number, count: number) => {
    for (let i = 0; i < count; i++) fat[start + i] = i === count - 1 ? EOC : start + i + 1;
  };
  runEnd(miniAlloc.start, miniAlloc.count);
  for (const a of largeAlloc.values()) runEnd(a.start, a.count);
  while (fat.length < SECTOR / 4) fat.push(FREE);

  const shift = opts.sectorShift ?? 9;
  const header = [
    0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
    ...new Array(16).fill(0),
    ...u16(0x3e), ...u16(3), ...u16(0xfffe),
    ...u16(shift), ...u16(opts.miniShift ?? 6),
    ...new Array(6).fill(0),
    ...u32(0), ...u32(1), ...u32(1), ...u32(0),
    ...u32(4096), ...u32(2), ...u32(1),
    ...u32(opts.difat ? difatSector : EOC), ...u32(opts.difat ? 1 : 0),
    ...u32(0), // DIFAT[0]: the FAT lives in sector 0
    ...new Array(108).fill(FREE).flatMap((n) => u32(n)),
  ];

  const out = [
    ...pad(header, SECTOR),
    ...pad(fat.flatMap((n) => u32(n)), SECTOR),
    ...pad(dir, SECTOR),
    ...pad(miniFat.flatMap((n) => u32(n)), SECTOR),
    ...payload.flat(),
  ];
  return new Uint8Array(opts.truncateTo !== undefined ? out.slice(0, opts.truncateTo) : out);
}

// ── Property-set writer ──────────────────────────────────────────────────────

type PropType = "str" | "wstr" | "i4" | "i2" | "time" | "blob";
interface Prop { id: number; type: PropType; value: string | number | bigint }

const TYPE_CODE: Record<PropType, number> = { str: 0x1e, wstr: 0x1f, i4: 0x03, i2: 0x02, time: 0x40, blob: 0x41 };

function propBody(p: Prop): number[] {
  if (p.type === "str") {
    const bytes = [...new TextEncoder().encode(String(p.value)), 0];
    return [...u32(TYPE_CODE.str), ...u32(bytes.length), ...pad(bytes, Math.ceil(bytes.length / 4) * 4)];
  }
  if (p.type === "wstr") {
    const s = String(p.value);
    return [...u32(TYPE_CODE.wstr), ...u32(s.length + 1), ...utf16(s), 0, 0];
  }
  if (p.type === "i4") return [...u32(TYPE_CODE.i4), ...u32(Number(p.value))];
  if (p.type === "i2") return [...u32(TYPE_CODE.i2), ...u16(Number(p.value)), 0, 0];
  if (p.type === "time") return [...u32(TYPE_CODE.time), ...u64(BigInt(p.value as bigint))];
  return [...u32(TYPE_CODE.blob), ...u32(0)]; // a type the reader does not decode
}

function propertySet(props: Prop[]): number[] {
  const bodies = props.map(propBody);
  const tableSize = 8 + props.length * 8;
  const offsets: number[] = [];
  let at = tableSize;
  for (const b of bodies) { offsets.push(at); at += b.length; }
  const section = [
    ...u32(at), ...u32(props.length),
    ...props.flatMap((p, i) => [...u32(p.id), ...u32(offsets[i])]),
    ...bodies.flat(),
  ];
  return [
    ...u16(0xfffe), ...u16(0), ...u32(0x000a0002),
    ...new Array(16).fill(0),
    ...u32(1),
    ...new Array(16).fill(0),
    ...u32(48),
    ...section,
  ];
}

const SUMMARY = "SummaryInformation";
const DOC_SUMMARY = "DocumentSummaryInformation";
// 2024-03-02 10:15:00 UTC as a FILETIME: 100 ns units since 1601-01-01.
const FT_2024 = BigInt(1709374500 + 11644473600) * BigInt(10000000);

const fieldMap = (bytes: Uint8Array) =>
  Object.fromEntries(extractOle(bytes).fields.map((f) => [f.label, f.value]));

describe("meta/ole legacy Office documents", () => {
  it("reads the SummaryInformation property set out of the mini stream", () => {
    const file = buildOle([
      { name: "WordDocument", data: [1, 2, 3] },
      {
        name: SUMMARY,
        data: propertySet([
          { id: 1, type: "i2", value: 1252 },
          { id: 2, type: "str", value: "Quarterly report" },
          { id: 4, type: "str", value: "Dana Whitfield" },
          { id: 8, type: "str", value: "m.okafor" },
          { id: 9, type: "str", value: "7" },
          { id: 10, type: "time", value: BigInt(90 * 60) * BigInt(10000000) },
          { id: 12, type: "time", value: FT_2024 },
          { id: 15, type: "i4", value: 2481 },
          { id: 18, type: "str", value: "Microsoft Word 10.0" },
        ]),
      },
    ]);
    const f = fieldMap(file);
    expect(f["Contents"]).toBe("Word document");
    expect(f["Title"]).toBe("Quarterly report");
    expect(f["Author"]).toBe("Dana Whitfield");
    expect(f["Last saved by"]).toBe("m.okafor");
    expect(f["Revision"]).toBe("7");
    expect(f["Total editing time"]).toBe("1h 30m");
    expect(f["Created"]).toBe("2024-03-02 10:15:00");
    expect(f["Words"]).toBe("2481");
    expect(f["Application"]).toBe("Microsoft Word 10.0");
    expect(f["Streams"]).toBe("2");
  });

  it("marks the attribution fields as sensitive and leaves the rest plain", () => {
    const file = buildOle([{
      name: SUMMARY,
      data: propertySet([
        { id: 2, type: "str", value: "Plain title" },
        { id: 4, type: "str", value: "Dana Whitfield" },
      ]),
    }]);
    const fields = extractOle(file).fields;
    expect(fields.find((f) => f.label === "Author")?.sensitive).toBe(true);
    expect(fields.find((f) => f.label === "Title")?.sensitive).toBeUndefined();
  });

  it("reads DocumentSummaryInformation, including the employer and the manager", () => {
    const file = buildOle([
      { name: "PowerPoint Document", data: [0] },
      {
        name: DOC_SUMMARY,
        data: propertySet([
          { id: 2, type: "str", value: "Internal" },
          { id: 5, type: "i4", value: 44 },
          { id: 6, type: "i4", value: 12 },
          { id: 7, type: "i4", value: 18 },
          { id: 8, type: "i4", value: 3 },
          { id: 9, type: "i4", value: 1 },
          { id: 14, type: "str", value: "R. Alvarez" },
          { id: 15, type: "str", value: "Northgate Logistics" },
          { id: 17, type: "i4", value: 9100 },
        ]),
      },
    ]);
    const f = fieldMap(file);
    expect(f["Contents"]).toBe("PowerPoint presentation");
    expect(f["Category"]).toBe("Internal");
    expect(f["Lines"]).toBe("44");
    expect(f["Paragraphs"]).toBe("12");
    expect(f["Slides"]).toBe("18");
    expect(f["Notes"]).toBe("3");
    expect(f["Hidden slides"]).toBe("1");
    expect(f["Manager"]).toBe("R. Alvarez");
    expect(f["Company"]).toBe("Northgate Logistics");
    expect(f["Characters with spaces"]).toBe("9100");
  });

  it("decodes a UTF-16 property and a UTF-8 code page", () => {
    const utf8 = buildOle([{
      name: SUMMARY,
      data: propertySet([
        { id: 1, type: "i2", value: 0xfde9 }, // 65001 as a signed 16-bit value
        { id: 4, type: "str", value: "Zoë Ó Súilleabháin" },
        { id: 3, type: "wstr", value: "Отчёт" },
      ]),
    }]);
    const f = fieldMap(utf8);
    expect(f["Author"]).toBe("Zoë Ó Súilleabháin");
    expect(f["Subject"]).toBe("Отчёт");
  });

  it("reads a Latin-1 code page and a property set with no code page at all", () => {
    const cp1200 = buildOle([{
      name: SUMMARY,
      data: propertySet([{ id: 1, type: "i2", value: 1200 }, { id: 4, type: "str", value: "AB" }]),
    }]);
    expect(fieldMap(cp1200)["Author"]).toBeDefined();
    const none = buildOle([{ name: SUMMARY, data: propertySet([{ id: 4, type: "str", value: "Plain" }]) }]);
    expect(fieldMap(none)["Author"]).toBe("Plain");
  });

  it("skips a property whose type it does not decode, and an empty string", () => {
    const file = buildOle([{
      name: SUMMARY,
      data: propertySet([
        { id: 2, type: "blob", value: 0 },
        { id: 4, type: "str", value: "" },
        { id: 5, type: "str", value: "kept" },
      ]),
    }]);
    const f = fieldMap(file);
    expect(f["Title"]).toBeUndefined();
    expect(f["Author"]).toBeUndefined();
    expect(f["Keywords"]).toBe("kept");
  });

  it("refuses a timestamp and an editing time that are not real spans", () => {
    const file = buildOle([{
      name: SUMMARY,
      data: propertySet([
        { id: 10, type: "time", value: BigInt(0) },        // never opened
        { id: 12, type: "time", value: BigInt(0) },        // unset
        { id: 13, type: "time", value: BigInt("0xfffffffffffff") }, // far past year 3000
      ]),
    }]);
    const f = fieldMap(file);
    expect(f["Total editing time"]).toBeUndefined();
    expect(f["Created"]).toBeUndefined();
    expect(f["Modified"]).toBeUndefined();
  });

  it("reports a value stored under the wrong type as absent rather than guessing", () => {
    const file = buildOle([{
      name: SUMMARY,
      data: propertySet([
        { id: 12, type: "str", value: "not a filetime" },
        { id: 10, type: "i4", value: 5 },
        { id: 15, type: "str", value: "many" },
        { id: 4, type: "i4", value: 7 },
      ]),
    }]);
    const f = fieldMap(file);
    expect(f["Created"]).toBeUndefined();
    expect(f["Total editing time"]).toBeUndefined();
    expect(f["Words"]).toBeUndefined();
    expect(f["Author"]).toBeUndefined();
  });

  it("renders a sub-hour editing time in minutes", () => {
    const file = buildOle([{ name: SUMMARY, data: propertySet([{ id: 10, type: "time", value: BigInt(25 * 60) * BigInt(10000000) }]) }]);
    expect(fieldMap(file)["Total editing time"]).toBe("25 minutes");
  });

  it("reads a stream too large for the mini stream from its own sector chain", () => {
    // 5 KiB of property set: over the 4 KiB cutoff, so it takes real sectors.
    const big = propertySet([
      { id: 4, type: "str", value: "Sector Chain Author" },
      { id: 6, type: "str", value: "x".repeat(5000) },
    ]);
    const file = buildOle([{ name: SUMMARY, data: big }]);
    expect(big.length).toBeGreaterThan(4096);
    const f = fieldMap(file);
    expect(f["Author"]).toBe("Sector Chain Author");
    expect(f["Comments"]).toHaveLength(5000);
  });

  it("names the other payload streams from the directory, not the extension", () => {
    expect(fieldMap(buildOle([{ name: "Workbook", data: [0] }]))["Contents"]).toBe("Excel workbook");
    expect(fieldMap(buildOle([{ name: "Book", data: [0] }]))["Contents"]).toBe("Excel workbook (pre-97)");
    expect(fieldMap(buildOle([{ name: "VisioDocument", data: [0] }]))["Contents"]).toBe("Visio drawing");
  });

  it("recognises an Outlook message and says where the headers are", () => {
    const r = extractOle(buildOle([{ name: "__substg1.0_0037001F", data: [0] }]));
    expect(r.fields.find((f) => f.label === "Contents")?.value).toBe("Outlook message (.msg)");
    expect((r.notes ?? []).some((n) => /mail client/.test(n))).toBe(true);
  });

  it("flags an embedded VBA project", () => {
    const r = extractOle(buildOle([
      { name: "WordDocument", data: [0] },
      { name: "Macros", data: [], storage: true },
    ]));
    expect(r.fields.find((f) => f.label === "Macros")?.value).toBe("yes (VBA project present)");
    expect((r.notes ?? []).some((n) => /enabling content/.test(n))).toBe(true);
  });

  it("says plainly when a container holds no property streams", () => {
    const r = extractOle(buildOle([{ name: "WordDocument", data: [1] }]));
    expect((r.notes ?? []).some((n) => /no document property streams/.test(n))).toBe(true);
  });

  it("refuses a header whose sector geometry is not the one the format defines", () => {
    for (const opts of [{ sectorShift: 10 }, { miniShift: 7 }]) {
      const r = extractOle(buildOle([{ name: "WordDocument", data: [1] }], opts));
      expect((r.notes ?? [])[0]).toMatch(/header is malformed/);
    }
    // A file shorter than the fixed 512-byte header cannot be read at all.
    expect((extractOle(new Uint8Array(16)).notes ?? [])[0]).toMatch(/header is malformed/);
  });

  it("reports a container whose directory is unreadable", () => {
    // A full header, and then nothing: the directory sector is simply not there.
    const r = extractOle(buildOle([{ name: "WordDocument", data: [1] }], { truncateTo: 512 }));
    expect((r.notes ?? [])[0]).toMatch(/no readable directory/);
  });

  it("follows a DIFAT sector, and survives one that dangles past the file", () => {
    const present = extractOle(buildOle([{ name: "WordDocument", data: [1] }], { difat: "present" }));
    expect(present.fields.find((f) => f.label === "Contents")?.value).toBe("Word document");
    // A DIFAT sector past the end of the file reads as nothing, and the walk
    // stops there instead of inventing FAT sectors out of absent bytes.
    const dangling = extractOle(buildOle([{ name: "WordDocument", data: [1] }], { difat: "dangling" }));
    expect(dangling.fields.find((f) => f.label === "Contents")?.value).toBe("Word document");
  });
});

describe("meta/fileMeta routes a compound file to the OLE reader", () => {
  it("identifies the document and carries its properties through", async () => {
    const file = buildOle([
      { name: "WordDocument", data: [1] },
      { name: SUMMARY, data: propertySet([{ id: 4, type: "str", value: "Dana Whitfield" }]) },
    ]);
    const m = await extractFileMeta(file, "memo.doc");
    expect(m.identity.kind).toBe("doc");
    expect(m.hasDeepMeta).toBe(true);
    expect(m.fields.find((f) => f.label === "Author")?.value).toBe("Dana Whitfield");
    expect(m.extMismatch).toBeNull();
  });
});

describe("meta/sniff identifies the OLE2 family by its payload stream", () => {
  it("names the application rather than reporting a generic compound file", () => {
    expect(sniff(buildOle([{ name: "WordDocument", data: [1] }])).kind).toBe("doc");
    expect(sniff(buildOle([{ name: "Workbook", data: [1] }])).kind).toBe("xls");
    expect(sniff(buildOle([{ name: "Book", data: [1] }])).label).toBe("Excel 5.0 workbook");
    expect(sniff(buildOle([{ name: "PowerPoint Document", data: [1] }])).kind).toBe("ppt");
    expect(sniff(buildOle([{ name: "VisioDocument", data: [1] }])).kind).toBe("vsd");
    expect(sniff(buildOle([{ name: "__substg1.0_0037001F", data: [1] }])).kind).toBe("msg");
  });

  it("falls back to the generic label when no known payload stream is present", () => {
    const other = sniff(buildOle([{ name: "SomeOtherStream", data: [1] }]));
    expect(other.kind).toBe("ole");
    expect(other.ext).toBe(""); // no extension to check, so no false mismatch
  });

  it("identifies a spreadsheet renamed .doc as the spreadsheet it is", () => {
    const id = sniff(buildOle([{ name: "Workbook", data: [1] }]), "invoice.doc");
    expect(id.kind).toBe("xls");
  });
});

describe("meta/ole refuses a malformed property set rather than guessing", () => {
  /** A property-set stream header with a chosen section offset and body. */
  const rawSet = (sectionOffset: number, body: number[]) => [
    ...u16(0xfffe), ...u16(0), ...u32(0),
    ...new Array(16).fill(0), ...u32(1), ...new Array(16).fill(0),
    ...u32(sectionOffset), ...body,
  ];
  /** One property at a fixed offset, so a deliberately broken value is easy to place. */
  const oneProp = (id: number, value: number[]) =>
    rawSet(48, [...u32(16 + value.length), ...u32(1), ...u32(id), ...u32(16), ...value]);
  const author = (data: number[]) => fieldMap(buildOle([{ name: SUMMARY, data }]))["Author"];

  it("ignores a stream that is not a property set at all", () => {
    expect(author([1, 2, 3, 4, 5, 6, 7, 8])).toBeUndefined();
  });

  it("ignores a stream that ends before its section pointer", () => {
    expect(author([0xfe, 0xff])).toBeUndefined();
  });

  it("ignores a section pointer and a property count that lead nowhere", () => {
    expect(author(rawSet(9999, []))).toBeUndefined();
    expect(author(rawSet(48, [...u32(8), ...u32(5000)]))).toBeUndefined(); // absurd count
  });

  it("stops at the entry the stream runs out on", () => {
    // Four properties are declared and one is present.
    const partial = rawSet(48, [...u32(8), ...u32(4), ...u32(2), ...u32(16)]);
    expect(fieldMap(buildOle([{ name: SUMMARY, data: partial }]))["Title"]).toBeUndefined();
  });

  it("ignores a value the stream ends inside, in each stored width", () => {
    expect(fieldMap(buildOle([{ name: SUMMARY, data: oneProp(15, u32(0x03)) }]))["Words"]).toBeUndefined();
    expect(fieldMap(buildOle([{ name: SUMMARY, data: oneProp(14, u32(0x02)) }]))["Pages"]).toBeUndefined();
    expect(fieldMap(buildOle([{ name: SUMMARY, data: oneProp(12, u32(0x40)) }]))["Created"]).toBeUndefined();
    expect(author(oneProp(4, u32(0x1e)))).toBeUndefined();
  });

  it("ignores a string whose declared length the stream cannot back", () => {
    expect(author(oneProp(4, [...u32(0x1e), ...u32(100), 65, 66]))).toBeUndefined();
    // And one that claims to be a megabyte long, which no real property is.
    expect(author(oneProp(4, [...u32(0x1e), ...u32(0x200000)]))).toBeUndefined();
  });
});
