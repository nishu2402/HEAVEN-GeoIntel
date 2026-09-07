import { describe, it, expect } from "vitest";
import { extractIsoBmff, parseIso6709 } from "@/lib/analysis/meta/isobmff";
import { buildTiff } from "./exifFixtures";

// ── ISO base media fixture builders ──────────────────────────────────────────
const u32be = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const u16be = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const fourcc = (s: string) => [...s].map((c) => c.charCodeAt(0));
const bytesOf = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** A box with a 4-character-code type. */
function box(type: string, payload: number[] = []): number[] {
  return [...u32be(8 + payload.length), ...fourcc(type), ...payload];
}
/** A box whose 4-byte type field is a numeric index (an ilst keyed entry). */
function boxN(index: number, payload: number[]): number[] {
  return [...u32be(8 + payload.length), ...u32be(index), ...payload];
}
/** A `data` value box: type indicator + locale + payload. */
function dataAtom(text: string, typeInd = 1): number[] {
  return box("data", [...u32be(typeInd), ...u32be(0), ...bytesOf(text)]);
}
const U = (n: number[]) => new Uint8Array(n);
const run = (kind: string, bytes: number[]) => extractIsoBmff(kind, U(bytes));
const val = (fields: { label: string; value: string }[], label: string) =>
  fields.find((f) => f.label === label)?.value;

const ftyp = (brand: string) => box("ftyp", [...fourcc(brand.padEnd(4).slice(0, 4)), ...u32be(0)]);

describe("meta/isobmff parseIso6709", () => {
  it("parses signed coordinates with and without altitude", () => {
    expect(parseIso6709("+34.0679-118.4382+010.000/")).toMatchObject({ latitude: 34.0679, longitude: -118.4382, altitude: 10 });
    expect(parseIso6709("+34.0679-118.4382/")).toMatchObject({ latitude: 34.0679, longitude: -118.4382, altitude: null });
  });
  it("rejects malformed or out-of-range strings", () => {
    expect(parseIso6709("not a coordinate")).toBeNull();
    expect(parseIso6709("+91.0-10.0/")).toBeNull(); // latitude out of range
    expect(parseIso6709("+10.0-200.0/")).toBeNull(); // longitude out of range
  });
});

describe("meta/isobmff movie header", () => {
  const moovWith = (mvhdPayload: number[]) => [...ftyp("isom"), ...box("moov", box("mvhd", mvhdPayload))];
  const v0 = (created: number, modified: number, timescale: number, duration: number) =>
    [0, 0, 0, 0, ...u32be(created), ...u32be(modified), ...u32be(timescale), ...u32be(duration)];

  it("reads a version-0 header (hours duration)", () => {
    const created = 3755376000; // 2023-01-01 UTC
    const r = run("mp4", moovWith(v0(created, created, 1000, 3661000)));
    expect(val(r.fields, "Created")).toMatch(/^2023-01-01/);
    expect(val(r.fields, "Duration")).toBe("1h 01m 01s");
  });

  it("reads a version-1 header and rejects an absurd far-future time", () => {
    // created huge (> year 3000), modified valid, short duration (minutes).
    const modified = 3755376000;
    const v1 = [1, 0, 0, 0, ...u32be(0xffffffff), ...u32be(0xffffffff),
      ...u32be(0), ...u32be(modified), ...u32be(1), ...u32be(0), ...u32be(125)];
    const r = run("mp4", moovWith(v1));
    expect(val(r.fields, "Created")).toBeUndefined();
    expect(val(r.fields, "Modified")).toMatch(/^2023-01-01/);
    expect(val(r.fields, "Duration")).toBe("2m 05s");
  });

  it("skips unset (zero) and unreadable times, and a zero timescale", () => {
    // created 0 (<= epoch), timescale 0 -> no duration; seconds-only formatting via a second run.
    expect(val(run("mp4", moovWith(v0(0, 0, 0, 5))).fields, "Created")).toBeUndefined();
    expect(val(run("mp4", moovWith(v0(0, 0, 1000, 5000))).fields, "Duration")).toBe("5s");
    // Truncated mvhd: version present, no time fields.
    expect(run("mp4", moovWith([0, 0, 0, 0])).fields).toHaveLength(1); // just the Brand
    // Empty mvhd: version itself unreadable.
    expect(run("mp4", moovWith([])).fields).toHaveLength(1);
  });
});

describe("meta/isobmff location atom", () => {
  const moovXyz = (payload: number[]) => [...ftyp("qt  "), ...box("moov", box("udta", box("©xyz", payload)))];
  const xyz = (s: string) => [...u16be(s.length), ...u16be(0), ...bytesOf(s)];

  it("recovers a GPS fix from a ©xyz atom", () => {
    const r = run("mov", moovXyz(xyz("+37.3318-122.0312/")));
    expect(r.gps).toMatchObject({ latitude: 37.3318, longitude: -122.0312 });
    expect(val(r.fields, "Location")).toBe("+37.3318-122.0312/");
  });

  it("ignores truncated, empty or non-coordinate ©xyz payloads", () => {
    expect(run("mov", moovXyz([])).gps).toBeNull(); // length unreadable
    expect(run("mov", moovXyz([...u16be(4), ...u16be(0), 0, 0, 0, 0])).gps).toBeNull(); // string is NULs
    expect(run("mov", moovXyz(xyz("nonsense"))).gps).toBeNull(); // not ISO 6709
  });
});

describe("meta/isobmff Apple keyed metadata", () => {
  const keysBox = (names: string[]) => {
    const entries = names.flatMap((n) => [...u32be(8 + n.length), ...fourcc("mdta"), ...bytesOf(n)]);
    return box("keys", [...u32be(0), ...u32be(names.length), ...entries]);
  };
  // ISO-form meta: 4-byte version/flags header, then keys + ilst.
  const meta = (inner: number[]) => box("meta", [0, 0, 0, 0, ...inner]);

  it("maps keys to make/model/software/date and a keyed location", () => {
    const names = [
      "com.apple.quicktime.make",
      "com.apple.quicktime.model",
      "com.apple.quicktime.software",
      "com.apple.quicktime.creationdate",
      "com.apple.quicktime.location.ISO6709",
      "com.apple.unknownkey",
      "com.apple.quicktime.make", // 7: duplicate, but non-text data below
      "com.apple.quicktime.model", // 8: no data child below
    ];
    const ilst = box("ilst", [
      ...boxN(1, dataAtom("Apple")),
      ...boxN(2, dataAtom("iPhone 15 Pro")),
      ...boxN(3, dataAtom("17.1")),
      ...boxN(4, dataAtom("2023-11-02T10:00:00-0700")),
      ...boxN(5, dataAtom("+40.7128-074.0060/")),
      ...boxN(6, dataAtom("ignored")),      // key not in the table
      ...boxN(7, dataAtom("x", 21)),         // known key, non-text data -> skipped
      ...boxN(8, box("hdlr", [])),           // known key, no data child -> skipped
      ...boxN(99, dataAtom("orphan")),       // index beyond the keys table
      ...boxN(5, dataAtom("bogus location")), // keyed location that is not ISO 6709
    ]);
    const r = run("mp4", [...ftyp("isom"), ...box("moov", meta([...keysBox(names), ...ilst]))]);
    expect(val(r.fields, "Make")).toBe("Apple");
    expect(val(r.fields, "Model")).toBe("iPhone 15 Pro");
    expect(val(r.fields, "Software")).toBe("17.1");
    expect(val(r.fields, "Capture date")).toBe("2023-11-02T10:00:00-0700");
    expect(r.gps).toMatchObject({ latitude: 40.7128, longitude: -74.006 });
    // Make/model are sensitive, software is not.
    expect(r.fields.find((f) => f.label === "Make")?.sensitive).toBe(true);
    expect(r.fields.find((f) => f.label === "Software")?.sensitive).toBe(false);
  });

  it("handles the classic QuickTime meta layout (no version/flags)", () => {
    const classic = box("meta", [
      ...box("hdlr", [0, 0, 0, 0]),
      ...keysBox(["com.apple.quicktime.make"]),
      ...box("ilst", boxN(1, dataAtom("DJI"))),
    ]);
    const r = run("mov", [...ftyp("qt  "), ...box("moov", classic)]);
    expect(val(r.fields, "Make")).toBe("DJI");
  });

  it("stops reading keys at a malformed (undersized or overlong) entry", () => {
    // First key valid, second key size < 8 -> stop.
    const badKeys = box("keys", [...u32be(0), ...u32be(2),
      ...u32be(8 + 24), ...fourcc("mdta"), ...bytesOf("com.apple.quicktime.make"),
      ...u32be(4), 0, 0, 0, 0]); // entry declares size < 8 -> the walk stops
    const r = run("mp4", [...ftyp("isom"), ...box("moov", box("meta", [0, 0, 0, 0, ...badKeys, ...box("ilst", boxN(1, dataAtom("Sony")))]))]);
    expect(val(r.fields, "Make")).toBe("Sony");

    // A key whose declared size overruns the box -> name reads as empty.
    const overrun = box("keys", [...u32be(0), ...u32be(1), ...u32be(9999), ...fourcc("mdta"), ...bytesOf("x")]);
    const r2 = run("mp4", [...ftyp("isom"), ...box("moov", box("meta", [0, 0, 0, 0, ...overrun, ...box("ilst", boxN(1, dataAtom("y")))]))]);
    expect(val(r2.fields, "Make")).toBeUndefined();
  });
});

describe("meta/isobmff iTunes M4A tags", () => {
  it("reads ©-prefixed atoms and skips unknown or empty ones", () => {
    const ilst = box("ilst", [
      ...box("©nam", dataAtom("Song Title")),
      ...box("©ART", dataAtom("The Artist")),
      ...box("©too", dataAtom("Lavf")),
      ...box("free", dataAtom("noise")),   // unknown atom -> skipped
      ...box("©alb", box("hdlr", [])),      // known atom, no data child -> skipped
    ]);
    // udta > meta (ISO form) > hdlr + ilst, with NO keys box -> iTunes path.
    const meta = box("meta", [0, 0, 0, 0, ...box("hdlr", [0, 0, 0, 0]), ...ilst]);
    const r = run("m4a", [...ftyp("M4A "), ...box("moov", box("udta", meta))]);
    expect(val(r.fields, "Title")).toBe("Song Title");
    expect(val(r.fields, "Artist")).toBe("The Artist");
    expect(val(r.fields, "Encoder")).toBe("Lavf");
  });

  it("skips a meta box that has neither keys nor ilst", () => {
    const meta = box("meta", [0, 0, 0, 0, ...box("hdlr", [0, 0, 0, 0])]);
    const r = run("m4a", [...ftyp("M4A "), ...box("moov", box("udta", meta))]);
    expect(r.fields.map((f) => f.label)).toEqual(["Brand"]);
  });
});

describe("meta/isobmff HEIC / AVIF images", () => {
  const ispe = (w: number, h: number) => box("ispe", [0, 0, 0, 0, ...u32be(w), ...u32be(h)]);
  const iprp = (inner: number[]) => box("iprp", box("ipco", inner));
  const heifMeta = (inner: number[]) => box("meta", [0, 0, 0, 0, ...inner]);

  it("reads ispe dimensions and an embedded EXIF/GPS block", () => {
    const tiff = buildTiff({
      le: true,
      ifd0: [{ tag: 0x010f, type: 2, ascii: "Apple" }],
      gps: [
        { tag: 0x01, type: 2, ascii: "N" },
        { tag: 0x02, type: 5, rationals: [[48, 1], [51, 1], [0, 1]] },
        { tag: 0x03, type: 2, ascii: "E" },
        { tag: 0x04, type: 5, rationals: [[2, 1], [21, 1], [0, 1]] },
      ],
    });
    const exifItem = [...bytesOf("Exif\0\0"), ...tiff];
    const bytes = [...ftyp("heic"), ...heifMeta([...iprp(ispe(4032, 3024)), ...exifItem])];
    const r = run("heic", bytes);
    expect(r.image?.format).toBe("heic");
    expect([r.image?.width, r.image?.height]).toEqual([4032, 3024]);
    expect(r.image?.tags.make).toBe("Apple");
    expect(r.gps).toMatchObject({ latitude: 48.85 });
  });

  it("degrades cleanly: meta without ispe, and an Exif marker that is not a real TIFF", () => {
    const bytes = [...ftyp("avif"), ...heifMeta([...box("hdlr", []), ...bytesOf("Exif\0\0"), 1, 2, 3, 4])];
    const r = run("avif", bytes);
    expect(r.image?.format).toBe("avif");
    expect([r.image?.width, r.image?.height]).toEqual([null, null]);
    expect(r.image?.hasExif).toBe(false);
    expect(r.gps).toBeNull();
  });

  it("returns null image fields when there is no meta box at all", () => {
    const r = run("avif", ftyp("avif"));
    expect(r.image?.width).toBeNull();
    expect(r.image?.hasExif).toBe(false);
  });
});

describe("meta/isobmff top-level assembly and guards", () => {
  it("records the ftyp brand, and copes with a short ftyp or a missing moov", () => {
    expect(val(run("mp4", ftyp("mp42")).fields, "Brand")).toBe("mp42");
    // ftyp too short to hold a brand.
    expect(run("mp4", box("ftyp", [])).fields).toEqual([]);
    // No ftyp, no moov: nothing to read.
    expect(run("mp4", box("free", [1, 2, 3, 4])).fields).toEqual([]);
  });

  it("parses 64-bit and to-end box sizes, and stops on an undersized box", () => {
    // A moov declared with a 64-bit largesize (size32 == 1).
    const mvhd = box("mvhd", [0, 0, 0, 0, ...u32be(3755376000), ...u32be(0), ...u32be(1000), ...u32be(2000)]);
    const moovBody = fourcc("moov");
    const large = [...u32be(1), ...moovBody, ...u32be(0), ...u32be(16 + mvhd.length), ...mvhd];
    expect(val(run("mp4", [...ftyp("isom"), ...large]).fields, "Duration")).toBe("2s");

    // A box with size 0 extends to the end of the file.
    const toEnd = [...u32be(0), ...fourcc("moov"), ...mvhd];
    expect(val(run("mp4", [...ftyp("isom"), ...toEnd]).fields, "Duration")).toBe("2s");

    // A box whose declared size is < 8 halts the walk.
    const undersized = [...ftyp("isom"), ...u32be(4), ...fourcc("moov")];
    expect(run("mp4", undersized).fields).toEqual([{ label: "Brand", value: "isom", group: "Container" }]);

    // size32 == 1 but the largesize field itself is truncated.
    const truncLarge = [...ftyp("isom"), ...u32be(1), ...fourcc("moov"), 0, 0];
    expect(run("mp4", truncLarge).fields).toEqual([{ label: "Brand", value: "isom", group: "Container" }]);
  });

  it("stops descending past the depth limit", () => {
    // Nest ©xyz ten containers deep; findAll must give up before reaching it.
    let inner = box("©xyz", [...u16be(10), ...u16be(0), ...bytesOf("+1-1/")]);
    for (let i = 0; i < 10; i++) inner = box("udta", inner);
    const r = run("mp4", [...ftyp("isom"), ...box("moov", inner)]);
    expect(r.gps).toBeNull();
  });
});
