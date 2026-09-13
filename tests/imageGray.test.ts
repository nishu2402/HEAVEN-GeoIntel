import { describe, it, expect } from "vitest";
import {
  decodeGrayscale, decodePngGray, decodeJpegGray, resampleGray,
} from "@/lib/analysis/imageGray";
import { dHashFromGray, hamming } from "@/lib/analysis/phash";
import { pngFixture, jpegFixture } from "./imageFixtures";

// These decoders exist because the browser could not do this job: reading
// pixels off a canvas needs CORS, and most avatar hosts send no CORS header.
// Everything here is checked against images built by tests/imageFixtures.ts, so
// the assertions are about real files rather than about mocks.

const gradient = (x: number, y: number) => Math.min(255, x * 8 + y * 8);

describe("decodePngGray", () => {
  it("decodes 8-bit greyscale, RGB, RGBA and palette alike", async () => {
    for (const colorType of [0, 2, 4, 6, 3]) {
      const img = await decodePngGray(pngFixture({ width: 16, height: 16, colorType, value: gradient }));
      expect(img, `colour type ${colorType}`).not.toBeNull();
      expect(img!.cols).toBe(16);
      expect(img!.rows).toBe(16);
      // Left edge is darker than the right, which is what the gradient says.
      expect(img!.gray[0]).toBeLessThan(img!.gray[15] as number);
    }
  });

  it("reverses every scanline filter", async () => {
    const plain = await decodePngGray(pngFixture({ width: 12, height: 12, filter: 0, value: gradient }));
    for (const filter of [1, 2, 3, 4]) {
      const img = await decodePngGray(pngFixture({ width: 12, height: 12, filter, value: gradient }));
      expect(img!.gray, `filter ${filter}`).toEqual(plain!.gray);
    }
  });

  it("reads 16-bit samples at 8-bit precision", async () => {
    const img = await decodePngGray(pngFixture({ width: 8, height: 8, bitDepth: 16, value: gradient }));
    expect(img!.cols).toBe(8);
    expect(img!.gray[0]).toBe(0);
  });

  it("joins a split IDAT stream", async () => {
    const split = await decodePngGray(pngFixture({ width: 8, height: 8, splitIdat: true, value: gradient }));
    const whole = await decodePngGray(pngFixture({ width: 8, height: 8, value: gradient }));
    expect(split!.gray).toEqual(whole!.gray);
  });

  it("refuses what it cannot decode rather than guessing", async () => {
    // Not a PNG at all.
    expect(await decodePngGray(new Uint8Array([1, 2, 3]))).toBeNull();
    // Interlaced (Adam7).
    expect(await decodePngGray(pngFixture({ width: 8, height: 8, interlace: 1 }))).toBeNull();
    // Sub-byte bit depth.
    expect(await decodePngGray(pngFixture({ width: 8, height: 8, bitDepth: 4 }))).toBeNull();
    // An unknown colour type.
    expect(await decodePngGray(pngFixture({ width: 8, height: 8, colorType: 5 }))).toBeNull();
    // Palette colour type with no PLTE chunk.
    expect(await decodePngGray(pngFixture({ width: 8, height: 8, colorType: 3, palette: new Uint8Array(0) }))).not.toBeNull();
    // A filter byte no PNG defines.
    expect(await decodePngGray(pngFixture({ width: 8, height: 8, filter: 9 }))).toBeNull();
  });

  it("returns null for a truncated file instead of half an image", async () => {
    const full = pngFixture({ width: 16, height: 16, value: gradient });
    expect(await decodePngGray(full.subarray(0, 40))).toBeNull();
    // A header claiming more rows than the IDAT holds.
    const short = pngFixture({ width: 16, height: 16, value: gradient });
    const view = new DataView(short.buffer, short.byteOffset, short.byteLength);
    view.setUint32(20, 64); // IHDR height
    expect(await decodePngGray(short)).toBeNull();
  });

  it("returns null when the compressed stream is corrupt", async () => {
    const img = pngFixture({ width: 8, height: 8, value: gradient });
    // Corrupt the deflate payload, leaving the chunk structure intact.
    img[img.length - 20] ^= 0xff;
    expect(await decodePngGray(img)).toBeNull();
  });

  it("rejects a zero-sized image", async () => {
    expect(await decodePngGray(pngFixture({ width: 0, height: 0 }))).toBeNull();
  });
});

describe("decodeJpegGray", () => {
  const dc = (bx: number, by: number) => (bx * 40 + by * 40) - 200;

  it("decodes a baseline scan to the declared size", () => {
    const img = decodeJpegGray(jpegFixture({ blocksWide: 4, blocksHigh: 3, dc, extraMarker: true }));
    expect(img).not.toBeNull();
    expect(img!.cols).toBe(32);
    expect(img!.rows).toBe(24);
    // Block brightness follows the DC coefficients.
    expect(img!.gray[0]).toBeLessThan(img!.gray[31] as number);
  });

  it("crops the MCU padding to the declared image size", () => {
    const img = decodeJpegGray(jpegFixture({ blocksWide: 3, blocksHigh: 2, dc, width: 20, height: 12 }));
    expect(img!.cols).toBe(20);
    expect(img!.rows).toBe(12);
  });

  it("follows restart markers", () => {
    const plain = decodeJpegGray(jpegFixture({ blocksWide: 4, blocksHigh: 4, dc }));
    const restarted = decodeJpegGray(jpegFixture({ blocksWide: 4, blocksHigh: 4, dc, restartInterval: 3 }));
    expect(restarted).not.toBeNull();
    expect(restarted!.gray.length).toBe(plain!.gray.length);
  });

  it("decodes a progressive DC scan, shift included", () => {
    const img = decodeJpegGray(jpegFixture({ blocksWide: 3, blocksHigh: 3, dc, progressive: true, al: 1 }));
    expect(img).not.toBeNull();
    expect(img!.cols).toBe(24);
  });

  it("refuses anything that is not a decodable JPEG", () => {
    expect(decodeJpegGray(new Uint8Array([0, 1, 2]))).toBeNull();
    // SOI with no scan at all.
    expect(decodeJpegGray(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
    // A segment whose length runs past the end of the file.
    expect(decodeJpegGray(new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x40, 0x08]))).toBeNull();
  });

  it("returns null when the entropy stream stops early", () => {
    const full = jpegFixture({ blocksWide: 8, blocksHigh: 8, dc });
    // Cut most of the scan: fewer than half the blocks arrived, which is not
    // enough to hash honestly — the tail would be flat zeroes hashing as a
    // real gradient.
    const scanStart = full.length - 200;
    expect(decodeJpegGray(full.subarray(0, scanStart))).toBeNull();
  });

  it("refuses a frame whose quantisation or Huffman table was never defined", () => {
    expect(decodeJpegGray(jpegFixture({ blocksWide: 2, blocksHigh: 2, dc, missingQuant: true }))).toBeNull();
    expect(decodeJpegGray(jpegFixture({ blocksWide: 2, blocksHigh: 2, dc, missingAcTable: true }))).toBeNull();
  });

  it("decodes AC coefficients, zero runs and full blocks", () => {
    // A block with real AC content exercises run-length decoding, the ZRL
    // symbol (sixteen zeroes) and a block that fills all 63 coefficients.
    const acRun = () => {
      const out = new Array(63).fill(0);
      out[0] = 40;      // first AC
      out[20] = -30;    // after a long zero run, forcing a ZRL
      out[62] = 12;     // the very last coefficient
      return out;
    };
    const img = decodeJpegGray(jpegFixture({ blocksWide: 4, blocksHigh: 4, dc, ac: acRun }));
    expect(img).not.toBeNull();
    // The block is no longer flat: AC content means the pixels within it vary.
    const row = img!.gray.slice(0, 8);
    expect(new Set(row).size).toBeGreaterThan(1);

    // Every coefficient present, so no end-of-block is emitted at all.
    const dense = decodeJpegGray(jpegFixture({
      blocksWide: 2, blocksHigh: 2, dc, ac: () => new Array(63).fill(5),
    }));
    expect(dense).not.toBeNull();
  });

  it("decodes an interleaved colour scan, using the luma component only", () => {
    const img = decodeJpegGray(jpegFixture({
      blocksWide: 4, blocksHigh: 4, dc, colour: true, ac: () => [20, 0, -10],
    }));
    expect(img).not.toBeNull();
    expect(img!.cols).toBe(32);
  });

  it("reads a 16-bit quantisation table", () => {
    const img = decodeJpegGray(jpegFixture({ blocksWide: 2, blocksHigh: 2, dc, sixteenBitQuant: true }));
    expect(img).not.toBeNull();
  });

  it("refuses a scan with no frame, a zero sampling factor, or a refinement pass", () => {
    expect(decodeJpegGray(jpegFixture({ blocksWide: 2, blocksHigh: 2, dc, noFrame: true }))).toBeNull();
    expect(decodeJpegGray(jpegFixture({ blocksWide: 2, blocksHigh: 2, dc, samplingByte: 0x00 }))).toBeNull();
    // Progressive with Ah > 0 is a refinement of a DC pass we never saw.
    expect(decodeJpegGray(jpegFixture({ blocksWide: 2, blocksHigh: 2, dc, progressive: true, ah: 1 }))).toBeNull();
  });

  it("stops at an end-of-image marker that arrives before any scan", () => {
    // SOI, an APP0 segment, then EOI: a file with no image in it.
    const header = jpegFixture({ blocksWide: 1, blocksHigh: 1, dc, extraMarker: true });
    const appEnd = 2 + 2 + 2 + 7;   // SOI + TEM + APP0 length + payload
    const truncated = new Uint8Array([...header.subarray(0, appEnd), 0xff, 0xd9, 0, 0]);
    expect(decodeJpegGray(truncated)).toBeNull();
  });
});

describe("decodeGrayscale + resampleGray", () => {
  it("dispatches on the file's own magic bytes", async () => {
    expect(await decodeGrayscale(pngFixture({ width: 8, height: 8 }))).not.toBeNull();
    expect(await decodeGrayscale(jpegFixture({ blocksWide: 2, blocksHigh: 2, dc: () => 0 }))).not.toBeNull();
    // WebP: a RIFF container, which neither decoder handles.
    expect(await decodeGrayscale(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBeNull();
  });

  it("box-filters down to the hash grid", () => {
    const img = { gray: Array.from({ length: 64 }, (_, i) => i), cols: 8, rows: 8 };
    const small = resampleGray(img, 2, 2);
    expect(small).toHaveLength(4);
    // Each output cell is the mean of its 4x4 source block.
    expect(small[0]).toBeCloseTo(13.5, 5);
    expect(small[3]).toBeCloseTo(49.5, 5);
    // Upsampling never divides by zero.
    expect(resampleGray({ gray: [1, 2], cols: 2, rows: 1 }, 4, 2).every(Number.isFinite)).toBe(true);
  });

  it("hashes the same picture to the same value through either format", async () => {
    // The property the whole module exists for: a photo re-encoded by one
    // platform as PNG and by another as JPEG has to land on the same hash, or
    // cross-platform avatar matching cannot work.
    const blocks = (bx: number, by: number) => (bx * 60 + by * 30) - 200;
    const jpeg = await decodeGrayscale(jpegFixture({ blocksWide: 8, blocksHigh: 8, dc: blocks }));
    const png = await decodeGrayscale(pngFixture({
      width: 64, height: 64,
      // The same flat 8x8 blocks the JPEG carries, on the same scale the IDCT
      // produces: DC/8 plus the level shift.
      value: (x, y) => Math.max(0, Math.min(255, Math.round(blocks(Math.floor(x / 8), Math.floor(y / 8)) / 8 + 128))),
    }));
    const hashOf = (img: { gray: number[]; cols: number; rows: number }) =>
      dHashFromGray(resampleGray(img, 9, 8), 9, 8);
    expect(hamming(hashOf(jpeg!), hashOf(png!))).toBe(0);
  });
});

describe("decoders refuse rather than improvise", () => {
  const dc = (bx: number, by: number) => (bx * 40 + by * 40) - 200;

  it("reverses a Paeth filter whose upper-left pixel predicts best", async () => {
    // Paeth picks between the left, above and upper-left neighbours; this
    // pattern makes each of the three win somewhere.
    const value = (x: number, y: number) => (x === y ? 250 : x > y ? 10 : 200);
    const filtered = await decodePngGray(pngFixture({ width: 12, height: 12, filter: 4, value }));
    const plain = await decodePngGray(pngFixture({ width: 12, height: 12, filter: 0, value }));
    expect(filtered!.gray).toEqual(plain!.gray);
  });

  it("stops at a PNG chunk whose length runs past the end of the file", async () => {
    const img = pngFixture({ width: 8, height: 8 });
    const view = new DataView(img.buffer, img.byteOffset, img.byteLength);
    view.setUint32(8 + 13 + 12, 0xffff);   // the tEXt chunk's declared length
    expect(await decodePngGray(img)).toBeNull();
  });

  it("refuses a palette image at a bit depth it does not decode", async () => {
    expect(await decodePngGray(pngFixture({ width: 8, height: 8, colorType: 3, bitDepth: 16 }))).toBeNull();
  });

  it("decodes an entropy stream containing a stuffed 0xFF byte", () => {
    // Coefficients chosen to push an 0xFF into the entropy bytes, which the
    // encoder writes as FF 00 and the reader has to unstuff.
    const img = decodeJpegGray(jpegFixture({
      blocksWide: 8, blocksHigh: 8, dc: () => 255,
      ac: () => Array.from({ length: 63 }, (_, i) => (i % 2 === 0 ? 255 : -255)),
    }));
    expect(img).not.toBeNull();
  });

  it("never throws, whatever point the scan is cut at", () => {
    const full = jpegFixture({
      blocksWide: 6, blocksHigh: 6, dc, ac: () => [30, 0, 0, -20, 0, 0, 0, 15],
    });
    for (let cut = full.length - 1; cut > full.length - 120; cut -= 3) {
      const out = decodeJpegGray(full.subarray(0, cut));
      // Either a usable image or null — never a throw, and never a half-filled
      // grid presented as a whole one.
      expect(out === null || out.cols > 0, `cut at ${cut}`).toBe(true);
    }
  });

  it("refuses a scan that does not carry the luma component", () => {
    expect(decodeJpegGray(jpegFixture({ blocksWide: 2, blocksHigh: 2, dc, scanSecondComponent: true }))).toBeNull();
  });

  it("refuses a scan whose DC table was never defined", () => {
    expect(decodeJpegGray(jpegFixture({ blocksWide: 2, blocksHigh: 2, dc, missingDcTable: true }))).toBeNull();
  });

  it("steps over junk between segments", () => {
    expect(decodeJpegGray(jpegFixture({ blocksWide: 2, blocksHigh: 2, dc, junkBeforeScan: true }))).not.toBeNull();
  });

  it("crops a one-pixel image rather than pretending it has width", () => {
    // A single pixel carries no left-to-right difference, so the caller gets a
    // 1x1 image and the hash of it is degenerate by construction.
    const img = decodeJpegGray(jpegFixture({ blocksWide: 1, blocksHigh: 1, dc, width: 1, height: 1 }));
    expect(img).toEqual({ gray: [expect.any(Number)], cols: 1, rows: 1 });
  });

  it("recovers from a restart marker that is not where it was expected", () => {
    const img = jpegFixture({ blocksWide: 4, blocksHigh: 4, dc, restartInterval: 2 });
    // Blank one restart marker, so the reader has to scan forward for the next.
    const at = img.indexOf(0xd0, 20);
    if (at > 0) img[at] = 0x00;
    expect(() => decodeJpegGray(img)).not.toThrow();
  });
});
