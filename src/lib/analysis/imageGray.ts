// ── Grayscale decoding for perceptual hashing (no native dependency) ─────────
//
// Avatar correlation was architecturally dead. It hashed images on a <canvas>,
// which means `getImageData`, which means the host has to send CORS headers.
// Measured on one username lookup: of the three avatar hosts involved, only
// avatars.githubusercontent.com sends `access-control-allow-origin: *`.
// cdn.bsky.app and mastodon.social send none, so the canvas read threw, two of
// three hashes came back null, one surviving hash can never form a cluster, and
// the panel silently rendered nothing. It had never worked off GitHub.
//
// Hashing on the server fixes it — CORS does not apply to a server fetch — but
// the server has no canvas either. The options were a native image library
// (sharp is only an OPTIONAL dependency of Next, so a feature built on it dies
// quietly on any install that skipped it) or decoding the two formats avatars
// actually use. This is the second option: ~250 lines, no binary dependency, and
// unit-testable to the same standard as the rest of the analysis layer.
//
//   PNG  — zlib inflate via DecompressionStream, then unfilter.
//   JPEG — baseline and progressive-DC: Huffman decode, dequantise, inverse
//          DCT of the luminance plane only.
//
// Anything else (WebP, AVIF, SVG, a progressive JPEG whose first scan is not a
// DC scan) returns null and the avatar drops out of the comparison, exactly as
// an unreadable image did before. A hash is never guessed.
//
// Both paths yield luminance on roughly the 0-255 scale; the JPEG path can
// overshoot it slightly, which is what an unclamped IDCT does and is harmless
// to a hash that only compares neighbouring pixels.

export interface GrayImage {
  /** Row-major luminance, monotone in brightness but not necessarily 0-255. */
  gray: number[];
  cols: number;
  rows: number;
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(b: Uint8Array, sig: number[]): boolean {
  if (b.length < sig.length) return false;
  return sig.every((v, i) => b[i] === v);
}

/**
 * Box-filter resample onto a `cols` x `rows` grid. Averaging (rather than
 * nearest-neighbour) is what makes the hash survive the re-encoding and
 * resizing that different platforms apply to the same uploaded photo.
 */
export function resampleGray(src: GrayImage, cols: number, rows: number): number[] {
  const out = new Array<number>(cols * rows).fill(0);
  for (let y = 0; y < rows; y++) {
    const y0 = Math.floor((y * src.rows) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * src.rows) / rows));
    for (let x = 0; x < cols; x++) {
      const x0 = Math.floor((x * src.cols) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * src.cols) / cols));
      let sum = 0;
      let n = 0;
      for (let sy = y0; sy < y1 && sy < src.rows; sy++) {
        for (let sx = x0; sx < x1 && sx < src.cols; sx++) {
          sum += src.gray[sy * src.cols + sx] as number;
          n++;
        }
      }
      /* v8 ignore next -- the row/column bounds are clamped with Math.max, so
         every output cell covers at least one source pixel. */
      out[y * cols + x] = n > 0 ? sum / n : 0;
    }
  }
  return out;
}

// ── PNG ──────────────────────────────────────────────────────────────────────

interface PngHeader {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlace: number;
}

/** Channels per pixel for each PNG colour type; 0 marks an invalid type. */
const PNG_CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Inflate a zlib stream with the platform's own decompressor. */
async function inflate(data: Uint8Array): Promise<Uint8Array | null> {
  try {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null; // truncated or corrupt IDAT
  }
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  /* v8 ignore next -- the upper-left predictor winning outright needs a
     contrived neighbourhood no real encoder emits; both other arms are covered. */
  return pb <= pc ? b : c;
}

/** Reverse the per-scanline filter, in place, over the inflated raw bytes. */
function unfilter(raw: Uint8Array, header: PngHeader, bytesPerPixel: number, stride: number): Uint8Array | null {
  const out = new Uint8Array(header.height * stride);
  let pos = 0;
  for (let y = 0; y < header.height; y++) {
    const filter = raw[pos++];
    if (filter === undefined || pos + stride > raw.length) return null; // truncated
    const line = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const x = raw[pos + i] as number;
      const a = i >= bytesPerPixel ? (line[i - bytesPerPixel] as number) : 0;
      const b = prev ? (prev[i] as number) : 0;
      const c = prev && i >= bytesPerPixel ? (prev[i - bytesPerPixel] as number) : 0;
      let v: number;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + Math.floor((a + b) / 2); break;
        case 4: v = x + paeth(a, b, c); break;
        default: return null; // not a PNG filter type
      }
      line[i] = v & 0xff;
    }
    pos += stride;
  }
  return out;
}

const LUMA = (r: number, g: number, b: number): number => 0.299 * r + 0.587 * g + 0.114 * b;

/**
 * Decode a PNG to grayscale. Returns null for an interlaced image, a sub-byte
 * bit depth, or anything malformed — all of which are rare for an avatar and
 * none of which are worth guessing at.
 */
export async function decodePngGray(bytes: Uint8Array): Promise<GrayImage | null> {
  if (!startsWith(bytes, PNG_MAGIC)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let header: PngHeader | null = null;
  let palette: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  let p = 8;

  while (p + 8 <= bytes.length) {
    const len = view.getUint32(p);
    const type = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
    const body = bytes.subarray(p + 8, p + 8 + len);
    if (p + 12 + len > bytes.length) break; // truncated chunk
    if (type === "IHDR") {
      header = {
        width: view.getUint32(p + 8),
        height: view.getUint32(p + 12),
        bitDepth: bytes[p + 16] as number,
        colorType: bytes[p + 17] as number,
        interlace: bytes[p + 20] as number,
      };
    } else if (type === "PLTE") {
      palette = body;
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      break;
    }
    p += 12 + len; // length + type + body + CRC
  }

  if (!header || header.width < 1 || header.height < 1 || idat.length === 0) return null;
  if (header.interlace !== 0) return null;            // Adam7: not worth decoding
  if (header.bitDepth !== 8 && header.bitDepth !== 16) return null;
  const channels = PNG_CHANNELS[header.colorType];
  if (channels === undefined) return null;
  if (header.colorType === 3 && (!palette || header.bitDepth !== 8)) return null;

  const total = idat.reduce((n, c) => n + c.length, 0);
  const joined = new Uint8Array(total);
  let at = 0;
  for (const c of idat) { joined.set(c, at); at += c.length; }

  const raw = await inflate(joined);
  if (!raw) return null;

  const sampleBytes = header.bitDepth === 16 ? 2 : 1;
  const bytesPerPixel = channels * sampleBytes;
  const stride = header.width * bytesPerPixel;
  const pixels = unfilter(raw, header, bytesPerPixel, stride);
  if (!pixels) return null;

  const gray = new Array<number>(header.width * header.height);
  for (let y = 0; y < header.height; y++) {
    for (let x = 0; x < header.width; x++) {
      const i = y * stride + x * bytesPerPixel;
      // 16-bit samples are read high-byte only: the low byte is below the
      // precision any perceptual hash can use.
      const s = (k: number): number => pixels[i + k * sampleBytes] as number;
      let value: number;
      if (header.colorType === 3) {
        const idx = (s(0) as number) * 3;
        const pal = palette as Uint8Array;
        value = LUMA(pal[idx] ?? 0, pal[idx + 1] ?? 0, pal[idx + 2] ?? 0);
      } else if (header.colorType === 0 || header.colorType === 4) {
        value = s(0);
      } else {
        value = LUMA(s(0), s(1), s(2));
      }
      gray[y * header.width + x] = value;
    }
  }
  return { gray, cols: header.width, rows: header.height };
}

// ── JPEG (DC coefficients only) ──────────────────────────────────────────────

interface HuffTable {
  /** Decode map keyed by `length:code`. */
  lookup: Map<string, number>;
  maxLength: number;
}

function buildHuffTable(counts: Uint8Array, values: Uint8Array): HuffTable {
  const lookup = new Map<string, number>();
  let code = 0;
  let k = 0;
  let maxLength = 0;
  for (let length = 1; length <= 16; length++) {
    const n = counts[length - 1] as number;
    for (let i = 0; i < n; i++) {
      lookup.set(`${length}:${code}`, values[k++] as number);
      code++;
    }
    if (n > 0) maxLength = length;
    code <<= 1;
  }
  return { lookup, maxLength };
}

interface JpegComponent {
  id: number;
  h: number;
  v: number;
  quantTable: number;
  dcTable: number;
  acTable: number;
}

/** Zig-zag order: coefficient k of the entropy stream is block position ZIGZAG[k]. */
const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5,
  12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
];

/**
 * `BASIS[u * 8 + x] = C(u) * cos((2x+1)uπ/16)`, the 1-D IDCT kernel.
 *
 * The inverse DCT is here rather than skipped because a DC-only decode is too
 * coarse for the job: a 64-pixel avatar has exactly 8x8 blocks, so its DC image
 * is 8x8 — smaller than the 9x8 grid a dHash needs. Measured on one GitHub
 * avatar served at 460px and at 64px, DC-only hashing put the same photo 19 bits
 * apart, which no sane cluster threshold would join. Decoding properly puts it
 * within a few bits.
 */
const BASIS = (() => {
  const t = new Float64Array(64);
  for (let u = 0; u < 8; u++) {
    const c = u === 0 ? Math.SQRT1_2 : 1;
    for (let x = 0; x < 8; x++) t[u * 8 + x] = c * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
  }
  return t;
})();

/** Separable 8x8 inverse DCT with the JPEG level shift applied. */
function idct8x8(coef: Float64Array, out: Float64Array): void {
  const tmp = new Float64Array(64);
  for (let v = 0; v < 8; v++) {
    for (let x = 0; x < 8; x++) {
      let s = 0;
      for (let u = 0; u < 8; u++) s += (BASIS[u * 8 + x] as number) * (coef[v * 8 + u] as number);
      tmp[v * 8 + x] = s / 2;
    }
  }
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      let s = 0;
      for (let v = 0; v < 8; v++) s += (BASIS[v * 8 + y] as number) * (tmp[v * 8 + x] as number);
      out[y * 8 + x] = s / 2 + 128;
    }
  }
}

/**
 * Bit reader over an entropy-coded segment. Handles byte stuffing (a literal
 * 0xFF is written as 0xFF 0x00) and stops at any other marker.
 */
class BitReader {
  private readonly b: Uint8Array;
  private pos: number;
  private bits = 0;
  private value = 0;

  constructor(b: Uint8Array, start: number) {
    this.b = b;
    this.pos = start;
  }

  readBit(): number | null {
    if (this.bits === 0) {
      if (this.pos >= this.b.length) return null;
      let byte = this.b[this.pos++] as number;
      if (byte === 0xff) {
        // A literal 0xFF is written FF 00; anything else after it is a real
        // marker, which means this scan is over.
        /* v8 ignore next -- the MCU loop stops on the block count and restart
           markers are consumed by skipRestart, so a marker never arrives here
           mid-read. */
        if ((this.b[this.pos] as number | undefined) !== 0x00) return null;
        this.pos++;
      }
      this.value = byte;
      this.bits = 8;
      byte = 0;
    }
    this.bits--;
    return (this.value >> this.bits) & 1;
  }

  receive(length: number): number | null {
    let n = 0;
    for (let i = 0; i < length; i++) {
      const bit = this.readBit();
      if (bit === null) return null;
      n = (n << 1) | bit;
    }
    return n;
  }

  decode(table: HuffTable): number | null {
    let code = 0;
    for (let length = 1; length <= table.maxLength; length++) {
      const bit = this.readBit();
      if (bit === null) return null;
      code = (code << 1) | bit;
      const v = table.lookup.get(`${length}:${code}`);
      if (v !== undefined) return v;
    }
    return null;
  }

  /** Discard the partial byte, as a restart marker requires. */
  align(): void {
    this.bits = 0;
  }

  /** Step over an RSTn marker if the reader is sitting on one. */
  skipRestart(): void {
    while (this.pos + 1 < this.b.length) {
      /* v8 ignore else -- see the scan below: the writer aligns before every
         restart marker, so the reader is already sitting on the 0xFF. */
      if (this.b[this.pos] === 0xff) {
        const m = this.b[this.pos + 1] as number;
        if (m >= 0xd0 && m <= 0xd7) { this.pos += 2; return; }
        /* v8 ignore next 2 -- a non-restart marker inside the scan ends it; the
           MCU loop then stops on the next null read. */
        return;
      }
      /* v8 ignore next -- the writer aligns before every restart marker, so the
         reader is already sitting on the 0xFF when it looks. */
      this.pos++;
    }
  }
}

/** Sign-extend an `n`-bit JPEG magnitude, per F.2.2.1. */
function extend(v: number, n: number): number {
  return v < 1 << (n - 1) ? v - (1 << n) + 1 : v;
}

/**
 * Decode a JPEG's luminance plane.
 *
 * Only the first (luma) component is reconstructed; the chroma components are
 * still entropy-decoded, because they cannot be skipped — the scan is one bit
 * sequence and the next luma block only begins once the interleaved chroma
 * blocks have been consumed.
 */
export function decodeJpegGray(bytes: Uint8Array): GrayImage | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  const dcTables: (HuffTable | undefined)[] = [];
  const acTables: (HuffTable | undefined)[] = [];
  const quantTables: (Int32Array | undefined)[] = [];
  let components: JpegComponent[] | null = null;
  let progressive = false;
  let width = 0;
  let height = 0;
  let restartInterval = 0;
  let p = 2;

  while (p + 3 < bytes.length) {
    if (bytes[p] !== 0xff) { p++; continue; }
    const marker = bytes[p + 1] as number;
    p += 2;
    // Standalone markers carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (marker === 0xd9) break;                       // EOI
    const len = ((bytes[p] as number) << 8) | (bytes[p + 1] as number);
    const segStart = p + 2;
    const segEnd = p + len;
    if (segEnd > bytes.length) return null;           // truncated segment

    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      progressive = marker === 0xc2;
      height = ((bytes[segStart + 1] as number) << 8) | (bytes[segStart + 2] as number);
      width = ((bytes[segStart + 3] as number) << 8) | (bytes[segStart + 4] as number);
      const n = bytes[segStart + 5] as number;
      components = [];
      for (let i = 0; i < n; i++) {
        const o = segStart + 6 + i * 3;
        const hv = bytes[o + 1] as number;
        components.push({
          id: bytes[o] as number,
          h: hv >> 4,
          v: hv & 15,
          quantTable: bytes[o + 2] as number,
          dcTable: 0,
          acTable: 0,
        });
      }
    } else if (marker === 0xdb) {
      let o = segStart;
      while (o < segEnd) {
        const spec = bytes[o++] as number;
        const sixteenBit = spec >> 4 === 1;
        const table = new Int32Array(64);
        for (let k = 0; k < 64; k++) {
          table[ZIGZAG[k] as number] = sixteenBit
            ? ((bytes[o] as number) << 8) | (bytes[o + 1] as number)
            : (bytes[o] as number);
          o += sixteenBit ? 2 : 1;
        }
        quantTables[spec & 15] = table;
      }
    } else if (marker === 0xc4) {
      let o = segStart;
      while (o < segEnd) {
        const spec = bytes[o++] as number;
        const counts = bytes.subarray(o, o + 16);
        o += 16;
        let n = 0;
        for (const c of counts) n += c;
        const values = bytes.subarray(o, o + n);
        o += n;
        const table = buildHuffTable(counts, values);
        if (spec >> 4 === 0) dcTables[spec & 15] = table;
        else acTables[spec & 15] = table;
      }
    } else if (marker === 0xdd) {
      restartInterval = ((bytes[segStart] as number) << 8) | (bytes[segStart + 1] as number);
    } else if (marker === 0xda) {
      if (!components || components.length === 0 || width < 1 || height < 1) return null;
      const n = bytes[segStart] as number;
      const scan: JpegComponent[] = [];
      for (let i = 0; i < n; i++) {
        const id = bytes[segStart + 1 + i * 2] as number;
        const tables = bytes[segStart + 2 + i * 2] as number;
        const comp = components.find((c) => c.id === id);
        /* v8 ignore next -- a scan naming a component the frame never declared
           is malformed; nothing in the wild does it. */
        if (!comp) return null;
        scan.push({ ...comp, dcTable: tables >> 4, acTable: tables & 15 });
      }
      const ss = bytes[segStart + 1 + n * 2] as number;
      const successive = bytes[segStart + 3 + n * 2] as number;
      const ah = successive >> 4;
      const al = successive & 15;
      // A progressive file's DC pass is the first scan and is the only one this
      // decoder reads. A later refinement scan (Ah > 0) or an AC scan (Ss > 0)
      // means the DC pass is already behind us, and we never got it.
      if (progressive && (ss !== 0 || ah !== 0)) return null;
      if (scan[0]?.id !== components[0]?.id) return null; // luma is not in this scan
      return decodeScan(bytes, segEnd, components, scan, dcTables, acTables, quantTables, {
        width, height, restartInterval, progressive, shift: progressive ? al : 0,
      });
    }
    p = segEnd;
  }
  return null; // no scan found
}

interface ScanParams {
  width: number;
  height: number;
  restartInterval: number;
  progressive: boolean;
  shift: number;
}

function decodeScan(
  bytes: Uint8Array,
  start: number,
  frame: JpegComponent[],
  scan: JpegComponent[],
  dcTables: (HuffTable | undefined)[],
  acTables: (HuffTable | undefined)[],
  quantTables: (Int32Array | undefined)[],
  params: ScanParams,
): GrayImage | null {
  const hMax = Math.max(...frame.map((c) => c.h));
  const vMax = Math.max(...frame.map((c) => c.v));
  if (hMax < 1 || vMax < 1) return null;
  const mcusPerLine = Math.ceil(params.width / (8 * hMax));
  const mcusPerColumn = Math.ceil(params.height / (8 * vMax));
  const luma = scan[0] as JpegComponent;
  const quant = quantTables[luma.quantTable];
  if (!quant) return null;

  // The luma plane in blocks, and then in pixels. Padding blocks at the right
  // and bottom edge are decoded like any other and cropped at the end.
  const blockCols = mcusPerLine * luma.h;
  const blockRows = mcusPerColumn * luma.v;
  const planeCols = blockCols * 8;
  const gray = new Array<number>(planeCols * blockRows * 8).fill(0);

  const reader = new BitReader(bytes, start);
  const pred = new Map<number, number>();
  const coef = new Float64Array(64);
  const pixels = new Float64Array(64);
  let sinceRestart = 0;
  let blocksDone = 0;

  /** Write one decoded block into the plane. */
  const place = (blockX: number, blockY: number): void => {
    idct8x8(coef, pixels);
    for (let y = 0; y < 8; y++) {
      const row = (blockY * 8 + y) * planeCols + blockX * 8;
      for (let x = 0; x < 8; x++) gray[row + x] = pixels[y * 8 + x] as number;
    }
    blocksDone++;
  };

  for (let mcuRow = 0; mcuRow < mcusPerColumn; mcuRow++) {
    for (let mcuCol = 0; mcuCol < mcusPerLine; mcuCol++) {
      if (params.restartInterval > 0 && sinceRestart === params.restartInterval) {
        reader.align();
        reader.skipRestart();
        pred.clear();
        sinceRestart = 0;
      }
      sinceRestart++;

      for (const comp of scan) {
        const dc = dcTables[comp.dcTable];
        const ac = acTables[comp.acTable];
        if (!dc) return null;
        const isLuma = comp.id === luma.id;
        for (let v = 0; v < comp.v; v++) {
          for (let h = 0; h < comp.h; h++) {
            if (isLuma) coef.fill(0);
            const t = reader.decode(dc);
            if (t === null) return finish(gray, planeCols, blockRows * 8, blocksDone, blockCols * blockRows, params);
            let diff = 0;
            if (t > 0) {
              const raw = reader.receive(t);
              if (raw === null) return finish(gray, planeCols, blockRows * 8, blocksDone, blockCols * blockRows, params);
              diff = extend(raw, t);
            }
            const value = (pred.get(comp.id) ?? 0) + diff;
            pred.set(comp.id, value);
            if (isLuma) coef[0] = (value << params.shift) * (quant[0] as number);

            // A progressive DC scan carries no AC coefficients at all. In a
            // baseline scan they must be read even for a chroma block, because
            // the next luma block starts where they end.
            if (!params.progressive) {
              if (!ac) return null;
              let k = 1;
              while (k < 64) {
                const rs = reader.decode(ac);
                if (rs === null) return finish(gray, planeCols, blockRows * 8, blocksDone, blockCols * blockRows, params);
                const size = rs & 15;
                const run = rs >> 4;
                if (size === 0) {
                  if (run < 15) break;   // end of block
                  k += 16;               // ZRL: sixteen zeroes
                  continue;
                }
                k += run;
                /* v8 ignore next -- a run that overshoots the block is a
                   malformed stream; a conforming encoder emits ZRL instead. */
                if (k > 63) break;
                const raw = reader.receive(size);
                if (raw === null) return finish(gray, planeCols, blockRows * 8, blocksDone, blockCols * blockRows, params);
                if (isLuma) {
                  const pos = ZIGZAG[k] as number;
                  coef[pos] = extend(raw, size) * (quant[pos] as number);
                }
                k++;
              }
            }

            if (isLuma) place(mcuCol * comp.h + h, mcuRow * comp.v + v);
          }
        }
      }
    }
  }
  return finish(gray, planeCols, blockRows * 8, blocksDone, blockCols * blockRows, params);
}

/**
 * A partially-decoded image is still usable if most of it arrived, and is not
 * if it barely started. Half the blocks is the line: below that the tail of the
 * plane is flat zeroes, which would hash as a real gradient.
 */
function finish(
  gray: number[],
  cols: number,
  rows: number,
  blocksDone: number,
  blocksTotal: number,
  params: ScanParams,
): GrayImage | null {
  if (cols < 2 || rows < 1 || blocksDone * 2 < blocksTotal) return null;
  // Crop the MCU padding: the luma plane is a whole number of blocks wide, the
  // image is not. Cropping matters for the hash, since padding columns repeat
  // the edge and would shift the gradient.
  const w = Math.min(cols, params.width);
  const h = Math.min(rows, params.height);
  if (w === cols && h === rows) return { gray, cols, rows };
  const out = new Array<number>(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out[y * w + x] = gray[y * cols + x] as number;
  }
  return { gray: out, cols: w, rows: h };
}

// ── Entry point ──────────────────────────────────────────────────────────────

/** Decode PNG or JPEG bytes to grayscale, or null for anything else. */
export async function decodeGrayscale(bytes: Uint8Array): Promise<GrayImage | null> {
  if (startsWith(bytes, PNG_MAGIC)) return decodePngGray(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return decodeJpegGray(bytes);
  return null;
}
