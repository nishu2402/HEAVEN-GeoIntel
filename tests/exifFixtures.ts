// Hand-built image fixtures shared by the EXIF parser test and the panel test.
// Everything is assembled byte-by-byte so both suites exercise the parser
// against a layout we fully control, in either endianness.

export type Field =
  | { tag: number; type: 2; ascii: string }
  | { tag: number; type: 1 | 3 | 4; ints: number[] }
  | { tag: number; type: 5 | 10; rationals: [number, number][] };

function u16b(le: boolean, n: number): number[] {
  const lo = n & 0xff, hi = (n >> 8) & 0xff;
  return le ? [lo, hi] : [hi, lo];
}
function u32b(le: boolean, n: number): number[] {
  const b = [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
  return le ? b : b.reverse();
}
function pad4(bytes: number[]): number[] {
  const out = bytes.slice(0, 4);
  while (out.length < 4) out.push(0);
  return out;
}

function encode(le: boolean, f: Field): { count: number; bytes: number[] } {
  // Property-presence narrowing is robust across TS versions; a discriminant
  // union over `type` did not narrow cleanly here.
  if ("ascii" in f) {
    const chars = [...f.ascii].map((c) => c.charCodeAt(0));
    chars.push(0);
    return { count: chars.length, bytes: chars };
  }
  if ("rationals" in f) {
    const bytes: number[] = [];
    for (const [n, d] of f.rationals) { bytes.push(...u32b(le, n), ...u32b(le, d)); }
    return { count: f.rationals.length, bytes };
  }
  const bytes: number[] = [];
  for (const n of f.ints) bytes.push(...(f.type === 1 ? [n & 0xff] : f.type === 3 ? u16b(le, n) : u32b(le, n)));
  return { count: f.ints.length, bytes };
}

export interface TiffSpec { le: boolean; ifd0: Field[]; exif?: Field[]; gps?: Field[] }

export function buildTiff(spec: TiffSpec): number[] {
  const { le } = spec;
  const ifd0 = [...spec.ifd0];
  const ifdSize = (n: number) => 2 + 12 * n + 4;
  const n0 = ifd0.length + (spec.exif ? 1 : 0) + (spec.gps ? 1 : 0);
  const size0 = ifdSize(n0);
  const exifOff = 8 + size0;
  const sizeE = spec.exif ? ifdSize(spec.exif.length) : 0;
  const gpsOff = exifOff + sizeE;
  const sizeG = spec.gps ? ifdSize(spec.gps.length) : 0;
  const dataBase = 8 + size0 + sizeE + sizeG;

  if (spec.exif) ifd0.push({ tag: 0x8769, type: 4, ints: [exifOff] });
  if (spec.gps) ifd0.push({ tag: 0x8825, type: 4, ints: [gpsOff] });

  const data: number[] = [];
  const writeIfd = (fields: Field[]): number[] => {
    const out: number[] = [...u16b(le, fields.length)];
    for (const f of fields) {
      const { count, bytes } = encode(le, f);
      let slot: number[];
      if (bytes.length <= 4) {
        slot = pad4(bytes);
      } else {
        slot = u32b(le, dataBase + data.length);
        data.push(...bytes);
        if (data.length % 2) data.push(0);
      }
      out.push(...u16b(le, f.tag), ...u16b(le, f.type), ...u32b(le, count), ...slot);
    }
    out.push(...u32b(le, 0));
    return out;
  };

  const header = [...(le ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16b(le, 42), ...u32b(le, 8)];
  const ifd0Bytes = writeIfd(ifd0);
  const exifBytes = spec.exif ? writeIfd(spec.exif) : [];
  const gpsBytes = spec.gps ? writeIfd(spec.gps) : [];
  return [...header, ...ifd0Bytes, ...exifBytes, ...gpsBytes, ...data];
}

export function buildJpeg(opts: { tiff?: number[]; sof?: { w: number; h: number }; extraApp1?: boolean }): Uint8Array {
  const out: number[] = [0xff, 0xd8, 0xff, 0xd0]; // SOI + a standalone RSTn
  if (opts.extraApp1) {
    const payload = [...[..."http://ns.adobe.com/xap/1.0/\0"].map((c) => c.charCodeAt(0))];
    const len = payload.length + 2;
    out.push(0xff, 0xe1, (len >> 8) & 0xff, len & 0xff, ...payload);
  }
  if (opts.tiff) {
    const len = opts.tiff.length + 8;
    out.push(0xff, 0xe1, (len >> 8) & 0xff, len & 0xff, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...opts.tiff);
  }
  if (opts.sof) {
    out.push(0xff, 0xc0, 0x00, 0x0b, 0x08,
      (opts.sof.h >> 8) & 0xff, opts.sof.h & 0xff,
      (opts.sof.w >> 8) & 0xff, opts.sof.w & 0xff,
      0x01, 0x01, 0x11, 0x00);
  }
  out.push(0xff, 0xd9);
  return new Uint8Array(out);
}

function pngChunk(type: string, data: number[]): number[] {
  const t = [...type].map((c) => c.charCodeAt(0));
  const len = [(data.length >>> 24) & 0xff, (data.length >> 16) & 0xff, (data.length >> 8) & 0xff, data.length & 0xff];
  return [...len, ...t, ...data, 0, 0, 0, 0];
}

export function buildPng(opts: { w: number; h: number; tiff?: number[] }): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdr = pngChunk("IHDR", [
    (opts.w >>> 24) & 0xff, (opts.w >> 16) & 0xff, (opts.w >> 8) & 0xff, opts.w & 0xff,
    (opts.h >>> 24) & 0xff, (opts.h >> 16) & 0xff, (opts.h >> 8) & 0xff, opts.h & 0xff,
    8, 2, 0, 0, 0,
  ]);
  const gama = pngChunk("gAMA", [0, 0, 0, 1]);
  const exif = opts.tiff ? pngChunk("eXIf", opts.tiff) : [];
  const iend = pngChunk("IEND", []);
  return new Uint8Array([...sig, ...ihdr, ...gama, ...exif, ...iend]);
}

/** A JPEG with camera tags but no GPS IFD. */
export function jpegExifNoGps(): Uint8Array {
  return buildJpeg({
    sof: { w: 800, h: 600 },
    tiff: buildTiff({
      le: true,
      ifd0: [
        { tag: 0x010f, type: 2, ascii: "Fujifilm" },
        { tag: 0x0110, type: 2, ascii: "X-T5" },
      ],
      exif: [{ tag: 0x8827, type: 4, ints: [800] }],
    }),
  });
}

/** A JPEG with a GPS fix but no altitude or heading recorded. */
export function jpegGpsNoAlt(): Uint8Array {
  return buildJpeg({
    tiff: buildTiff({
      le: true,
      ifd0: [{ tag: 0x0110, type: 2, ascii: "Pixel" }],
      gps: [
        { tag: 0x01, type: 2, ascii: "N" },
        { tag: 0x02, type: 5, rationals: [[48, 1], [51, 1], [0, 1]] },
        { tag: 0x03, type: 2, ascii: "E" },
        { tag: 0x04, type: 5, rationals: [[2, 1], [21, 1], [0, 1]] },
      ],
    }),
  });
}

/** A JPEG carrying camera tags + a GPS fix (Pittsburgh-ish), for panel tests. */
export function jpegWithGps(): Uint8Array {
  return buildJpeg({
    sof: { w: 4000, h: 3000 },
    tiff: buildTiff({
      le: true,
      ifd0: [
        { tag: 0x010f, type: 2, ascii: "Apple" },
        { tag: 0x0110, type: 2, ascii: "iPhone 15 Pro" },
        { tag: 0x0132, type: 2, ascii: "2023:10:04 12:34:56" },
        { tag: 0x0112, type: 3, ints: [1] },
      ],
      exif: [
        { tag: 0x829d, type: 5, rationals: [[28, 10]] },
        { tag: 0x829a, type: 5, rationals: [[1, 250]] },
        { tag: 0x8827, type: 4, ints: [200] },
        { tag: 0x920a, type: 5, rationals: [[24, 1]] },
      ],
      gps: [
        { tag: 0x01, type: 2, ascii: "N" },
        { tag: 0x02, type: 5, rationals: [[40, 1], [26, 1], [46, 1]] },
        { tag: 0x03, type: 2, ascii: "W" },
        { tag: 0x04, type: 5, rationals: [[79, 1], [58, 1], [56, 1]] },
        { tag: 0x05, type: 3, ints: [0] },
        { tag: 0x06, type: 5, rationals: [[100, 1]] },
        { tag: 0x11, type: 5, rationals: [[215, 1]] },
      ],
    }),
  });
}
