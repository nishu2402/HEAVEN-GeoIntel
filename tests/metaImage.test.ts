import { describe, it, expect } from "vitest";
import { extractImage } from "@/lib/analysis/meta/image";
import { asciiBytes } from "@/lib/analysis/meta/bytes";
import { buildTiff } from "./exifFixtures";

const A = (s: string) => asciiBytes(s);
function cat(...parts: (number[] | Uint8Array)[]): Uint8Array {
  const flat: number[] = [];
  for (const p of parts) flat.push(...Array.from(p));
  return new Uint8Array(flat);
}
const u16le = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u32le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const u24le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];

describe("meta/image GIF", () => {
  it("reads logical-screen dimensions", () => {
    const gif = cat(A("GIF89a"), u16le(320), u16le(240), [0x80, 0, 0]);
    const m = extractImage("gif", gif)!;
    expect(m.format).toBe("gif");
    expect([m.width, m.height]).toEqual([320, 240]);
    expect(m.hasExif).toBe(false);
  });
});

describe("meta/image BMP", () => {
  const bmp = (dib: number[], w: number[], h: number[], bpp: number[]) =>
    cat(A("BM"), u32le(0), u32le(0), u32le(54), dib, w, h, [1, 0], bpp);

  it("reads BITMAPINFOHEADER dimensions (bottom-up)", () => {
    const m = extractImage("bmp", bmp(u32le(40), u32le(800), u32le(600), u16le(24)))!;
    expect([m.width, m.height]).toEqual([800, 600]);
  });
  it("interprets a negative height as top-down row order", () => {
    const m = extractImage("bmp", bmp(u32le(40), u32le(800), u32le(0xffffffff - 600 + 1), u16le(24)))!;
    expect(m.height).toBe(600);
  });
  it("reads the legacy BITMAPCOREHEADER (16-bit dims)", () => {
    const core = cat(A("BM"), u32le(0), u32le(0), u32le(26), u32le(12), u16le(64), u16le(48));
    const m = extractImage("bmp", core)!;
    expect([m.width, m.height]).toEqual([64, 48]);
  });
  it("degrades to null dimensions on a truncated header", () => {
    const m = extractImage("bmp", cat(A("BM"), [0, 0]))!;
    expect([m.width, m.height]).toEqual([null, null]);
  });
});

describe("meta/image TIFF", () => {
  it("reads dimensions from IFD0 and the embedded EXIF/GPS", () => {
    const tiff = buildTiff({
      le: true,
      ifd0: [
        { tag: 0x0100, type: 3, ints: [640] }, // ImageWidth (SHORT)
        { tag: 0x0101, type: 4, ints: [480] }, // ImageLength (LONG)
        { tag: 0x010f, type: 2, ascii: "NIKON" }, // Make (an "other" tag)
      ],
      gps: [
        { tag: 0x01, type: 2, ascii: "N" },
        { tag: 0x02, type: 5, rationals: [[51, 1], [30, 1], [0, 1]] },
        { tag: 0x03, type: 2, ascii: "W" },
        { tag: 0x04, type: 5, rationals: [[0, 1], [7, 1], [0, 1]] },
      ],
    });
    const m = extractImage("tiff", new Uint8Array(tiff))!;
    expect([m.width, m.height]).toEqual([640, 480]);
    expect(m.hasExif).toBe(true);
    expect(m.tags.make).toBe("NIKON");
    expect(m.gps?.latitude).toBeCloseTo(51.5, 5);
  });

  it("handles big-endian TIFF and truncated variants", () => {
    const be = buildTiff({ le: false, ifd0: [{ tag: 0x0100, type: 4, ints: [1024] }] });
    expect(extractImage("tiff", new Uint8Array(be))!.width).toBe(1024);
    // IFD0 offset unreadable.
    expect(extractImage("tiff", new Uint8Array(A("II\x2a\0")))!.width).toBeNull();
    // IFD0 offset points past the buffer -> entry count unreadable.
    expect(extractImage("tiff", cat(A("II\x2a\0"), u32le(0xffff)))!.width).toBeNull();
    // An entry runs off the end mid-record -> the walk stops cleanly.
    const broken = cat(A("II\x2a\0"), u32le(8), u16le(1), [0x00, 0x01]);
    expect(extractImage("tiff", broken)!.width).toBeNull();
  });
});

describe("meta/image WebP", () => {
  const chunk = (fourcc: string, data: number[]) =>
    cat(A(fourcc), u32le(data.length), data, data.length & 1 ? [0] : []);
  const webp = (...chunks: Uint8Array[]) => cat(A("RIFF"), u32le(0), A("WEBP"), ...chunks);

  it("reads VP8X canvas dimensions and an EXIF/GPS block", () => {
    const exif = buildTiff({
      le: true,
      ifd0: [{ tag: 0x0110, type: 2, ascii: "Pixel 8" }],
      gps: [
        { tag: 0x01, type: 2, ascii: "S" },
        { tag: 0x02, type: 5, rationals: [[33, 1], [52, 1], [0, 1]] },
        { tag: 0x03, type: 2, ascii: "E" },
        { tag: 0x04, type: 5, rationals: [[151, 1], [12, 1], [0, 1]] },
      ],
    });
    const m = extractImage("webp", webp(
      chunk("VP8X", [0, 0, 0, 0, ...u24le(99), ...u24le(49)]),
      chunk("EXIF", exif),
    ))!;
    expect([m.width, m.height]).toEqual([100, 50]);
    expect(m.tags.model).toBe("Pixel 8");
    expect(m.gps?.latitude).toBeCloseTo(-33.8667, 3);
  });

  it("reads VP8L (lossless) dimensions", () => {
    const bits = 99 | (49 << 14); // (width-1) | (height-1 << 14)
    const m = extractImage("webp", webp(chunk("VP8L", [0x2f, ...u32le(bits)])))!;
    expect([m.width, m.height]).toEqual([100, 50]);
  });

  it("reads VP8 (lossy) dimensions and ignores unknown chunks", () => {
    const m = extractImage("webp", webp(
      chunk("ICCP", [1, 2, 3]),
      chunk("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, ...u16le(100), ...u16le(50)]),
    ))!;
    expect([m.width, m.height]).toEqual([100, 50]);
  });

  it("degrades to null dimensions when a chunk header is truncated", () => {
    expect(extractImage("webp", webp())!.width).toBeNull();
    // VP8X fourcc + size present, payload missing -> dimension reads return null.
    const truncX = cat(A("RIFF"), u32le(0), A("WEBP"), A("VP8X"), u32le(10));
    expect(extractImage("webp", truncX)!.width).toBeNull();
    const truncL = cat(A("RIFF"), u32le(0), A("WEBP"), A("VP8L"), u32le(10));
    expect(extractImage("webp", truncL)!.width).toBeNull();
    const truncV = cat(A("RIFF"), u32le(0), A("WEBP"), A("VP8 "), u32le(10));
    expect(extractImage("webp", truncV)!.height).toBeNull();
  });
});

describe("meta/image dispatch", () => {
  it("returns null for kinds it does not handle", () => {
    expect(extractImage("jpeg", new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
  });
});
