import { describe, it, expect } from "vitest";
import { extractContainer } from "@/lib/analysis/meta/container";

const u16be = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u16le = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u32be = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const u32le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
/** A full 64-bit big-endian value, for counts a 32-bit helper cannot hold. */
const u64beBig = (n: bigint) => Array.from({ length: 8 }, (_, i) => Number((n >> BigInt(56 - 8 * i)) & BigInt(255)));
const A = (s: string) => [...s].map((c) => c.charCodeAt(0));
const U16 = (s: string) => [...s].flatMap((c) => u16be(c.charCodeAt(0)));
const U8 = (...parts: number[][]) => new Uint8Array(parts.flat());
const val = (r: { fields: { label: string; value: string }[] }, label: string) =>
  r.fields.find((f) => f.label === label)?.value;

// ── An sfnt font: a table directory and the tables it points at ─────────────

interface FontTable { tag: string; data: number[] }

function buildFont(tables: FontTable[], opts: { base?: number } = {}): Uint8Array {
  const base = opts.base ?? 0;
  const dirSize = 12 + tables.length * 16;
  let at = base + dirSize;
  const records: number[] = [];
  const payloads: number[] = [];
  for (const t of tables) {
    records.push(...A(t.tag.padEnd(4)), ...u32be(0), ...u32be(at), ...u32be(t.data.length));
    payloads.push(...t.data);
    at += t.data.length;
  }
  return U8(new Array(base).fill(0), u32be(0x00010000), u16be(tables.length), u16be(0), u16be(0), u16be(0), records, payloads);
}

/** A name table whose records are all Windows (UTF-16BE) strings. */
function nameTable(entries: { id: number; text: string; platform?: number }[]): number[] {
  const storage = 6 + entries.length * 12;
  const records: number[] = [];
  const strings: number[] = [];
  for (const e of entries) {
    const bytes = (e.platform ?? 3) === 3 ? U16(e.text) : A(e.text);
    records.push(...u16be(e.platform ?? 3), ...u16be(1), ...u16be(0x0409), ...u16be(e.id), ...u16be(bytes.length), ...u16be(strings.length));
    strings.push(...bytes);
  }
  return [...u16be(0), ...u16be(entries.length), ...u16be(storage), ...records, ...strings];
}

const headTable = (created: bigint, modified: bigint, units = 1000) => [
  ...u32be(0x00010000), ...u32be(0), ...u32be(0), ...u32be(0x5f0f3cf5),
  ...u16be(0), ...u16be(units), ...u64beBig(created), ...u64beBig(modified),
];

const os2Table = (fsType: number, vendor: string) => [
  ...u16be(4), ...u16be(500), ...u16be(400), ...u16be(5), ...u16be(fsType),
  ...new Array(48).fill(0), ...A(vendor.padEnd(4)), ...new Array(20).fill(0),
];

// 2024-03-02 10:15:00 UTC, in seconds since 1904.
const FONT_TIME = BigInt(1709374500 + 2082844800);
const DAY = BigInt(86400);

describe("meta/container fonts", () => {
  it("reads the name table, the dates, the vendor and the outline format", () => {
    const font = buildFont([
      { tag: "name", data: nameTable([
        { id: 0, text: "Copyright 2024 Sable Type" },
        { id: 1, text: "Sable Grotesk" },
        { id: 2, text: "Bold Italic" },
        { id: 3, text: "1.002;SABL;SableGrotesk-BoldItalic" },
        { id: 8, text: "Sable Type Foundry" },
        { id: 9, text: "M. Okonkwo" },
        { id: 11, text: "https://sabletype.example" },
        { id: 13, text: "SIL Open Font Licence 1.1" },
      ]) },
      { tag: "head", data: headTable(FONT_TIME, FONT_TIME + DAY) },
      { tag: "OS/2", data: os2Table(0, "SABL") },
      { tag: "glyf", data: [0] },
    ]);
    const r = extractContainer("ttf", font);
    expect(val(r, "Copyright")).toBe("Copyright 2024 Sable Type");
    expect(val(r, "Family")).toBe("Sable Grotesk");
    expect(val(r, "Style")).toBe("Bold Italic");
    expect(val(r, "Foundry")).toBe("Sable Type Foundry");
    expect(val(r, "Designer")).toBe("M. Okonkwo");
    expect(val(r, "Vendor URL")).toBe("https://sabletype.example");
    expect(val(r, "Licence")).toBe("SIL Open Font Licence 1.1");
    expect(val(r, "Units per em")).toBe("1000");
    expect(val(r, "Outlines created")).toBe("2024-03-02 10:15:00");
    expect(val(r, "Outlines modified")).toBe("2024-03-03 10:15:00");
    expect(val(r, "Embedding")).toBe("installable (no embedding restriction)");
    expect(val(r, "Vendor id")).toBe("SABL");
    expect(val(r, "Outline format")).toBe("TrueType (glyf)");
    expect(val(r, "Tables")).toBe("4 (name, head, OS/2, glyf)");
    expect(r.fields.find((f) => f.label === "Designer")?.sensitive).toBe(true);
  });

  it("reads a Macintosh-platform record and skips a repeated name id", () => {
    const font = buildFont([{ tag: "name", data: nameTable([
      { id: 1, text: "Mac Family", platform: 1 },
      { id: 1, text: "Windows Family" },
      { id: 99, text: "an id with no meaning here" },
    ]) }]);
    const r = extractContainer("otf", font);
    expect(val(r, "Family")).toBe("Mac Family"); // the first record of an id wins
    expect(r.fields.filter((f) => f.label === "Family")).toHaveLength(1);
  });

  it("names the other embedding permissions and a PostScript outline", () => {
    for (const [bits, text] of [[2, "restricted (embedding not permitted)"], [4, "preview and print only"], [8, "editable embedding"], [6, "permission bits 0x6"]] as const) {
      const font = buildFont([{ tag: "OS/2", data: os2Table(bits, "TEST") }]);
      expect(val(extractContainer("ttf", font), "Embedding")).toBe(text);
    }
    const cff = buildFont([{ tag: "CFF ", data: [0] }]);
    expect(val(extractContainer("otf", cff), "Outline format")).toBe("PostScript (CFF)");
  });

  it("reads the first font of a collection and says how many it holds", () => {
    // The font's own directory sits 16 bytes in, past the collection header,
    // and its table offsets are absolute, so it is built at that base.
    const inner = Array.from(buildFont([{ tag: "name", data: nameTable([{ id: 1, text: "Collected" }]) }], { base: 16 }));
    // "ttcf", version, font count, then the offset of the first font's directory.
    const header = [...A("ttcf"), ...u32be(0x00010000), ...u32be(3), ...u32be(16)];
    const r = extractContainer("ttc", U8(header, inner.slice(16)));
    expect(val(r, "Fonts in collection")).toBe("3");
    expect(val(r, "Family")).toBe("Collected");
  });

  it("describes a WOFF and a WOFF2 wrapper without claiming to read inside", () => {
    const woff = U8(A("wOFF"), u32be(0x00010000), u32be(0), u16be(17), u16be(0), u32be(0), u16be(1), u16be(0), u32be(0), u32be(4096));
    const r = extractContainer("woff", woff);
    expect(val(r, "Tables")).toBe("17");
    expect(val(r, "Extended metadata")).toBe("4,096 bytes (compressed XML)");
    expect((r.notes ?? [])[0]).toMatch(/compressed stream/);
    const woff2 = U8(A("wOF2"), u32be(0x00010000), u32be(0), u16be(12), u16be(0));
    const r2 = extractContainer("woff2", woff2);
    expect(val(r2, "Tables")).toBe("12");
    expect((r2.notes ?? [])[0]).toMatch(/Brotli/);
  });

  it("reads nothing from fonts and wrappers that are only stubs", () => {
    expect(extractContainer("ttf", new Uint8Array(4)).fields).toHaveLength(0);
    expect(extractContainer("woff", new Uint8Array(4)).fields).toHaveLength(0);
    expect(extractContainer("woff2", new Uint8Array(4)).fields).toHaveLength(0);
    expect(extractContainer("ttc", new Uint8Array(4)).fields).toHaveLength(0);
    // A table directory that runs past the end of the file.
    const cut = buildFont([{ tag: "name", data: nameTable([{ id: 1, text: "x" }]) }]).subarray(0, 20);
    expect(extractContainer("ttf", cut).fields).toHaveLength(0);
  });

  it("skips name records and dates the font does not really carry", () => {
    // A name table whose storage offsets point past the end of the file.
    const font = buildFont([
      { tag: "name", data: [...u16be(0), ...u16be(1), ...u16be(9000), ...u16be(3), ...u16be(1), ...u16be(0x0409), ...u16be(1), ...u16be(4), ...u16be(0)] },
      { tag: "head", data: headTable(BigInt(0), BigInt(0)) },
    ]);
    const r = extractContainer("ttf", font);
    expect(val(r, "Family")).toBeUndefined();
    expect(val(r, "Outlines created")).toBeUndefined();
    // And a record whose string is entirely NUL bytes.
    const blank = buildFont([{ tag: "name", data: [...u16be(0), ...u16be(1), ...u16be(18), ...u16be(3), ...u16be(1), ...u16be(0x0409), ...u16be(1), ...u16be(2), ...u16be(0), 0, 0] }]);
    expect(val(extractContainer("ttf", blank), "Family")).toBeUndefined();
    // A name table header the file ends inside, and a record table it ends in.
    expect(val(extractContainer("ttf", buildFont([{ tag: "name", data: [0, 0] }])), "Family")).toBeUndefined();
    expect(val(extractContainer("ttf", buildFont([{ tag: "name", data: [...u16be(0), ...u16be(4), ...u16be(6)] }])), "Family")).toBeUndefined();
    // A date beyond any real one.
    const future = buildFont([{ tag: "head", data: headTable(BigInt("0xfffffffffff"), BigInt(0)) }]);
    expect(val(extractContainer("ttf", future), "Outlines created")).toBeUndefined();
    // Tables the file ends inside: no units, no embedding permission.
    const stubs = buildFont([{ tag: "head", data: [0, 0] }, { tag: "OS/2", data: [0, 0] }]);
    expect(val(extractContainer("ttf", stubs), "Units per em")).toBeUndefined();
    expect(val(extractContainer("ttf", stubs), "Embedding")).toBeUndefined();
  });
});

// ── SQLite ───────────────────────────────────────────────────────────────────

function buildSqlite(opts: { pageSize?: number; pages?: number; encoding?: number; changes?: number; userVersion?: number; appId?: number; version?: number; schema?: string } = {}): Uint8Array {
  const header = new Array(100).fill(0);
  const put = (off: number, bytes: number[]) => bytes.forEach((b, i) => (header[off + i] = b));
  put(0, A("SQLite format 3\0"));
  put(16, u16be(opts.pageSize ?? 4096));
  put(24, u32be(opts.changes ?? 0));
  put(28, u32be(opts.pages ?? 0));
  put(56, u32be(opts.encoding ?? 1));
  put(60, u32be(opts.userVersion ?? 0));
  put(68, u32be(opts.appId ?? 0));
  put(96, u32be(opts.version ?? 0));
  return U8(header, A(opts.schema ?? ""));
}

describe("meta/container SQLite", () => {
  it("reads the geometry, encoding, counters and table names", () => {
    const schema = 'CREATE TABLE messages(id INT); CREATE TABLE IF NOT EXISTS "contacts"(id INT); CREATE TABLE messages(x)';
    const r = extractContainer("sqlite", buildSqlite({
      pageSize: 4096, pages: 512, encoding: 1, changes: 91, userVersion: 7, appId: 0x5afe, version: 3045001, schema,
    }));
    expect(val(r, "Page size")).toBe("4096 bytes");
    expect(val(r, "Pages")).toBe("512");
    expect(val(r, "Text encoding")).toBe("UTF-8");
    expect(val(r, "Change counter")).toBe("91");
    expect(val(r, "User version")).toBe("7");
    expect(val(r, "Application id")).toBe("0x5afe");
    expect(val(r, "Written by SQLite")).toBe("3.45.1");
    expect(val(r, "Tables")).toBe("messages, contacts"); // repeats collapse
    expect(r.fields.find((f) => f.label === "Tables")?.sensitive).toBe(true);
  });

  it("reads the 65536-byte page size the format encodes as 1", () => {
    expect(val(extractContainer("sqlite", buildSqlite({ pageSize: 1 })), "Page size")).toBe("65536 bytes");
  });

  it("names the UTF-16 encodings and omits an unknown one", () => {
    expect(val(extractContainer("sqlite", buildSqlite({ encoding: 2 })), "Text encoding")).toBe("UTF-16 little-endian");
    expect(val(extractContainer("sqlite", buildSqlite({ encoding: 3 })), "Text encoding")).toBe("UTF-16 big-endian");
    expect(val(extractContainer("sqlite", buildSqlite({ encoding: 9 })), "Text encoding")).toBeUndefined();
  });

  it("omits the counters a fresh database leaves at zero", () => {
    const r = extractContainer("sqlite", buildSqlite());
    expect(val(r, "Pages")).toBeUndefined();
    expect(val(r, "Change counter")).toBeUndefined();
    expect(val(r, "User version")).toBeUndefined();
    expect(val(r, "Application id")).toBeUndefined();
    expect(val(r, "Written by SQLite")).toBeUndefined();
    expect(val(r, "Tables")).toBeUndefined();
    expect(extractContainer("sqlite", new Uint8Array(8)).fields).toHaveLength(0);
    // A header the file ends inside states its page size and nothing further.
    const stub = extractContainer("sqlite", buildSqlite().subarray(0, 20));
    expect(val(stub, "Page size")).toBe("4096 bytes");
    expect(val(stub, "Text encoding")).toBeUndefined();
  });

  it("caps a long table list", () => {
    const schema = Array.from({ length: 40 }, (_, i) => `CREATE TABLE t${i}(x);`).join(" ");
    expect(val(extractContainer("sqlite", buildSqlite({ schema })), "Tables")?.split(", ")).toHaveLength(24);
  });
});

// ── Packet captures ──────────────────────────────────────────────────────────

describe("meta/container packet captures", () => {
  const pcap = (opts: { le?: boolean; link?: number; first?: number } = {}) => {
    const le = opts.le !== false;
    const w32 = (n: number) => (le ? u32le(n) : u32be(n));
    const w16 = (n: number) => (le ? u16le(n) : u16be(n));
    return U8(
      le ? [0xd4, 0xc3, 0xb2, 0xa1] : [0xa1, 0xb2, 0xc3, 0xd4],
      w16(2), w16(4), w32(0), w32(0), w32(262144), w32(opts.link ?? 1),
      w32(opts.first ?? 1709374500), w32(0), w32(60), w32(60),
    );
  };

  it("reads the version, snapshot length, link type and first packet time", () => {
    const r = extractContainer("pcap", pcap());
    expect(val(r, "Format")).toBe("pcap 2.4");
    expect(val(r, "Snapshot length")).toBe("262,144 bytes per packet");
    expect(val(r, "Link type")).toBe("Ethernet");
    expect(val(r, "First packet")).toBe("2024-03-02 10:15:00");
    expect(r.fields.find((f) => f.label === "First packet")?.sensitive).toBe(true);
  });

  it("reads a big-endian capture, an unmapped link type and an unset time", () => {
    expect(val(extractContainer("pcap", pcap({ le: false })), "Format")).toBe("pcap 2.4");
    expect(val(extractContainer("pcap", pcap({ link: 999 })), "Link type")).toBe("link type 999");
    expect(val(extractContainer("pcap", pcap({ first: 0 })), "First packet")).toBeUndefined();
    expect(extractContainer("pcap", new Uint8Array(4)).fields).toHaveLength(0);
    // A capture that ends after its version: the format, and nothing after it.
    const stub = extractContainer("pcap", pcap().subarray(0, 8));
    expect(val(stub, "Format")).toBe("pcap 2.4");
    expect(val(stub, "Snapshot length")).toBeUndefined();
    expect(val(stub, "Link type")).toBeUndefined();
  });

  it("reads the machine and software behind a pcapng capture", () => {
    const option = (code: number, text: string) => {
      const bytes = A(text);
      const pad = (4 - (bytes.length % 4)) % 4;
      return [...u16le(code), ...u16le(bytes.length), ...bytes, ...new Array(pad).fill(0)];
    };
    const shbOptions = [
      ...option(2, "MacBookPro18,3"),
      ...option(3, "macOS 14.4"),
      ...option(4, "Wireshark 4.2.3"),
      ...option(7, "an option with no meaning here"),
      ...u16le(0), ...u16le(0),
    ];
    const shbLength = 28 + shbOptions.length;
    const idbOptions = [...option(2, "en0"), ...option(3, "Wi-Fi"), ...option(12, "Darwin 23.4.0"), ...u16le(0), ...u16le(0)];
    const idbLength = 20 + idbOptions.length;
    const file = U8(
      u32le(0x0a0d0d0a), u32le(shbLength), [0x4d, 0x3c, 0x2b, 0x1a], u16le(1), u16le(0),
      new Array(8).fill(0), shbOptions, u32le(shbLength),
      u32le(1), u32le(idbLength), u16le(105), u16le(0), u32le(262144), idbOptions, u32le(idbLength),
    );
    const r = extractContainer("pcapng", file);
    expect(val(r, "Format")).toBe("pcapng 1.0");
    expect(val(r, "Capture machine")).toBe("MacBookPro18,3");
    expect(val(r, "Capture OS")).toBe("macOS 14.4");
    expect(val(r, "Capture software")).toBe("Wireshark 4.2.3");
    expect(val(r, "Link type")).toBe("802.11 wireless");
    expect(val(r, "Interface")).toBe("en0");
    expect(val(r, "Interface description")).toBe("Wi-Fi");
    expect(val(r, "Interface OS")).toBe("Darwin 23.4.0");
  });

  it("reads a pcapng with no options and no interface block", () => {
    const file = U8(u32le(0x0a0d0d0a), u32le(28), [0x4d, 0x3c, 0x2b, 0x1a], u16le(1), u16le(0), new Array(8).fill(0), u32le(28));
    const r = extractContainer("pcapng", file);
    expect(val(r, "Format")).toBe("pcapng 1.0");
    expect(val(r, "Capture machine")).toBeUndefined();
    expect(val(r, "Link type")).toBeUndefined();
    expect(extractContainer("pcapng", new Uint8Array(4)).fields).toHaveLength(0);
  });

  it("reads nothing past a pcapng header the file ends inside", () => {
    const cut = U8(u32le(0x0a0d0d0a), u32le(28), [0x4d, 0x3c, 0x2b, 0x1a]);
    expect(val(extractContainer("pcapng", cut), "Format")).toBeUndefined();
    // And an interface block whose own header is not all there.
    const shb = [...u32le(0x0a0d0d0a), ...u32le(28), 0x4d, 0x3c, 0x2b, 0x1a, ...u16le(1), ...u16le(0), ...new Array(8).fill(0), ...u32le(28)];
    expect(val(extractContainer("pcapng", U8(shb, u32le(1))), "Link type")).toBeUndefined();
    // An interface on a link type the table does not name states the number.
    const oddLink = U8(shb, u32le(1), u32le(20), u16le(888), u16le(0), u32le(0), u16le(0), u16le(0), u32le(20));
    expect(val(extractContainer("pcapng", oddLink), "Link type")).toBe("link type 888");
  });

  it("stops at an option list the file ends inside", () => {
    const file = U8(u32le(0x0a0d0d0a), u32le(999), [0x4d, 0x3c, 0x2b, 0x1a], u16le(1), u16le(0), new Array(8).fill(0), u16le(2));
    expect(val(extractContainer("pcapng", file), "Capture machine")).toBeUndefined();
  });
});

// ── Matroska ─────────────────────────────────────────────────────────────────

describe("meta/container Matroska and WebM", () => {
  /** An EBML element: a raw id, a one-byte length marker, then the payload. */
  const el = (id: number[], payload: number[]) => [...id, 0x80 | payload.length, ...payload];
  const SEGMENT = [0x18, 0x53, 0x80, 0x67];
  const INFO = [0x15, 0x49, 0xa9, 0x66];

  it("names the applications that muxed and wrote the file", () => {
    const info = [
      ...el([0x4d, 0x80], A("libwebm-0.2.1")),
      ...el([0x57, 0x41], A("HandBrake 1.7.3")),
      ...el([0x7b, 0xa9], A("Harbour footage")),
      // DateUTC counts nanoseconds from 2001-01-01: this is 2024-03-02 10:06:40.
      ...el([0x44, 0x61], u64beBig(BigInt(1709374000 - 978307200) * BigInt(1000000000))),
      ...el([0x44, 0x89], [0x40, 0xe5, 0x88, 0x00, 0x00, 0x00, 0x00, 0x00]), // 44100.0 ms
    ];
    const file = U8(el(SEGMENT, el(INFO, info)));
    const r = extractContainer("mkv", file);
    expect(val(r, "Muxed with")).toBe("libwebm-0.2.1");
    expect(val(r, "Written with")).toBe("HandBrake 1.7.3");
    expect(val(r, "Title")).toBe("Harbour footage");
    expect(val(r, "Created")).toBe("2024-03-02 10:06:40");
    expect(val(r, "Duration")).toBe("44 s");
    expect(r.fields.find((f) => f.label === "Written with")?.sensitive).toBe(true);
  });

  it("reads a 32-bit duration and skips one stored at another width", () => {
    const f32 = U8(el(SEGMENT, el(INFO, el([0x44, 0x89], [0x47, 0x2c, 0x44, 0x00]))))
    expect(val(extractContainer("webm", f32), "Duration")).toBe("44 s");
    const odd = U8(el(SEGMENT, el(INFO, el([0x44, 0x89], [1, 2]))));
    expect(val(extractContainer("webm", odd), "Duration")).toBeUndefined();
  });

  it("ignores a date the file does not hold in full, and unknown elements", () => {
    const shortDate = U8(el(SEGMENT, el(INFO, el([0x44, 0x61], [1, 2]))));
    expect(val(extractContainer("mkv", shortDate), "Created")).toBeUndefined();
    const unknown = U8(el(SEGMENT, el(INFO, el([0x4f, 0xfe], A("x")))));
    expect(extractContainer("mkv", unknown).fields).toHaveLength(0);
  });

  it("stops at a malformed element rather than reading past it", () => {
    expect(extractContainer("mkv", new Uint8Array([0x00])).fields).toHaveLength(0); // no id
    expect(extractContainer("mkv", new Uint8Array([0x1a])).fields).toHaveLength(0); // no size
    expect(extractContainer("mkv", new Uint8Array([0x01, 0x00])).fields).toHaveLength(0); // an eight-byte id with no size
    expect(extractContainer("mkv", new Uint8Array([0xa3, 0x00])).fields).toHaveLength(0); // size marker of zero
  });
});

// ── ICO and PSD ──────────────────────────────────────────────────────────────

describe("meta/container icons and Photoshop documents", () => {
  it("lists an icon's images and their sizes", () => {
    const entry = (w: number, h: number, bits: number) => [w, h, 0, 0, ...u16le(1), ...u16le(bits), ...u32le(100), ...u32le(22)];
    const ico = U8(u16le(0), u16le(1), u16le(3), entry(16, 16, 32), entry(0, 0, 8), entry(48, 48, 0));
    const r = extractContainer("ico", ico);
    expect(val(r, "Images")).toBe("3");
    expect(val(r, "Sizes")).toBe("16×16 at 32-bit, 256×256 at 8-bit, 48×48");
  });

  it("reads a cursor and refuses an icon that declares none", () => {
    const cur = U8(u16le(0), u16le(2), u16le(1), [32, 32, 0, 0, ...u16le(1), ...u16le(32), ...u32le(1), ...u32le(22)]);
    expect(val(extractContainer("cur", cur), "Images")).toBe("1");
    expect(extractContainer("ico", U8(u16le(0), u16le(1), u16le(0))).fields).toHaveLength(0);
    expect(extractContainer("ico", new Uint8Array(2)).fields).toHaveLength(0);
  });

  it("lists no sizes when the directory itself is absent", () => {
    expect(val(extractContainer("ico", U8(u16le(0), u16le(1), u16le(2))), "Images")).toBe("2");
    expect(val(extractContainer("ico", U8(u16le(0), u16le(1), u16le(2))), "Sizes")).toBeUndefined();
  });

  it("stops listing icon sizes the directory does not hold", () => {
    const ico = U8(u16le(0), u16le(1), u16le(4), [16, 16, 0, 0, ...u16le(1), ...u16le(32), ...u32le(1), ...u32le(22)]);
    expect(val(extractContainer("ico", ico), "Sizes")).toBe("16×16 at 32-bit");
  });

  it("reads a Photoshop document's canvas, channels and colour mode", () => {
    const psd = U8(A("8BPS"), u16be(1), new Array(6).fill(0), u16be(4), u32be(1080), u32be(1920), u16be(8), u16be(4));
    const r = extractContainer("psd", psd);
    expect(val(r, "Canvas")).toBe("1920 × 1080 px");
    expect(val(r, "Channels")).toBe("4");
    expect(val(r, "Bit depth")).toBe("8 bits per channel");
    expect(val(r, "Colour mode")).toBe("CMYK");
  });

  it("reads an XMP packet out of a Photoshop document, and names an odd mode", () => {
    const packet = '<x:xmpmeta><rdf:Description xmp:CreatorTool="Adobe Photoshop 25.0"/></x:xmpmeta>';
    const psd = U8(A("8BPS"), u16be(1), new Array(6).fill(0), u16be(3), u32be(10), u32be(10), u16be(8), u16be(99), A(packet));
    const r = extractContainer("psd", psd);
    expect(val(r, "Authoring tool")).toBe("Adobe Photoshop 25.0");
    expect(val(r, "Colour mode")).toBe("mode 99");
    expect(extractContainer("psd", new Uint8Array(8)).fields).toHaveLength(0);
    // A header that stops after the canvas: no depth, no mode.
    const cut = U8(A("8BPS"), u16be(1), new Array(6).fill(0), u16be(3), u32be(10), u32be(10));
    expect(val(extractContainer("psd", cut), "Canvas")).toBe("10 × 10 px");
    expect(val(extractContainer("psd", cut), "Bit depth")).toBeUndefined();
    expect(val(extractContainer("psd", cut), "Colour mode")).toBeUndefined();
  });
});

describe("meta/container dispatch", () => {
  it("returns nothing for a kind it does not handle", () => {
    expect(extractContainer("rpm", new Uint8Array(16)).fields).toHaveLength(0);
  });
});
