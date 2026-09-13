import { deflateSync } from "node:zlib";

// ── Synthetic PNG and JPEG builders ──────────────────────────────────────────
//
// The decoders in analysis/imageGray.ts are the only way avatar correlation can
// work server-side, so they need fixtures that are real files rather than
// hand-waved byte arrays. Both builders emit spec-valid images, which is what
// lets one test assert the interesting property: the SAME picture encoded as
// PNG and as JPEG must produce the same perceptual hash.

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

export interface PngOptions {
  width: number;
  height: number;
  /** 0 grayscale · 2 RGB · 3 palette · 4 gray+alpha · 6 RGBA. */
  colorType?: number;
  bitDepth?: number;
  /** Per-scanline filter type (0-4). */
  filter?: number;
  interlace?: number;
  /** Luminance for pixel (x, y), 0-255. */
  value?: (x: number, y: number) => number;
  /** Override the palette for colour type 3. */
  palette?: Uint8Array;
  /** Emit the IDAT in several chunks, as real encoders do. */
  splitIdat?: boolean;
}

/** A spec-valid PNG whose pixels come from `value`. */
export function pngFixture(opts: PngOptions): Uint8Array {
  const {
    width, height, colorType = 0, bitDepth = 8, filter = 0, interlace = 0,
    value = (x, y) => (x * 16 + y * 4) % 256, splitIdat = false,
  } = opts;

  const channels = colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : 1;
  const sampleBytes = bitDepth === 16 ? 2 : 1;
  const stride = width * channels * sampleBytes;

  const raw = new Uint8Array((stride + 1) * height);
  let at = 0;
  const prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const line = new Uint8Array(stride);
    for (let x = 0; x < width; x++) {
      const v = value(x, y) & 0xff;
      for (let c = 0; c < channels; c++) {
        const i = (x * channels + c) * sampleBytes;
        // Colour type 3 stores a palette INDEX; everything else stores samples.
        line[i] = colorType === 3 ? v : v;
        if (sampleBytes === 2) line[i + 1] = 0;
      }
    }
    raw[at++] = filter;
    const bpp = channels * sampleBytes;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? (line[i - bpp] as number) : 0;
      const b = prev[i] as number;
      const c = i >= bpp ? (prev[i - bpp] as number) : 0;
      const x = line[i] as number;
      let enc: number;
      switch (filter) {
        case 1: enc = x - a; break;
        case 2: enc = x - b; break;
        case 3: enc = x - Math.floor((a + b) / 2); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          enc = x - pred;
          break;
        }
        default: enc = x;
      }
      raw[at + i] = enc & 0xff;
    }
    at += stride;
    prev.set(line);
  }

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  ihdr[12] = interlace;

  const compressed = new Uint8Array(deflateSync(Buffer.from(raw)));
  const idat = splitIdat
    ? [chunk("IDAT", compressed.subarray(0, 5)), chunk("IDAT", compressed.subarray(5))]
    : [chunk("IDAT", compressed)];

  const palette = opts.palette ?? (() => {
    // A greyscale ramp, so palette index n decodes to luminance n.
    const p = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i++) { p[i * 3] = i; p[i * 3 + 1] = i; p[i * 3 + 2] = i; }
    return p;
  })();

  return concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    // A chunk the decoder must skip over rather than choke on.
    chunk("tEXt", new Uint8Array([0x61, 0x00, 0x62])),
    ...(colorType === 3 ? [chunk("PLTE", palette)] : []),
    ...idat,
    chunk("IEND", new Uint8Array(0)),
  ]);
}

// ── JPEG ─────────────────────────────────────────────────────────────────────

class BitWriter {
  private bytes: number[] = [];
  private cur = 0;
  private nbits = 0;

  write(code: number, length: number): void {
    for (let i = length - 1; i >= 0; i--) this.bit((code >> i) & 1);
  }

  private bit(b: number): void {
    this.cur = (this.cur << 1) | b;
    this.nbits++;
    if (this.nbits === 8) {
      this.bytes.push(this.cur);
      // Byte stuffing: a literal 0xFF in the entropy stream is written 0xFF 0x00.
      if (this.cur === 0xff) this.bytes.push(0x00);
      this.cur = 0;
      this.nbits = 0;
    }
  }

  /** Pad the final byte with 1 bits, as the spec requires. */
  finish(): Uint8Array {
    while (this.nbits !== 0) this.bit(1);
    return new Uint8Array(this.bytes);
  }

  /** Align to a byte boundary and emit a restart marker. */
  restart(index: number): void {
    while (this.nbits !== 0) this.bit(1);
    this.bytes.push(0xff, 0xd0 + (index % 8));
  }
}

/** Canonical Huffman code table from counts + values. */
function codesFrom(counts: number[], values: number[]): Map<number, { code: number; length: number }> {
  const out = new Map<number, { code: number; length: number }>();
  let code = 0;
  let k = 0;
  for (let length = 1; length <= 16; length++) {
    for (let i = 0; i < (counts[length - 1] as number); i++) {
      out.set(values[k++] as number, { code, length });
      code++;
    }
    code <<= 1;
  }
  return out;
}

/** Bits needed to encode a DC difference, and its JPEG-coded value. */
function category(diff: number): { size: number; bits: number } {
  const abs = Math.abs(diff);
  let size = 0;
  while (abs >= 1 << size) size++;
  return { size, bits: diff >= 0 ? diff : diff + (1 << size) - 1 };
}

export interface JpegOptions {
  /** Image size in whole 8x8 blocks. */
  blocksWide: number;
  blocksHigh: number;
  /** DC coefficient for block (bx, by). */
  dc: (bx: number, by: number) => number;
  /** AC coefficients (63 of them, zig-zag order) for block (bx, by). */
  ac?: (bx: number, by: number) => number[];
  /** Emit a 16-bit quantisation table (Pq=1). */
  sixteenBitQuant?: boolean;
  /** Point the frame component at a quantisation table that is never defined. */
  missingQuant?: boolean;
  /** Emit three components at 4:2:0, so the scan is interleaved. */
  colour?: boolean;
  /** Sampling factors for the single-component case (0x00 is invalid). */
  samplingByte?: number;
  /** Progressive successive-approximation high bit, which we refuse to decode. */
  ah?: number;
  /** Reference an AC table the file never defines. */
  missingAcTable?: boolean;
  /** Emit the scan with no preceding frame header. */
  noFrame?: boolean;
  /** Reference a DC Huffman table the file never defines. */
  missingDcTable?: boolean;
  /** Name a component in the scan that is not the frame's first. */
  scanSecondComponent?: boolean;
  /** Put junk bytes between two markers, which the parser must step over. */
  junkBeforeScan?: boolean;
  /** Emit a restart marker every N MCUs. */
  restartInterval?: number;
  /** Emit SOF2 with a DC-first scan instead of SOF0. */
  progressive?: boolean;
  /** Successive-approximation shift for the progressive DC scan. */
  al?: number;
  /** Crop the declared size below the block grid, exercising the crop path. */
  width?: number;
  height?: number;
  /** Marker to emit after SOI, exercising the segment skipper. */
  extraMarker?: boolean;
}

/**
 * A baseline (or progressive-DC) JPEG built from DC coefficients only.
 *
 * Every block is flat, which is exactly what a DC-only encode means, and is
 * enough to exercise the whole entropy path: Huffman decode, the DC predictor,
 * end-of-block, byte stuffing, restart markers and the inverse DCT.
 */
export function jpegFixture(opts: JpegOptions): Uint8Array {
  const {
    blocksWide, blocksHigh, dc, ac, restartInterval = 0, progressive = false, al = 0,
    extraMarker = false, sixteenBitQuant = false, missingQuant = false, colour = false,
    samplingByte, ah = 0, missingAcTable = false, noFrame = false,
    missingDcTable = false, scanSecondComponent = false, junkBeforeScan = false,
  } = opts;
  const width = opts.width ?? blocksWide * 8;
  const height = opts.height ?? blocksHigh * 8;

  const seg = (marker: number, body: number[]): number[] => [0xff, marker, ((body.length + 2) >> 8) & 0xff, (body.length + 2) & 0xff, ...body];

  // Quantisation: all ones, so a coefficient survives dequantisation intact.
  const dqt = sixteenBitQuant
    ? seg(0xdb, [0x10, ...new Array(64).fill(0).flatMap(() => [0, 1])])
    : seg(0xdb, [0x00, ...new Array(64).fill(1)]);

  // DC table: twelve four-bit codes, one per magnitude category.
  const dcCounts = [0, 0, 0, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const dcValues = Array.from({ length: 12 }, (_, i) => i);
  // AC table: end-of-block, the zero-run symbol, and every (run, size) pair a
  // fixture might need. All eight bits long, which keeps the canonical code
  // assignment trivial.
  const acSymbols = [0x00, 0xf0];
  for (let run = 0; run <= 15; run++) for (let size = 1; size <= 10; size++) acSymbols.push((run << 4) | size);
  const acCounts = [0, 0, 0, 0, 0, 0, 0, acSymbols.length, 0, 0, 0, 0, 0, 0, 0, 0];
  const acValues = acSymbols;
  const dht = [
    ...seg(0xc4, [0x00, ...dcCounts, ...dcValues]),
    ...seg(0xc4, [0x10, ...acCounts, ...acValues]),
  ];

  const quantId = missingQuant ? 3 : 0;
  const sof = noFrame ? [] : seg(progressive ? 0xc2 : 0xc0, colour || scanSecondComponent
    ? [
        8, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff,
        3,
        1, 0x22, quantId,   // luma, 2x2 sampled
        2, 0x11, quantId,   // Cb
        3, 0x11, quantId,   // Cr
      ]
    : [
        8, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff,
        1, 1, samplingByte ?? 0x11, quantId,
      ]);

  const acTableId = missingAcTable ? 1 : 0;
  const tableByte = (missingDcTable ? 0x10 : 0x00) | acTableId;
  const sos = seg(0xda, colour
    ? [3, 1, tableByte, 2, tableByte, 3, tableByte, 0, 63, 0]
    : [
        1, scanSecondComponent ? 2 : 1, tableByte,
        0, progressive ? 0 : 63, ((progressive ? ah : 0) << 4) | (progressive ? al : 0),
      ]);

  const dcCodes = codesFrom(dcCounts, dcValues);
  const acCodes = codesFrom(acCounts, acValues);
  const writer = new BitWriter();
  const pred = new Map<number, number>();
  let sinceRestart = 0;
  let mcu = 0;

  const emit = (symbol: number) => {
    const sym = acCodes.get(symbol) as { code: number; length: number };
    writer.write(sym.code, sym.length);
  };

  /** One block: the DC difference, then the AC coefficients run-length coded. */
  const block = (componentId: number, bx: number, by: number) => {
    const value = progressive ? dc(bx, by) >> al : dc(bx, by);
    const diff = value - (pred.get(componentId) ?? 0);
    pred.set(componentId, value);
    const { size, bits } = category(diff);
    const sym = dcCodes.get(size) as { code: number; length: number };
    writer.write(sym.code, sym.length);
    if (size > 0) writer.write(bits, size);
    if (progressive) return;

    const coefficients = ac?.(bx, by) ?? [];
    let run = 0;
    let wrote = false;
    for (let k = 0; k < 63; k++) {
      const v = coefficients[k] ?? 0;
      if (v === 0) { run++; continue; }
      while (run > 15) { emit(0xf0); run -= 16; }
      const cat = category(v);
      emit((run << 4) | cat.size);
      writer.write(cat.bits, cat.size);
      run = 0;
      wrote = true;
    }
    // Trailing zeroes are an end-of-block; a full 63 coefficients need none.
    if (!wrote || run > 0) emit(0x00);
  };

  const components = colour ? [{ id: 1, h: 2, v: 2 }, { id: 2, h: 1, v: 1 }, { id: 3, h: 1, v: 1 }] : [{ id: 1, h: 1, v: 1 }];
  const mcusPerLine = colour ? Math.ceil(blocksWide / 2) : blocksWide;
  const mcusPerColumn = colour ? Math.ceil(blocksHigh / 2) : blocksHigh;

  for (let my = 0; my < mcusPerColumn; my++) {
    for (let mx = 0; mx < mcusPerLine; mx++) {
      if (restartInterval > 0 && sinceRestart === restartInterval) {
        writer.restart(mcu++);
        pred.clear();
        sinceRestart = 0;
      }
      sinceRestart++;
      for (const comp of components) {
        for (let v = 0; v < comp.v; v++) {
          for (let h = 0; h < comp.h; h++) {
            block(comp.id, mx * comp.h + h, my * comp.v + v);
          }
        }
      }
    }
  }

  const dri = restartInterval > 0
    ? seg(0xdd, [(restartInterval >> 8) & 0xff, restartInterval & 0xff])
    : [];
  // A standalone marker (TEM) plus an APP0 segment: both must be stepped over.
  const extra = extraMarker ? [0xff, 0x01, ...seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00])] : [];

  // Junk between segments: a decoder scanning for markers has to step over it
  // rather than misreading it as one.
  const junk = junkBeforeScan ? [0x12, 0x34] : [];

  return new Uint8Array([
    0xff, 0xd8,
    ...extra,
    ...dqt, ...dht, ...dri, ...sof, ...junk, ...sos,
    ...writer.finish(),
    0xff, 0xd9,
  ]);
}
