// ── ISO base media (MP4 / MOV / M4A / HEIC / AVIF) metadata ──────────────────
//
// One container format underlies the iPhone camera roll: still photos (HEIC),
// videos (MOV/MP4) and audio (M4A) are all boxes in an ISO base media file. That
// is why this walker matters most for GEOINT: an iPhone video records the exact
// capture coordinate in a `©xyz` location atom, and its make/model/software/
// creation-date in an Apple metadata table, while a HEIC photo carries a full
// EXIF block. This module pulls all of that out by walking the box tree with a
// depth bound, descending only into real container boxes so leaf bytes are never
// misread as structure, and validating every coordinate before it is trusted.

import { readExifBlock, type ImageMeta } from "../exif";
import { Reader, asciiBytes } from "./bytes";
import type { Extraction, MetaField } from "./types";
import type { GpsFix } from "../exif";

const XYZ = "©xyz"; // the Apple/Android location atom, "©xyz"
const MP4_EPOCH_OFFSET = 2082844800; // seconds between 1904-01-01 and 1970-01-01
const MAX_DEPTH = 8;

// Boxes whose payload is a list of child boxes. The tree walk descends only into
// these, so a leaf box's arbitrary bytes are never parsed as though they were
// boxes (which is how naive walkers manufacture phantom metadata).
const CONTAINERS = new Set([
  "moov", "trak", "mdia", "minf", "stbl", "udta", "edts", "mvex",
  "moof", "traf", "iprp", "ipco", "dinf", "gmhd",
]);

interface Box { type: string; dataStart: number; end: number }

/** Immediate child boxes within [start, end), bounded against hostile sizes. */
function children(r: Reader, start: number, end: number): Box[] {
  const b = r.bytes;
  const limit = Math.min(end, r.length);
  const out: Box[] = [];
  let p = start;
  // Each iteration advances `p` by at least the 8-byte header, so the buffer
  // bound alone guarantees termination.
  while (p + 8 <= limit) {
    const size32 = b[p] * 0x1000000 + b[p + 1] * 0x10000 + b[p + 2] * 0x100 + b[p + 3];
    const type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
    let headerLen = 8;
    let size = size32;
    if (size32 === 1) {
      // 64-bit largesize follows the type; a real value never exceeds 2^53, so
      // the eight bytes (guaranteed in range by the check above) read exactly.
      if (p + 16 > limit) break;
      size = b[p + 8] * 0x100000000000000 + b[p + 9] * 0x1000000000000 + b[p + 10] * 0x10000000000
        + b[p + 11] * 0x100000000 + b[p + 12] * 0x1000000 + b[p + 13] * 0x10000 + b[p + 14] * 0x100 + b[p + 15];
      headerLen = 16;
    } else if (size32 === 0) {
      size = limit - p; // extends to the end of the parent
    }
    if (size < headerLen) break;
    out.push({ type, dataStart: p + headerLen, end: Math.min(p + size, limit) });
    p += size;
  }
  return out;
}

/** First child of `type` within [start, end). */
function firstChild(r: Reader, start: number, end: number, type: string): Box | null {
  for (const box of children(r, start, end)) if (box.type === type) return box;
  return null;
}

/**
 * Depth-bounded search for every box of `type` reachable through container
 * boxes. Used for boxes that sit at a variable depth (ispe inside iprp/ipco).
 */
function findAll(r: Reader, start: number, end: number, type: string, depth = 0): Box[] {
  if (depth > MAX_DEPTH) return [];
  const out: Box[] = [];
  for (const box of children(r, start, end)) {
    if (box.type === type) out.push(box);
    if (CONTAINERS.has(box.type)) out.push(...findAll(r, box.dataStart, box.end, type, depth + 1));
  }
  return out;
}

// Unix seconds at the year-3000 boundary. A capture time beyond this is not a
// real timestamp (usually an all-ones "unset" field), and it also keeps the
// millisecond value well inside the range `Date` can represent.
const MAX_UNIX = 32503680000;

/** MP4 timestamp (seconds since 1904) to "YYYY-MM-DD HH:MM:SS" UTC, or null. */
function mp4Date(t: number | null): string | null {
  if (t === null || t <= MP4_EPOCH_OFFSET) return null; // 0 = unset; <= epoch = pre-1970, invalid
  const unix = t - MP4_EPOCH_OFFSET;
  if (unix > MAX_UNIX) return null;
  return new Date(unix * 1000).toISOString().replace("T", " ").slice(0, 19);
}

/** Seconds to a compact "1h 02m 03s" / "2m 03s" / "5s" duration. */
function formatDuration(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (h > 0) return `${h}h ${pad(m)}m ${pad(r)}s`;
  if (m > 0) return `${m}m ${pad(r)}s`;
  return `${r}s`;
}

/** Parse an ISO 6709 location string ("+34.0679-118.4382+010.000/") to a fix. */
export function parseIso6709(s: string): GpsFix | null {
  const m = /^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)?/.exec(s.trim());
  if (!m) return null;
  const latitude = parseFloat(m[1]);
  const longitude = parseFloat(m[2]);
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  const altitude = m[3] !== undefined ? parseFloat(m[3]) : null;
  return { latitude, longitude, altitude, direction: null };
}

/** The movie header: creation/modification time, timescale and duration. */
function readMvhd(r: Reader, dataStart: number): MetaField[] {
  const version = r.u8(dataStart);
  if (version === null) return [];
  const wide = version === 1;
  const created = wide ? r.u64(dataStart + 4) : r.u32(dataStart + 4);
  const modified = wide ? r.u64(dataStart + 12) : r.u32(dataStart + 8);
  const timescale = wide ? r.u32(dataStart + 20) : r.u32(dataStart + 12);
  const duration = wide ? r.u64(dataStart + 24) : r.u32(dataStart + 16);

  const fields: MetaField[] = [];
  const c = mp4Date(created);
  if (c) fields.push({ label: "Created", value: c, group: "Media", sensitive: true });
  const mod = mp4Date(modified);
  if (mod) fields.push({ label: "Modified", value: mod, group: "Media" });
  if (timescale !== null && timescale > 0 && duration !== null)
    fields.push({ label: "Duration", value: formatDuration(duration / timescale), group: "Media" });
  return fields;
}

/** Read a `data` value box's text payload (type indicator 1 = UTF-8). */
function readDataAtom(r: Reader, box: Box): string | null {
  const data = firstChild(r, box.dataStart, box.end, "data");
  if (!data) return null;
  const type = r.u32(data.dataStart);
  if (type !== 1) return null; // only decode declared UTF-8 text, never guess
  return r.utf8(data.dataStart + 8, data.end - (data.dataStart + 8));
}

// Apple QuickTime metadata keys → the field they populate.
const APPLE_KEYS: Record<string, { label: string; group: string; kind: "make" | "model" | "software" | "date" | "gps" }> = {
  "com.apple.quicktime.make": { label: "Make", group: "Device", kind: "make" },
  "com.apple.quicktime.model": { label: "Model", group: "Device", kind: "model" },
  "com.apple.quicktime.software": { label: "Software", group: "Device", kind: "software" },
  "com.apple.quicktime.creationdate": { label: "Capture date", group: "Media", kind: "date" },
  "com.apple.quicktime.location.ISO6709": { label: "Location", group: "Location", kind: "gps" },
};

/** iTunes-style four-character-code atoms found directly in an M4A `ilst`. */
const ILST_4CC: Record<string, { label: string; group: string }> = {
  "©nam": { label: "Title", group: "Media" },
  "©ART": { label: "Artist", group: "Media" },
  "©alb": { label: "Album", group: "Media" },
  "©day": { label: "Year", group: "Media" },
  "©too": { label: "Encoder", group: "Media" },
  "©cmt": { label: "Comment", group: "Media" },
  "©gen": { label: "Genre", group: "Media" },
};

interface MetaAccum { fields: MetaField[]; gps: GpsFix | null }

/** Apple keyed metadata table: a `keys` box names entries an `ilst` fills in. */
function readAppleKeyed(r: Reader, metaStart: number, metaEnd: number, acc: MetaAccum): boolean {
  const keysBox = firstChild(r, metaStart, metaEnd, "keys");
  const ilst = firstChild(r, metaStart, metaEnd, "ilst");
  if (!keysBox || !ilst) return false;

  // keys: fullbox header (4) + entry_count (4), then [size][namespace][name].
  // The loop bound guarantees the 4-byte size is in range, so it is read
  // directly rather than through the nullable accessor.
  const b = r.bytes;
  const keys: string[] = [];
  let p = keysBox.dataStart + 8;
  while (p + 8 <= keysBox.end) {
    const size = b[p] * 0x1000000 + b[p + 1] * 0x10000 + b[p + 2] * 0x100 + b[p + 3];
    if (size < 8) break;
    keys.push(r.ascii(p + 8, size - 8) ?? "");
    p += size;
  }

  // ilst: each entry box's 4-byte "type" is the 1-based index into `keys`.
  for (const entry of children(r, ilst.dataStart, ilst.end)) {
    const idx = fourccToIndex(entry.type);
    const key = keys[idx - 1];
    const spec = key ? APPLE_KEYS[key] : undefined;
    if (!spec) continue;
    const value = readDataAtom(r, entry);
    if (value === null) continue;
    applyAppleField(spec, value, acc);
  }
  return true;
}

/** Interpret an `ilst` entry's four raw bytes as a big-endian index. */
function fourccToIndex(type: string): number {
  return (type.charCodeAt(0) << 24) | (type.charCodeAt(1) << 16) | (type.charCodeAt(2) << 8) | type.charCodeAt(3);
}

function applyAppleField(spec: (typeof APPLE_KEYS)[string], value: string, acc: MetaAccum): void {
  if (spec.kind === "gps") {
    const fix = parseIso6709(value);
    if (fix) acc.gps = fix;
    acc.fields.push({ label: spec.label, value, group: spec.group, sensitive: true });
    return;
  }
  acc.fields.push({ label: spec.label, value, group: spec.group, sensitive: spec.kind !== "software" });
}

/** iTunes M4A metadata: four-character-code atoms with `data` children. */
function readItunes(r: Reader, ilst: Box, acc: MetaAccum): void {
  for (const entry of children(r, ilst.dataStart, ilst.end)) {
    const spec = ILST_4CC[entry.type];
    if (!spec) continue;
    const value = readDataAtom(r, entry);
    if (value !== null) acc.fields.push({ label: spec.label, value, group: spec.group });
  }
}

/**
 * QuickTime `meta` boxes come in two shapes: the ISO form starts with a 4-byte
 * version/flags header, the classic QuickTime form does not. Detect which by
 * checking whether a known child sits at offset 0 or offset 4.
 */
function metaBody(r: Reader, meta: Box): number {
  for (const box of children(r, meta.dataStart, meta.end)) {
    if (box.type === "hdlr" || box.type === "keys" || box.type === "ilst") return meta.dataStart;
  }
  return meta.dataStart + 4;
}

/** Walk moov (and its udta) for times, location and Apple device metadata. */
function readMoov(r: Reader, moov: Box, acc: MetaAccum): void {
  const mvhd = firstChild(r, moov.dataStart, moov.end, "mvhd");
  if (mvhd) acc.fields.push(...readMvhd(r, mvhd.dataStart));

  for (const xyz of findAll(r, moov.dataStart, moov.end, XYZ)) {
    // ©xyz payload: u16 length + u16 language + the ISO 6709 string.
    const len = r.u16(xyz.dataStart);
    if (len === null) continue;
    const s = r.utf8(xyz.dataStart + 4, len);
    if (!s) continue;
    const fix = parseIso6709(s);
    if (fix) { acc.gps = fix; acc.fields.push({ label: "Location", value: s, group: "Location", sensitive: true }); }
  }

  for (const meta of findAll(r, moov.dataStart, moov.end, "meta")) {
    const body = metaBody(r, meta);
    if (readAppleKeyed(r, body, meta.end, acc)) continue;
    const ilst = firstChild(r, body, meta.end, "ilst");
    if (ilst) readItunes(r, ilst, acc);
  }
}

/** HEIC/AVIF spatial extents (ispe): the decoded pixel dimensions. */
function heifDimensions(r: Reader, topEnd: number): { width: number | null; height: number | null } {
  const metas = findAll(r, 0, topEnd, "meta");
  for (const meta of metas) {
    const ispe = findAll(r, meta.dataStart + 4, meta.end, "ispe")[0];
    if (ispe) return { width: r.u32(ispe.dataStart + 4), height: r.u32(ispe.dataStart + 8) };
  }
  return { width: null, height: null };
}

/**
 * A HEIC/AVIF EXIF block is stored as an item whose payload is "Exif\0\0"
 * followed by a TIFF header. Anchoring on that exact marker and then validating
 * the TIFF (readExifBlock returns null for anything that is not a real one)
 * means a coordinate is only ever surfaced from genuine EXIF, never a byte
 * pattern that merely resembles one.
 */
function heifExif(r: Reader): { tags: ImageMeta["tags"]; gps: GpsFix | null } | null {
  const marker = r.indexOf(asciiBytes("Exif\0\0"));
  if (marker < 0) return null;
  return readExifBlock(r.bytes, marker + 6);
}

/**
 * Extract metadata from any ISO base media file. `kind` (from `sniff`) decides
 * whether the result is presented as an image (HEIC/AVIF) or timed media.
 */
export function extractIsoBmff(kind: string, bytes: Uint8Array): Extraction {
  const r = new Reader(bytes);
  const acc: MetaAccum = { fields: [], gps: null };

  const ftyp = firstChild(r, 0, r.length, "ftyp");
  if (ftyp) {
    const brand = r.ascii(ftyp.dataStart, 4);
    if (brand) acc.fields.push({ label: "Brand", value: brand, group: "Container" });
  }

  const moov = firstChild(r, 0, r.length, "moov");
  if (moov) readMoov(r, moov, acc);

  if (kind === "heic" || kind === "avif") {
    const { width, height } = heifDimensions(r, r.length);
    const exif = heifExif(r);
    const image: ImageMeta = {
      format: kind, width, height,
      hasExif: exif !== null,
      gps: exif?.gps ?? acc.gps,
      tags: exif?.tags ?? { make: null, model: null, lens: null, software: null, dateTimeOriginal: null, orientation: null, fNumber: null, exposureTime: null, iso: null, focalLength: null },
    };
    return { fields: acc.fields, gps: image.gps, image };
  }

  return { fields: acc.fields, gps: acc.gps };
}
