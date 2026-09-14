// ── What a still image says beyond its EXIF ──────────────────────────────────
//
// `parseExif` reads the camera block. It is not the only place an image keeps
// metadata, and for anything that did not come straight off a camera it is
// usually the emptiest:
//
//   * a PNG has no EXIF tradition at all. It keeps text chunks instead, and
//     those are where editors write their name, where screenshot tools write
//     the machine's, and where image generators write the full prompt, model
//     and seed that produced the picture.
//   * a JPEG that has been through a picture desk carries an IPTC block: the
//     photographer's byline, the agency credit, the caption, and the city and
//     country the frame was taken in, none of which EXIF holds.
//   * the JPEG stream itself states how it was encoded, and a progressive scan
//     with a particular component layout is a recognisable signature of the
//     software that wrote it.
//   * GIF, BMP and WebP keep their own smaller sets: animation length, loop
//     count, a comment block, print resolution, an alpha channel.
//
// All of it is read here from the container structure, bounded at every step.
// Nothing is inferred from the pixels, and a chunk that is malformed is skipped
// rather than guessed at.

import { Reader } from "./bytes";
import { inflate } from "./inflate";
import { xmpFields, xmpPacket, XMP_IMAGE } from "./xmp";
import type { Extraction, MetaField } from "./types";

const push = (fields: MetaField[], label: string, value: string | null, group: string, sensitive?: boolean) => {
  if (value !== null && value !== "") fields.push({ label, value, group, sensitive });
};

// ── PNG ──────────────────────────────────────────────────────────────────────

const PNG_COLOR: Record<number, string> = {
  0: "greyscale", 2: "truecolour", 3: "indexed", 4: "greyscale with alpha", 6: "truecolour with alpha",
};

// Text keywords a PNG may carry. The registered ones are fixed by the spec; the
// rest are conventions that specific tools write, and those are the interesting
// ones: "parameters" is how Stable Diffusion stores the prompt that made the
// image, and "prompt"/"workflow" are ComfyUI's equivalents.
const PNG_TEXT: Record<string, { label: string; sensitive?: boolean }> = {
  Title: { label: "Title" },
  Author: { label: "Author", sensitive: true },
  Description: { label: "Description" },
  Copyright: { label: "Copyright" },
  Software: { label: "Software", sensitive: true },
  Comment: { label: "Comment" },
  Disclaimer: { label: "Disclaimer" },
  Source: { label: "Source", sensitive: true },
  "Creation Time": { label: "Creation time", sensitive: true },
  parameters: { label: "Generation parameters", sensitive: true },
  prompt: { label: "Generation prompt", sensitive: true },
  workflow: { label: "Generation workflow", sensitive: true },
};

// A text chunk is metadata, not content: 8 KiB is far more than any real
// keyword/value pair and still bounds a chunk built to fill the panel.
const MAX_TEXT = 8192;

const trimText = (s: string) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT)}…` : t;
};

/** Split a NUL-separated PNG text chunk into its leading fields and the rest. */
function splitNul(bytes: Uint8Array, parts: number): { head: string[]; rest: Uint8Array } {
  const head: string[] = [];
  let start = 0;
  let i = 0;
  for (; i < bytes.length && head.length < parts; i++) {
    if (bytes[i] !== 0) continue;
    head.push(new TextDecoder("latin1").decode(bytes.subarray(start, i)));
    start = i + 1;
  }
  return { head, rest: bytes.subarray(start) };
}

/** Decode one text chunk's keyword and value, inflating a compressed one. */
async function pngText(type: string, data: Uint8Array): Promise<{ keyword: string; value: string } | null> {
  if (type === "tEXt") {
    const { head, rest } = splitNul(data, 1);
    if (head.length !== 1) return null;
    return { keyword: head[0], value: new TextDecoder("latin1").decode(rest) };
  }
  if (type === "zTXt") {
    // keyword NUL, compression method byte, then a zlib stream.
    const { head, rest } = splitNul(data, 1);
    if (head.length !== 1) return null;
    const out = await inflate(rest.subarray(1), "deflate");
    return out === null ? null : { keyword: head[0], value: new TextDecoder("latin1").decode(out) };
  }
  // iTXt: keyword NUL, compression flag, compression method, language NUL,
  // translated keyword NUL, then UTF-8 text, compressed when the flag is set.
  const { head, rest } = splitNul(data, 1);
  if (head.length !== 1 || rest.length < 2) return null;
  const compressed = rest[0] === 1;
  const after = splitNul(rest.subarray(2), 2);
  if (after.head.length !== 2) return null;
  if (!compressed) return { keyword: head[0], value: new TextDecoder("utf-8").decode(after.rest) };
  const out = await inflate(after.rest, "deflate");
  return out === null ? null : { keyword: head[0], value: new TextDecoder("utf-8").decode(out) };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Big-endian 32-bit read inside a chunk whose length is already checked. */
const be32 = (d: Uint8Array, o: number) => d[o] * 0x1000000 + d[o + 1] * 0x10000 + d[o + 2] * 0x100 + d[o + 3];

/** Read every metadata chunk a PNG carries beyond its pixels. */
export async function extractPng(bytes: Uint8Array): Promise<Extraction> {
  const r = new Reader(bytes);
  const fields: MetaField[] = [];
  const notes: string[] = [];
  const b = r.bytes;

  let p = 8; // after the signature
  let generated = false;
  let textCount = 0;
  // Each iteration needs the 8-byte chunk header, which the loop bound
  // guarantees, so the length and type read straight off the buffer.
  while (p + 8 <= r.length) {
    const len = b[p] * 0x1000000 + b[p + 1] * 0x10000 + b[p + 2] * 0x100 + b[p + 3];
    const type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
    const data = r.slice(p + 8, len);
    if (data === null) break; // the chunk runs past the end of the file
    if (type === "IHDR" && data.length >= 13) {
      push(fields, "Bit depth", `${data[8]} bits per channel`, "Image");
      push(fields, "Colour type", PNG_COLOR[data[9]] ?? null, "Image");
      push(fields, "Interlaced", data[12] === 1 ? "yes (Adam7)" : null, "Image");
    } else if (type === "pHYs" && data.length >= 9 && data[8] === 1) {
      // Pixels per metre, which every tool that sets it writes from a DPI.
      const dpi = Math.round(be32(data, 0) * 0.0254);
      push(fields, "Resolution", dpi > 0 ? `${dpi} DPI` : null, "Image");
    } else if (type === "tIME" && data.length >= 7) {
      const y = (data[0] << 8) | data[1];
      push(fields, "Last modified", `${y}-${pad2(data[2])}-${pad2(data[3])} ${pad2(data[4])}:${pad2(data[5])}:${pad2(data[6])}`, "Image");
    } else if (type === "acTL" && data.length >= 8) {
      const plays = be32(data, 4);
      push(fields, "Animation", `${be32(data, 0)} frames, ${plays === 0 ? "looping" : `${plays} plays`}`, "Image");
    } else if (type === "iCCP") {
      push(fields, "Colour profile", splitNul(data, 1).head[0] ?? null, "Image");
    } else if (type === "tEXt" || type === "zTXt" || type === "iTXt") {
      textCount++;
      const text = await pngText(type, data);
      const spec = text ? PNG_TEXT[text.keyword] : undefined;
      if (text && spec) {
        push(fields, spec.label, trimText(text.value), "Text", spec.sensitive);
        if (spec.label.startsWith("Generation")) generated = true;
      } else if (text) {
        push(fields, text.keyword, trimText(text.value), "Text");
      }
    }
    p += 12 + len; // length + type + data + CRC
  }

  // Text chunks may legitimately sit either side of the pixel data, so this is
  // only decided once the whole file has been walked.
  if (textCount === 0) notes.push("This PNG carries no text chunk, so no author, software or comment was recorded in it.");

  const xmp = xmpPacket(new TextDecoder("latin1").decode(bytes));
  if (xmp) fields.push(...xmpFields(xmp, XMP_IMAGE));

  if (generated) {
    notes.push("This PNG carries image-generation parameters, which is how Stable Diffusion and ComfyUI record the prompt, model and seed that produced a picture. Treat the text as the tool's own record of how the image was made.");
  }
  return { fields, notes };
}

// ── JPEG ─────────────────────────────────────────────────────────────────────

const SOF_KIND: Record<number, string> = {
  0xc0: "baseline", 0xc1: "extended sequential", 0xc2: "progressive", 0xc3: "lossless",
  0xc9: "arithmetic extended sequential", 0xca: "arithmetic progressive",
};

const COMPONENTS: Record<number, string> = { 1: "greyscale", 3: "colour (YCbCr)", 4: "CMYK / YCCK" };

const JFIF_UNITS: Record<number, string> = { 1: "DPI", 2: "dots per cm" };

// IPTC IIM datasets, the block a picture desk fills in. These are the fields
// that name the photographer and place the frame, and they survive the crops
// and re-saves that strip EXIF.
const IPTC: Record<number, { label: string; sensitive?: boolean }> = {
  5: { label: "Object name" },
  25: { label: "Keywords" },
  55: { label: "Date created", sensitive: true },
  80: { label: "Photographer", sensitive: true },
  85: { label: "Photographer title", sensitive: true },
  90: { label: "City", sensitive: true },
  92: { label: "Sublocation", sensitive: true },
  95: { label: "State", sensitive: true },
  101: { label: "Country", sensitive: true },
  105: { label: "Headline" },
  110: { label: "Credit" },
  115: { label: "Source", sensitive: true },
  116: { label: "Copyright" },
  120: { label: "Caption" },
  122: { label: "Caption writer", sensitive: true },
};

/** Read the IPTC IIM datasets out of a Photoshop APP13 segment. */
function readIptc(r: Reader, start: number, end: number, fields: MetaField[]): void {
  const seen = new Map<number, string[]>();
  const b = r.bytes;
  let p = start;
  // The loop bound guarantees the whole 5-byte tag header is in range, so it
  // reads straight off the buffer. IIM lengths are big-endian.
  while (p + 5 <= end) {
    if (b[p] !== 0x1c) { p++; continue; } // resynchronise on the tag marker
    const record = b[p + 1];
    const dataset = b[p + 2];
    const len = (b[p + 3] << 8) | b[p + 4];
    const value = record === 2 && IPTC[dataset] ? r.utf8(p + 5, len) : null;
    if (value) {
      const list = seen.get(dataset) ?? [];
      list.push(value);
      seen.set(dataset, list);
    }
    p += 5 + len;
  }
  // A dataset may repeat (keywords in particular), so the values are joined
  // rather than the last one silently winning.
  for (const [dataset, values] of seen) {
    const spec = IPTC[dataset];
    push(fields, spec.label, values.join(", "), "IPTC", spec.sensitive);
  }
}

/** The human-readable description inside an ICC profile, or null. */
function iccDescription(r: Reader, base: number): string | null {
  const count = r.u32(base + 128);
  if (count === null || count > 256) return null;
  for (let i = 0; i < count; i++) {
    const entry = base + 132 + i * 12;
    if (r.ascii(entry, 4) !== "desc") continue;
    const off = r.u32(entry + 4);
    if (off === null) return null;
    const at = base + off;
    const type = r.ascii(at, 4);
    // ICC v2 stores an ASCII count then the string; v4 uses a Unicode record.
    if (type === "desc") return r.ascii(at + 12, r.u32(at + 8) ?? 0);
    if (type === "mluc") {
      const len = r.u32(at + 20);
      const strOff = r.u32(at + 24);
      if (len === null || strOff === null) return null;
      const utf16 = r.slice(at + strOff, len);
      return utf16 ? new TextDecoder("utf-16be").decode(utf16).replace(/\0+$/, "") || null : null;
    }
    return null;
  }
  return null;
}

/** Walk a JPEG's marker segments for everything EXIF does not cover. */
export function extractJpeg(bytes: Uint8Array): Extraction {
  const r = new Reader(bytes);
  const fields: MetaField[] = [];
  const notes: string[] = [];
  const comments: string[] = [];
  let p = 2; // after SOI

  const b = r.bytes;
  // The loop bound guarantees the marker and its length are in range.
  while (p + 4 <= r.length) {
    if (b[p] !== 0xff) break;               // not a marker: the entropy-coded scan
    const marker = b[p + 1];
    if (marker === 0xd9) break;             // EOI
    if (marker === 0xff) { p++; continue; } // a fill byte before the marker
    // Segment lengths are big-endian and count their own two bytes.
    const len = (b[p + 2] << 8) | b[p + 3];
    if (len < 2) break; // a segment shorter than its own length field
    const body = p + 4;
    const end = body + len - 2;

    if (SOF_KIND[marker]) {
      push(fields, "Encoding", SOF_KIND[marker], "Image");
      const precision = r.u8(body);
      push(fields, "Sample precision", precision === null ? null : `${precision}-bit`, "Image");
      const components = r.u8(body + 5);
      push(fields, "Colour model", components === null ? null : COMPONENTS[components] ?? `${components} components`, "Image");
    } else if (marker === 0xe0 && r.ascii(body, 4) === "JFIF") {
      const unit = r.u8(body + 7);
      const x = r.u16(body + 8);
      const y = r.u16(body + 10);
      if (unit !== null && x !== null && y !== null && JFIF_UNITS[unit]) {
        push(fields, "Resolution", `${x} × ${y} ${JFIF_UNITS[unit]}`, "Image");
      }
      const tw = r.u8(body + 12);
      const th = r.u8(body + 13);
      if (tw && th) push(fields, "Embedded thumbnail", `${tw} × ${th} px`, "Image");
    } else if (marker === 0xed && r.ascii(body, 9) === "Photoshop") {
      readIptc(r, body, Math.min(end, r.length), fields);
    } else if (marker === 0xe2 && r.ascii(body, 11) === "ICC_PROFILE") {
      push(fields, "Colour profile", iccDescription(r, body + 14), "Image");
    } else if (marker === 0xe2 && r.ascii(body, 3) === "MPF") {
      notes.push("Carries a Multi-Picture block: the file holds more than one image, which is how iPhone HDR and depth-effect photos store the extra frames.");
    } else if (marker === 0xee && r.ascii(body, 5) === "Adobe") {
      push(fields, "Written by", "Adobe (APP14 colour transform present)", "Image");
    } else if (marker === 0xfe) {
      const text = r.utf8(body, len - 2);
      if (text) comments.push(trimText(text));
    } else if (marker === 0xda) {
      break; // start of scan: the compressed image data, with no more segments
    }
    p = end;
  }

  if (comments.length) push(fields, "Comment", comments.join(" | "), "Image");

  const xmp = xmpPacket(new TextDecoder("latin1").decode(bytes));
  if (xmp) fields.push(...xmpFields(xmp, XMP_IMAGE));

  return { fields, notes };
}

// ── GIF ──────────────────────────────────────────────────────────────────────

/** Frame count, loop behaviour and comment blocks from a GIF's block stream. */
export function extractGif(bytes: Uint8Array): Extraction {
  const r = new Reader(bytes);
  const fields: MetaField[] = [];
  push(fields, "Version", r.ascii(0, 6), "Image");

  const flags = r.u8(10) ?? 0;
  if (flags & 0x80) push(fields, "Palette", `${2 ** ((flags & 0x07) + 1)} colours (global)`, "Image");

  // Skip the global colour table, then walk the blocks.
  let p = 13 + ((flags & 0x80) ? 3 * 2 ** ((flags & 0x07) + 1) : 0);
  let frames = 0;
  let loops: number | null = null;
  const comments: string[] = [];
  let delay = 0;

  /** Walk a chain of length-prefixed sub-blocks, returning their bytes. */
  const subBlocks = (from: number): { data: number[]; next: number } => {
    const data: number[] = [];
    let q = from;
    for (;;) {
      const size = r.u8(q);
      if (size === null || size === 0) return { data, next: q + 1 };
      const chunk = r.slice(q + 1, size);
      if (chunk) data.push(...chunk);
      q += 1 + size;
    }
  };

  while (p < r.length) {
    const block = r.u8(p);
    if (block === 0x2c) { // image descriptor: one frame
      frames++;
      const local = r.u8(p + 9) ?? 0;
      const after = p + 10 + ((local & 0x80) ? 3 * 2 ** ((local & 0x07) + 1) : 0);
      p = subBlocks(after + 1).next; // LZW minimum code size, then the data
      continue;
    }
    if (block !== 0x21) break; // trailer (0x3b) or a byte that is not a block
    const label = r.u8(p + 1);
    const body = subBlocks(p + 2);
    if (label === 0xf9 && body.data.length >= 4) delay += body.data[1] | (body.data[2] << 8);
    else if (label === 0xfe) comments.push(trimText(new TextDecoder("utf-8").decode(new Uint8Array(body.data))));
    else if (label === 0xff && body.data.length >= 14) {
      // NETSCAPE2.0 application extension: an 11-byte identifier, then a
      // sub-block whose first byte is 1 and whose next two are the loop count.
      loops = body.data[12] | (body.data[13] << 8);
    }
    p = body.next;
  }

  if (frames > 0) push(fields, "Frames", String(frames), "Image");
  if (frames > 1 && delay > 0) push(fields, "Duration", `${(delay / 100).toFixed(2)} s`, "Image");
  if (loops !== null) push(fields, "Loops", loops === 0 ? "forever" : String(loops), "Image");
  if (comments.length) push(fields, "Comment", comments.join(" | "), "Image", true);
  return { fields };
}

// ── BMP ──────────────────────────────────────────────────────────────────────

const BMP_COMPRESSION: Record<number, string> = {
  0: "none (BI_RGB)", 1: "8-bit RLE", 2: "4-bit RLE", 3: "bitfields", 4: "JPEG", 5: "PNG",
};

export function extractBmp(bytes: Uint8Array): Extraction {
  const r = new Reader(bytes);
  const fields: MetaField[] = [];
  if ((r.u32(14, true) ?? 0) < 40) return { fields }; // the legacy header has none of this
  const bits = r.u16(28, true);
  push(fields, "Bit depth", bits ? `${bits} bits per pixel` : null, "Image");
  const compression = r.u32(30, true);
  push(fields, "Compression", compression === null ? null : BMP_COMPRESSION[compression] ?? null, "Image");
  const ppm = r.u32(38, true);
  const dpi = Math.round((ppm ?? 0) * 0.0254);
  push(fields, "Resolution", dpi > 0 ? `${dpi} DPI` : null, "Image");
  const colours = r.u32(46, true);
  push(fields, "Palette", colours ? `${colours} colours` : null, "Image");
  return { fields };
}

// ── WebP ─────────────────────────────────────────────────────────────────────

export function extractWebp(bytes: Uint8Array): Extraction {
  const r = new Reader(bytes);
  const fields: MetaField[] = [];
  const b = r.bytes;
  let frames = 0;
  let duration = 0;
  let loops: number | null = null;
  const flavours: string[] = [];

  let p = 12;
  while (p + 8 <= r.length) {
    const fourcc = String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
    const size = b[p + 4] + b[p + 5] * 0x100 + b[p + 6] * 0x10000 + b[p + 7] * 0x1000000;
    const data = p + 8;
    if (fourcc === "VP8X") {
      const flags = b[data] ?? 0;
      if (flags & 0x10) flavours.push("alpha channel");
      if (flags & 0x02) flavours.push("animated");
    } else if (fourcc === "VP8L") flavours.push("lossless");
    else if (fourcc === "VP8 ") flavours.push("lossy");
    // The size guards matter: without them a chunk truncated to its header
    // would have the *next* chunk's bytes read as its loop count or duration.
    else if (fourcc === "ANIM" && size >= 6) loops = r.u16(data + 4, true);
    else if (fourcc === "ANMF" && size >= 16) { frames++; duration += (r.u32(data + 12, true) ?? 0) & 0xffffff; }
    else if (fourcc === "ICCP") push(fields, "Colour profile", iccDescription(r, data), "Image");
    else if (fourcc === "XMP ") {
      const text = r.utf8(data, size);
      if (text) { const packet = xmpPacket(text); if (packet) fields.push(...xmpFields(packet, XMP_IMAGE)); }
    }
    p = data + size + (size & 1);
  }

  if (flavours.length) push(fields, "Encoding", flavours.join(", "), "Image");
  if (frames > 0) push(fields, "Frames", String(frames), "Image");
  if (duration > 0) push(fields, "Duration", `${(duration / 1000).toFixed(2)} s`, "Image");
  if (loops !== null) push(fields, "Loops", loops === 0 ? "forever" : String(loops), "Image");
  return { fields };
}

/** Format-specific still-image metadata, beyond what the EXIF reader covers. */
export async function extractRaster(kind: string, bytes: Uint8Array): Promise<Extraction> {
  if (kind === "png") return extractPng(bytes);
  if (kind === "jpeg") return extractJpeg(bytes);
  if (kind === "gif") return extractGif(bytes);
  if (kind === "bmp") return extractBmp(bytes);
  if (kind === "webp") return extractWebp(bytes);
  return { fields: [] };
}
