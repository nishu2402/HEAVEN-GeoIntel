// ── Raster image metadata beyond JPEG/PNG ───────────────────────────────────
//
// JPEG and PNG are handled by the original `parseExif`. This module covers the
// other still-image containers a target actually sends: WebP (which can carry a
// full EXIF/GPS block, so a WebP export of a phone photo still leaks location),
// GIF, BMP and native TIFF (the raw-photo base format, itself a TIFF/EXIF
// block). Each returns the shared `ImageMeta` shape so the panel renders camera
// and GPS the same way regardless of source. Every read is bounded; a malformed
// image yields whatever geometry was legible and never a throw.

import { EMPTY_TAGS, readExifBlock, type ImageMeta, type ImageFormat } from "../exif";
import { Reader, asciiBytes } from "./bytes";

function base(format: ImageFormat, width: number | null, height: number | null): ImageMeta {
  return { format, width, height, hasExif: false, gps: null, tags: { ...EMPTY_TAGS } };
}

/** Attach a TIFF/EXIF block (if valid) to an image result. */
function withExif(meta: ImageMeta, bytes: Uint8Array, tiffBase: number): ImageMeta {
  const block = readExifBlock(bytes, tiffBase);
  if (block) { meta.hasExif = true; meta.tags = block.tags; meta.gps = block.gps; }
  return meta;
}

/** GIF logical-screen dimensions and the 87a/89a version. */
function readGif(r: Reader): ImageMeta {
  const meta = base("gif", r.u16(6, true), r.u16(8, true));
  return meta;
}

/**
 * BMP dimensions. The modern BITMAPINFOHEADER (size >= 40) stores signed 32-bit
 * width/height; the legacy BITMAPCOREHEADER (size 12) stores unsigned 16-bit.
 * A negative height means a top-down row order, so its magnitude is the height.
 */
function readBmp(r: Reader): ImageMeta {
  const dibSize = r.u32(14, true);
  if (dibSize === 12) return base("bmp", r.u16(18, true), r.u16(20, true));
  const w = r.u32(18, true);
  const h = r.u32(22, true);
  // u32 read then reinterpret the sign for height (width is always positive).
  const height = h === null ? null : (h > 0x7fffffff ? 0x1_0000_0000 - h : h);
  return base("bmp", w, height);
}

/** Walk TIFF IFD0 for the image dimensions (tags 0x0100 / 0x0101). */
function tiffDims(r: Reader): { width: number | null; height: number | null } {
  const le = r.eq(0, asciiBytes("II"));
  const ifd0 = r.u32(4, le);
  if (ifd0 === null) return { width: null, height: null };
  const count = r.u16(ifd0, le);
  if (count === null) return { width: null, height: null };
  let width: number | null = null;
  let height: number | null = null;
  for (let i = 0; i < count; i++) {
    const e = ifd0 + 2 + i * 12;
    const tag = r.u16(e, le);
    const type = r.u16(e + 2, le);
    if (tag === null || type === null) break;
    // SHORT (3) sits in the low 2 bytes of the value slot; LONG (4) fills it.
    const val = type === 3 ? r.u16(e + 8, le) : r.u32(e + 8, le);
    if (tag === 0x0100) width = val;
    else if (tag === 0x0101) height = val;
  }
  return { width, height };
}

function readTiff(r: Reader): ImageMeta {
  const { width, height } = tiffDims(r);
  return withExif(base("tiff", width, height), r.bytes, 0);
}

/** WebP: canvas dimensions from the VP8/VP8L/VP8X chunk, plus an EXIF block. */
function readWebp(r: Reader): ImageMeta {
  let width: number | null = null;
  let height: number | null = null;
  let exifBase: number | null = null;

  // Chunks begin at offset 12, each: 4CC + u32le size + payload (padded even).
  // The loop condition guarantees eight readable bytes, so the fourcc and size
  // are read straight off the buffer without a nullable path.
  const b = r.bytes;
  let p = 12;
  while (p + 8 <= r.length) {
    const fourcc = String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
    const size = b[p + 4] + b[p + 5] * 0x100 + b[p + 6] * 0x10000 + b[p + 7] * 0x1000000;
    const data = p + 8;
    if (fourcc === "VP8X") {
      // 1 flags byte + 3 reserved, then 24-bit LE (width-1) and (height-1).
      const w = r.u32(data + 4, true);
      const h = r.u32(data + 7, true);
      if (w !== null) width = (w & 0xffffff) + 1;
      if (h !== null) height = (h & 0xffffff) + 1;
    } else if (fourcc === "VP8L") {
      // Signature byte 0x2f, then packed 14-bit (width-1) and (height-1).
      const bits = r.u32(data + 1, true);
      if (bits !== null) {
        width = (bits & 0x3fff) + 1;
        height = ((bits >> 14) & 0x3fff) + 1;
      }
    } else if (fourcc === "VP8 ") {
      // Lossy key frame: 3-byte tag, 3-byte start code, then 14-bit dims.
      width = wordMask(r.u16(data + 6, true));
      height = wordMask(r.u16(data + 8, true));
    } else if (fourcc === "EXIF") {
      exifBase = data;
    }
    p = data + size + (size & 1); // chunks are padded to an even length
  }

  const meta = base("webp", width, height);
  return exifBase === null ? meta : withExif(meta, r.bytes, exifBase);
}

/** A VP8 dimension is the low 14 bits of a 16-bit little-endian word. */
function wordMask(v: number | null): number | null {
  return v === null ? null : v & 0x3fff;
}

/**
 * Rich image metadata for the raster formats beyond JPEG/PNG. Returns null for a
 * kind this module does not handle, so the orchestrator can fall through to the
 * right parser.
 */
export function extractImage(kind: string, bytes: Uint8Array): ImageMeta | null {
  const r = new Reader(bytes);
  switch (kind) {
    case "gif": return readGif(r);
    case "bmp": return readBmp(r);
    case "tiff": return readTiff(r);
    case "webp": return readWebp(r);
    default: return null;
  }
}
