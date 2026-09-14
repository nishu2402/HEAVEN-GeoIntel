import { describe, it, expect } from "vitest";
import { deflateSync } from "node:zlib";
import { extractRaster, extractPng, extractJpeg, extractGif, extractBmp, extractWebp } from "@/lib/analysis/meta/raster";

const u16be = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u16le = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u32be = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const u32le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const A = (s: string) => [...s].map((c) => c.charCodeAt(0));
const U = (s: string) => [...new TextEncoder().encode(s)];
const U8 = (...parts: number[][]) => new Uint8Array(parts.flat());

const map = (r: { fields: { label: string; value: string }[] }) =>
  Object.fromEntries(r.fields.map((f) => [f.label, f.value]));

// ── PNG ──────────────────────────────────────────────────────────────────────

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const chunk = (type: string, data: number[]) => [...u32be(data.length), ...A(type), ...data, ...u32be(0)];
const ihdr = (extra: Partial<{ depth: number; colour: number; interlace: number }> = {}) =>
  chunk("IHDR", [
    ...u32be(64), ...u32be(48),
    extra.depth ?? 8, extra.colour ?? 6, 0, 0, extra.interlace ?? 0,
  ]);
const png = (...chunks: number[][]) => U8(PNG_SIG, ...chunks);

describe("meta/raster PNG", () => {
  it("reads the header, resolution, timestamp and colour profile", async () => {
    const file = png(
      ihdr({ depth: 16, colour: 2, interlace: 1 }),
      chunk("pHYs", [...u32be(11811), ...u32be(11811), 1]), // 11811 px/m = 300 DPI
      chunk("tIME", [...u16be(2024), 3, 7, 9, 5, 4]),
      chunk("iCCP", [...A("Display P3"), 0, 0, 1, 2, 3]),
      chunk("tEXt", [...A("Software"), 0, ...A("Adobe Photoshop 25.0")]),
      chunk("IDAT", [1, 2, 3]),
    );
    const f = map(await extractPng(file));
    expect(f["Bit depth"]).toBe("16 bits per channel");
    expect(f["Colour type"]).toBe("truecolour");
    expect(f["Interlaced"]).toBe("yes (Adam7)");
    expect(f["Resolution"]).toBe("300 DPI");
    expect(f["Last modified"]).toBe("2024-03-07 09:05:04");
    expect(f["Colour profile"]).toBe("Display P3");
    expect(f["Software"]).toBe("Adobe Photoshop 25.0");
  });

  it("reads every text-chunk form, including the compressed ones", async () => {
    const zip = (s: string) => [...deflateSync(Buffer.from(s))];
    const file = png(
      ihdr(),
      chunk("tEXt", [...A("Author"), 0, ...A("R. Mehta")]),
      chunk("zTXt", [...A("Comment"), 0, 0, ...zip("shot on the roof")]),
      chunk("iTXt", [...A("Description"), 0, 0, 0, ...A("en"), 0, ...A("Beskrivning"), 0, ...U("café façade")]),
      chunk("iTXt", [...A("Title"), 0, 1, 0, 0, 0, ...zip("Compressed title")]),
    );
    const f = map(await extractPng(file));
    expect(f["Author"]).toBe("R. Mehta");
    expect(f["Comment"]).toBe("shot on the roof");
    expect(f["Description"]).toBe("café façade"); // iTXt is UTF-8, not Latin-1
    expect(f["Title"]).toBe("Compressed title");
  });

  it("keeps an unregistered keyword under its own name", async () => {
    const f = map(await extractPng(png(ihdr(), chunk("tEXt", [...A("render-node"), 0, ...A("blade-07")]))));
    expect(f["render-node"]).toBe("blade-07");
  });

  it("surfaces image-generation parameters and says what they are", async () => {
    const prompt = "a lighthouse at dusk\\nSteps: 30, Sampler: DPM++, Seed: 41221, Model: sd_xl_base";
    const r = await extractPng(png(ihdr(), chunk("tEXt", [...A("parameters"), 0, ...A(prompt)])));
    expect(map(r)["Generation parameters"]).toContain("Seed: 41221");
    expect((r.notes ?? []).some((n) => /Stable Diffusion/.test(n))).toBe(true);
    // And the other two conventions the same tools use.
    expect(map(await extractPng(png(ihdr(), chunk("tEXt", [...A("prompt"), 0, ...A("x")]))))["Generation prompt"]).toBe("x");
    expect(map(await extractPng(png(ihdr(), chunk("tEXt", [...A("workflow"), 0, ...A("y")]))))["Generation workflow"]).toBe("y");
  });

  it("reports an APNG's frame count and loop behaviour", async () => {
    const looping = map(await extractPng(png(ihdr(), chunk("acTL", [...u32be(24), ...u32be(0)]))));
    expect(looping["Animation"]).toBe("24 frames, looping");
    const counted = map(await extractPng(png(ihdr(), chunk("acTL", [...u32be(8), ...u32be(3)]))));
    expect(counted["Animation"]).toBe("8 frames, 3 plays");
  });

  it("reads an XMP packet embedded in a PNG", async () => {
    const packet = '<x:xmpmeta><rdf:Description photoshop:City="Lisbon" dc:creator="A. Sousa"/></x:xmpmeta>';
    const f = map(await extractPng(png(ihdr(), chunk("iTXt", [...A("XML:com.adobe.xmp"), 0, 0, 0, 0, 0, ...A(packet)]))));
    expect(f["City"]).toBe("Lisbon");
    expect(f["Creator"]).toBe("A. Sousa");
  });

  it("says plainly when a PNG carries no text at all", async () => {
    const r = await extractPng(png(ihdr(), chunk("IDAT", [1])));
    expect((r.notes ?? []).some((n) => /no text chunk/.test(n))).toBe(true);
  });

  it("skips malformed chunks instead of inventing values", async () => {
    const r = await extractPng(png(
      chunk("IHDR", [1, 2, 3]),                       // too short to read
      chunk("pHYs", [...u32be(300), ...u32be(300), 2]), // unit is not metres
      chunk("pHYs", [...u32be(0), ...u32be(0), 1]),   // metres, but no resolution
      chunk("tIME", [1, 2]),
      chunk("acTL", [1, 2]),
      chunk("iCCP", [1, 2, 3]),                       // no NUL: no profile name
      chunk("tEXt", [...A("no separator here")]),      // no NUL: not a text chunk
      chunk("zTXt", [...A("no separator here")]),      // the same, compressed
      chunk("zTXt", [...A("Comment"), 0, 0, 9, 9, 9]), // not a zlib stream
      chunk("iTXt", [...A("Title"), 0]),               // truncated
      chunk("iTXt", [...A("Title"), 0, 0, 0, ...A("en")]), // missing separators
      chunk("iTXt", [...A("Title"), 0, 1, 0, 0, 0, 9, 9]), // flagged compressed, is not
    ));
    expect(r.fields).toHaveLength(0);
  });

  it("names a colour type the spec does not define as nothing at all", async () => {
    const f = map(await extractPng(png(ihdr({ colour: 7 }))));
    expect(f["Bit depth"]).toBe("8 bits per channel");
    expect(f["Colour type"]).toBeUndefined();
  });

  it("stops at a chunk whose declared length runs past the end of the file", async () => {
    const truncated = U8(PNG_SIG, [...u32be(9999), ...A("tEXt"), ...A("Author"), 0, ...A("cut")]);
    expect((await extractPng(truncated)).fields).toHaveLength(0);
  });

  it("caps a text value that would otherwise fill the panel", async () => {
    const huge = "x".repeat(20000);
    const f = map(await extractPng(png(ihdr(), chunk("tEXt", [...A("Comment"), 0, ...A(huge)]))));
    expect(f["Comment"]).toHaveLength(8193); // 8192 characters and the ellipsis
  });
});

// ── ICC profiles, in both the v2 and the v4 description layout ───────────────

/** A whole ICC profile whose one tag is `desc`, wrapped for a JPEG APP2. */
const iccProfile = (tagData: number[]) => [
  ...A("ICC_PROFILE"), 0, 1, 1,           // the APP2 identifier, sequence and count
  ...iccBody(tagData),
];
/** The profile itself: a 128-byte header, a one-entry tag table, then the tag. */
const iccBody = (tagData: number[]) => [
  ...new Array(128).fill(0),
  ...u32be(1), ...A("desc"), ...u32be(144), ...u32be(tagData.length),
  ...tagData,
];
/** ICC v2: "desc", a reserved word, an ASCII length, then the string. */
const descTag = (name: string) => [...A("desc"), ...u32be(0), ...u32be(name.length + 1), ...A(name), 0];
/** ICC v4: "mluc", one record naming a language and pointing at UTF-16BE text. */
const mlucTag = (name: string) => {
  const text = A(name).flatMap((c) => u16be(c));
  return [...A("mluc"), ...u32be(0), ...u32be(1), ...u32be(12), ...A("enUS"), ...u32be(text.length), ...u32be(28), ...text];
};

// ── JPEG ─────────────────────────────────────────────────────────────────────

const seg = (marker: number, body: number[]) => [0xff, marker, ...u16be(body.length + 2), ...body];
const sof = (marker = 0xc0, components = 3) =>
  seg(marker, [8, ...u16be(480), ...u16be(640), components, ...new Array(components * 3).fill(1)]);
const jpeg = (...parts: number[][]) => U8([0xff, 0xd8], ...parts, [0xff, 0xd9]);

describe("meta/raster JPEG", () => {
  it("reads the encoding, precision, colour model and JFIF resolution", () => {
    const file = jpeg(
      seg(0xe0, [...A("JFIF"), 0, 1, 2, 1, ...u16be(300), ...u16be(300), 0, 0]),
      sof(0xc2),
    );
    const f = map(extractJpeg(file));
    expect(f["Encoding"]).toBe("progressive");
    expect(f["Sample precision"]).toBe("8-bit");
    expect(f["Colour model"]).toBe("colour (YCbCr)");
    expect(f["Resolution"]).toBe("300 × 300 DPI");
  });

  it("reports a JFIF thumbnail, dots per centimetre and an unusual component count", () => {
    const f = map(extractJpeg(jpeg(
      seg(0xe0, [...A("JFIF"), 0, 1, 2, 2, ...u16be(40), ...u16be(40), 16, 16]),
      sof(0xc0, 2),
    )));
    expect(f["Resolution"]).toBe("40 × 40 dots per cm");
    expect(f["Embedded thumbnail"]).toBe("16 × 16 px");
    expect(f["Colour model"]).toBe("2 components");
  });

  it("names the other encodings the format defines", () => {
    for (const [marker, name] of [[0xc1, "extended sequential"], [0xc3, "lossless"], [0xc9, "arithmetic extended sequential"], [0xca, "arithmetic progressive"]] as const) {
      expect(map(extractJpeg(jpeg(sof(marker))))["Encoding"]).toBe(name);
    }
    expect(map(extractJpeg(jpeg(sof(0xc0, 1))))["Colour model"]).toBe("greyscale");
    expect(map(extractJpeg(jpeg(sof(0xc0, 4))))["Colour model"]).toBe("CMYK / YCCK");
  });

  it("reads the IPTC block a picture desk fills in", () => {
    const iim = (dataset: number, value: string) => [0x1c, 2, dataset, ...u16be(value.length), ...A(value)];
    const file = jpeg(seg(0xed, [
      ...A("Photoshop 3.0"), 0, ...A("8BIM"), 0x04, 0x04, 0, 0, ...u32be(0),
      ...iim(80, "Lucia Ferrara"),
      ...iim(110, "Reuters"),
      ...iim(90, "Trieste"),
      ...iim(101, "Italy"),
      ...iim(120, "Crowds gather at the port."),
      ...iim(25, "port"),
      ...iim(25, "protest"),
      ...iim(3, "an unmapped dataset"),
    ]));
    const r = extractJpeg(file);
    const f = map(r);
    expect(f["Photographer"]).toBe("Lucia Ferrara");
    expect(f["Credit"]).toBe("Reuters");
    expect(f["City"]).toBe("Trieste");
    expect(f["Country"]).toBe("Italy");
    expect(f["Caption"]).toBe("Crowds gather at the port.");
    expect(f["Keywords"]).toBe("port, protest"); // a repeated dataset keeps both
    expect(r.fields.find((x) => x.label === "Photographer")?.sensitive).toBe(true);
    expect(r.fields.find((x) => x.label === "Credit")?.sensitive).toBeUndefined();
  });

  it("names the colour profile in both ICC layouts", () => {
    const v2 = extractJpeg(jpeg(seg(0xe2, iccProfile(descTag("sRGB builtin")))));
    expect(map(v2)["Colour profile"]).toBe("sRGB builtin");
    const v4 = extractJpeg(jpeg(seg(0xe2, iccProfile(mlucTag("Display P3")))));
    expect(map(v4)["Colour profile"]).toBe("Display P3");
  });

  it("reads comments, the Adobe marker and a multi-picture block", () => {
    const r = extractJpeg(jpeg(
      seg(0xfe, A("first note")),
      seg(0xfe, A("second note")),
      seg(0xee, [...A("Adobe"), 0, 100, 0, 0, 0, 0, 1]),
      seg(0xe2, [...A("MPF"), 0, 1, 2, 3]),
      sof(),
    ));
    const f = map(r);
    expect(f["Comment"]).toBe("first note | second note");
    expect(f["Written by"]).toBe("Adobe (APP14 colour transform present)");
    expect((r.notes ?? []).some((n) => /Multi-Picture/.test(n))).toBe(true);
  });

  it("reads an XMP packet out of an APP1 segment", () => {
    const packet = '<x:xmpmeta><rdf:Description aux:SerialNumber="042917000123" GPano:ProjectionType="equirectangular"/></x:xmpmeta>';
    const f = map(extractJpeg(jpeg(seg(0xe1, [...A("http://ns.adobe.com/xap/1.0/"), 0, ...A(packet)]))));
    expect(f["Camera serial"]).toBe("042917000123");
    expect(f["Panorama projection"]).toBe("equirectangular");
  });

  it("walks past a fill byte and stops at the compressed scan", () => {
    const f = map(extractJpeg(U8([0xff, 0xd8], [0xff], sof(), seg(0xda, [1, 2]), A("entropy coded data"))));
    expect(f["Encoding"]).toBe("baseline");
  });

  it("stops on a segment that is not a marker, and on one shorter than its length", () => {
    expect(extractJpeg(U8([0xff, 0xd8], [0x00, 0x01, 0x02, 0x03])).fields).toHaveLength(0);
    expect(extractJpeg(U8([0xff, 0xd8], [0xff, 0xe0, 0x00, 0x01])).fields).toHaveLength(0);
    expect(extractJpeg(U8([0xff, 0xd8], [0xff, 0xd9])).fields).toHaveLength(0);
  });

  it("ignores an APP13 that is not Photoshop and a JFIF with an unknown unit", () => {
    expect(extractJpeg(jpeg(seg(0xed, A("Something else entirely")))).fields).toHaveLength(0);
    const f = map(extractJpeg(jpeg(seg(0xe0, [...A("JFIF"), 0, 1, 2, 9, ...u16be(1), ...u16be(1), 0, 0]))));
    expect(f["Resolution"]).toBeUndefined();
  });

  it("reads nothing from a segment that ends inside its own fields", () => {
    // A start-of-frame header cut off after its marker: no precision, no
    // component count, so neither is reported and nothing is guessed.
    const f = map(extractJpeg(U8([0xff, 0xd8], [0xff, 0xc0, 0x00, 0x02])));
    expect(f["Encoding"]).toBe("baseline");
    expect(f["Sample precision"]).toBeUndefined();
    expect(f["Colour model"]).toBeUndefined();
    // An empty comment segment contributes no comment.
    expect(map(extractJpeg(jpeg(seg(0xfe, []), sof())))["Comment"]).toBeUndefined();
    // Data appended after the end-of-image marker is not read as segments.
    const trailing = U8([0xff, 0xd8], sof(), [0xff, 0xd9], A("appended junk"));
    expect(map(extractJpeg(trailing))["Encoding"]).toBe("baseline");
  });

  it("gives up on an ICC profile it cannot read rather than half-reading it", () => {
    const short = [...A("ICC_PROFILE"), 0, 1, 1, ...new Array(128).fill(0), ...u32be(9999)];
    expect(map(extractJpeg(jpeg(seg(0xe2, short))))["Colour profile"]).toBeUndefined();
    const noDesc = [...A("ICC_PROFILE"), 0, 1, 1, ...new Array(128).fill(0), ...u32be(1), ...A("wtpt"), ...u32be(144), ...u32be(4), 0, 0, 0, 0];
    expect(map(extractJpeg(jpeg(seg(0xe2, noDesc))))["Colour profile"]).toBeUndefined();
    const unknownType = [...A("ICC_PROFILE"), 0, 1, 1, ...new Array(128).fill(0), ...u32be(1), ...A("desc"), ...u32be(144), ...u32be(8), ...A("zzzz"), 0, 0, 0, 0];
    expect(map(extractJpeg(jpeg(seg(0xe2, unknownType))))["Colour profile"]).toBeUndefined();
    // A tag table whose entry ends before its offset, a desc with no string
    // after it, and an mluc whose record or text runs past the segment.
    const cutEntry = [...A("ICC_PROFILE"), 0, 1, 1, ...new Array(128).fill(0), ...u32be(1), ...A("desc")];
    expect(map(extractJpeg(jpeg(seg(0xe2, cutEntry))))["Colour profile"]).toBeUndefined();
    const cutDesc = [...A("ICC_PROFILE"), 0, 1, 1, ...new Array(128).fill(0), ...u32be(1), ...A("desc"), ...u32be(144), ...u32be(4), ...A("desc")];
    expect(map(extractJpeg(jpeg(seg(0xe2, cutDesc))))["Colour profile"]).toBeUndefined();
    const cutMluc = [...A("ICC_PROFILE"), 0, 1, 1, ...new Array(128).fill(0), ...u32be(1), ...A("desc"), ...u32be(144), ...u32be(4), ...A("mluc")];
    expect(map(extractJpeg(jpeg(seg(0xe2, cutMluc))))["Colour profile"]).toBeUndefined();
    const farText = [...A("ICC_PROFILE"), 0, 1, 1, ...iccBody([...A("mluc"), ...u32be(0), ...u32be(1), ...u32be(12), ...A("enUS"), ...u32be(8), ...u32be(9000)])];
    expect(map(extractJpeg(jpeg(seg(0xe2, farText))))["Colour profile"]).toBeUndefined();
    const blankText = [...A("ICC_PROFILE"), 0, 1, 1, ...iccBody([...A("mluc"), ...u32be(0), ...u32be(1), ...u32be(12), ...A("enUS"), ...u32be(4), ...u32be(28), 0, 0, 0, 0])];
    expect(map(extractJpeg(jpeg(seg(0xe2, blankText))))["Colour profile"]).toBeUndefined();
  });
});

// ── GIF ──────────────────────────────────────────────────────────────────────

const gifHeader = (version = "GIF89a", globalPalette = true) => [
  ...A(version), ...u16le(16), ...u16le(16),
  globalPalette ? 0x80 | 0x01 : 0x00, 0, 0,
  ...(globalPalette ? new Array(3 * 4).fill(0) : []),
];
const subBlocks = (data: number[]) => [data.length, ...data, 0];
/** The NETSCAPE2.0 loop extension: an 11-byte name block, then a 3-byte count. */
const loopExt = (n: number) => [0x21, 0xff, 11, ...A("NETSCAPE2.0"), 3, 0x01, ...u16le(n), 0];
const frame = () => [0x2c, ...u16le(0), ...u16le(0), ...u16le(16), ...u16le(16), 0x00, 0x02, ...subBlocks([1, 2])];

describe("meta/raster GIF", () => {
  it("counts frames and reads the delay, loop count and comment", () => {
    const file = U8(
      gifHeader(),
      loopExt(0),
      [0x21, 0xf9], subBlocks([0x04, ...u16le(50), 0, 0]),
      frame(),
      [0x21, 0xf9], subBlocks([0x04, ...u16le(50), 0, 0]),
      frame(),
      [0x21, 0xfe], subBlocks(A("made with a screen recorder")),
      [0x3b],
    );
    const f = map(extractGif(file));
    expect(f["Version"]).toBe("GIF89a");
    expect(f["Palette"]).toBe("4 colours (global)");
    expect(f["Frames"]).toBe("2");
    expect(f["Duration"]).toBe("1.00 s");
    expect(f["Loops"]).toBe("forever");
    expect(f["Comment"]).toBe("made with a screen recorder");
  });

  it("reports a finite loop count and a file with no global palette", () => {
    const file = U8(
      gifHeader("GIF87a", false),
      loopExt(3),
      frame(),
      [0x3b],
    );
    const f = map(extractGif(file));
    expect(f["Version"]).toBe("GIF87a");
    expect(f["Palette"]).toBeUndefined();
    expect(f["Loops"]).toBe("3");
    expect(f["Frames"]).toBe("1");
    expect(f["Duration"]).toBeUndefined(); // a single frame has no playback length
  });

  it("reads nothing from a GIF too short to hold a screen descriptor", () => {
    expect(extractGif(new Uint8Array(3)).fields).toHaveLength(0);
  });

  it("stops at a truncated frame, sub-block or loop extension", () => {
    // An image descriptor cut off before its packed flags byte.
    expect(map(extractGif(U8(gifHeader(), [0x2c, 0, 0])))["Frames"]).toBe("1");
    // A sub-block claiming more bytes than the file holds.
    expect(map(extractGif(U8(gifHeader(), [0x21, 0xfe, 40, 1, 2, 3])))["Comment"]).toBeUndefined();
    // A NETSCAPE extension too short to carry a loop count.
    expect(map(extractGif(U8(gifHeader(), [0x21, 0xff], subBlocks(A("NETSCAPE")), [0x3b])))["Loops"]).toBeUndefined();
  });

  it("handles a local colour table and stops at a byte that is not a block", () => {
    const localFrame = [0x2c, ...u16le(0), ...u16le(0), ...u16le(4), ...u16le(4), 0x80 | 0x01, 0x02, ...subBlocks([1])];
    const file = U8(gifHeader(), localFrame, [0x99]);
    expect(map(extractGif(file))["Frames"]).toBe("1");
  });
});

// ── BMP and WebP ─────────────────────────────────────────────────────────────

describe("meta/raster BMP", () => {
  it("reads depth, compression, resolution and palette size", () => {
    const file = U8(
      A("BM"), u32le(0), u32le(0), u32le(54),
      u32le(40), u32le(64), u32le(48), u16le(1), u16le(24), u32le(3),
      u32le(0), u32le(2835), u32le(2835), u32le(256), u32le(0),
    );
    const f = map(extractBmp(file));
    expect(f["Bit depth"]).toBe("24 bits per pixel");
    expect(f["Compression"]).toBe("bitfields");
    expect(f["Resolution"]).toBe("72 DPI");
    expect(f["Palette"]).toBe("256 colours");
  });

  it("reads nothing from the legacy 12-byte header, a stub, or absent values", () => {
    expect(extractBmp(U8(A("BM"), u32le(0), u32le(0), u32le(26), u32le(12))).fields).toHaveLength(0);
    expect(extractBmp(new Uint8Array(6)).fields).toHaveLength(0); // no header at all
    // A modern header the file ends inside: nothing after the depth is readable.
    expect(extractBmp(U8(A("BM"), u32le(0), u32le(0), u32le(54), u32le(40), u32le(4), u32le(4), u16le(1), u16le(8))).fields).toHaveLength(1);
    const bare = U8(
      A("BM"), u32le(0), u32le(0), u32le(54),
      u32le(40), u32le(4), u32le(4), u16le(1), u16le(0), u32le(99),
      u32le(0), u32le(0), u32le(0), u32le(0), u32le(0),
    );
    expect(extractBmp(bare).fields).toHaveLength(0); // depth 0, unknown compression, no DPI
  });
});

describe("meta/raster WebP", () => {
  const riff = (...chunks: number[][]) => {
    const body = [...A("WEBP"), ...chunks.flat()];
    return U8(A("RIFF"), u32le(body.length), body);
  };
  const webpChunk = (fourcc: string, data: number[]) =>
    [...A(fourcc.padEnd(4)), ...u32le(data.length), ...data, ...(data.length & 1 ? [0] : [])];

  it("reports an animation with alpha, its frames, duration and loop count", () => {
    const file = riff(
      webpChunk("VP8X", [0x10 | 0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      webpChunk("ANIM", [...u32le(0xffffff), ...u16le(0)]),
      webpChunk("ANMF", [...new Array(12).fill(0), ...u32le(500)]),
      webpChunk("ANMF", [...new Array(12).fill(0), ...u32le(500)]),
    );
    const f = map(extractWebp(file));
    expect(f["Encoding"]).toBe("alpha channel, animated");
    expect(f["Frames"]).toBe("2");
    expect(f["Duration"]).toBe("1.00 s");
    expect(f["Loops"]).toBe("forever");
  });

  it("names lossy and lossless stills and reads a finite loop count", () => {
    expect(map(extractWebp(riff(webpChunk("VP8L", [0x2f, 0, 0, 0, 0]))))["Encoding"]).toBe("lossless");
    expect(map(extractWebp(riff(webpChunk("VP8 ", [0, 0, 0]))))["Encoding"]).toBe("lossy");
    const looped = riff(webpChunk("ANIM", [...u32le(0), ...u16le(5)]));
    expect(map(extractWebp(looped))["Loops"]).toBe("5");
  });

  it("reads nothing from chunks that carry nothing", () => {
    // VP8X with no flags set, an ANMF and an XMP chunk the file ends inside.
    const f = map(extractWebp(riff(
      webpChunk("VP8X", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      webpChunk("ANIM", [0, 0]),      // too short to hold a loop count
      webpChunk("ANMF", [0, 0, 0, 0]), // too short to be a frame
      webpChunk("XMP", []),
      webpChunk("EXIF", [1, 2, 3]),    // a chunk this reader does not decode
    )));
    expect(f["Encoding"]).toBeUndefined();
    expect(f["Frames"]).toBeUndefined();
    expect(f["Duration"]).toBeUndefined();
    expect(f["Loops"]).toBeUndefined();
    // A frame chunk whose declared length the file does not actually hold.
    const cut = U8(A("RIFF"), u32le(28), A("WEBP"), A("ANMF"), u32le(16), new Array(8).fill(0));
    expect(map(extractWebp(cut))["Duration"]).toBeUndefined();
    // A VP8X chunk with no payload at all.
    expect(extractWebp(riff(webpChunk("VP8X", []))).fields).toHaveLength(0);
  });

  it("reads a colour profile and an XMP packet from their own chunks", () => {
    expect(map(extractWebp(riff(webpChunk("ICCP", iccBody(descTag("Rec2020"))))))["Colour profile"]).toBe("Rec2020");
    const packet = '<x:xmpmeta><rdf:Description dc:rights="CC BY 4.0"/></x:xmpmeta>';
    expect(map(extractWebp(riff(webpChunk("XMP", A(packet)))))["Rights"]).toBe("CC BY 4.0");
    // A chunk that holds no packet adds nothing.
    expect(extractWebp(riff(webpChunk("XMP", A("not xmp")))).fields).toHaveLength(0);
  });
});

describe("meta/raster dispatch", () => {
  it("routes each kind to its reader and returns nothing for the rest", async () => {
    expect((await extractRaster("png", png(ihdr()))).fields.length).toBeGreaterThan(0);
    expect((await extractRaster("jpeg", jpeg(sof()))).fields.length).toBeGreaterThan(0);
    expect((await extractRaster("gif", U8(gifHeader(), frame(), [0x3b]))).fields.length).toBeGreaterThan(0);
    expect((await extractRaster("bmp", U8(A("BM"), u32le(0), u32le(0), u32le(54), u32le(40), u32le(4), u32le(4), u16le(1), u16le(8), u32le(0), u32le(0), u32le(0), u32le(0), u32le(0), u32le(0)))).fields.length).toBeGreaterThan(0);
    expect((await extractRaster("webp", U8(A("RIFF"), u32le(4), A("WEBP")))).fields).toHaveLength(0);
    expect((await extractRaster("tiff", new Uint8Array(8))).fields).toHaveLength(0);
  });
});
