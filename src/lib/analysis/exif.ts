// ── Client-side image metadata / EXIF extraction (no network, no upload) ─────
//
// GEOINT starts with a photo. This module pulls the analyst-relevant metadata
// out of an image's own bytes — camera make/model, capture time, and above all
// GPS coordinates — entirely in the browser. The image is never uploaded, which
// is both the correct opsec posture (the file, and any location it carries,
// never leaves the operator's machine) and the reason this lives in `analysis/`
// as a pure function rather than behind an API route.
//
// Scope is deliberate: JPEG (full EXIF + GPS, the dominant interchange format
// for photos that carry location) and PNG (dimensions, plus EXIF when a PNG
// carries an `eXIf` chunk). HEIC/HEIF — the iPhone default — is not parsed here;
// its ISOBMFF container needs a different walker and the browser cannot even
// decode it for preview, so the UI states that limitation plainly rather than
// guessing. Everything is bounds-checked: the input is an untrusted file, so a
// malformed or hostile image must yield an empty result, never a throw and never
// a fabricated coordinate.

export type ImageFormat = "jpeg" | "png" | "unknown";

/** A GPS fix recovered from EXIF. Only ever present when it is in-range. */
export interface GpsFix {
  latitude: number;
  longitude: number;
  /** Metres; negative below sea level. null when absent or unreadable. */
  altitude: number | null;
  /** Compass bearing the camera faced, 0–360, when recorded. */
  direction: number | null;
}

export interface ExifTags {
  make: string | null;
  model: string | null;
  lens: string | null;
  software: string | null;
  /** "YYYY-MM-DD HH:MM:SS" when parseable, else the raw string, else null. */
  dateTimeOriginal: string | null;
  orientation: number | null;
  fNumber: number | null;
  exposureTime: string | null;
  iso: number | null;
  focalLength: number | null;
}

export interface ImageMeta {
  format: ImageFormat;
  width: number | null;
  height: number | null;
  /** True only when a TIFF/EXIF block was actually located and read. */
  hasExif: boolean;
  gps: GpsFix | null;
  tags: ExifTags;
}

const EMPTY_TAGS: ExifTags = {
  make: null, model: null, lens: null, software: null,
  dateTimeOriginal: null, orientation: null,
  fNumber: null, exposureTime: null, iso: null, focalLength: null,
};

/** Bytes per component for each TIFF field type (index = type id). */
const TYPE_SIZE: Record<number, number> = {
  1: 1,  // BYTE
  2: 1,  // ASCII
  3: 2,  // SHORT
  4: 4,  // LONG
  5: 8,  // RATIONAL (2 × LONG)
  7: 1,  // UNDEFINED
  9: 4,  // SLONG
  10: 8, // SRATIONAL (2 × SLONG)
};

export function sniffFormat(b: Uint8Array): ImageFormat {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
    && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "png";
  return "unknown";
}

/** JPEG dimensions from the first Start-Of-Frame marker. */
function jpegDimensions(b: Uint8Array): { width: number; height: number } | null {
  let p = 2; // skip SOI (FFD8)
  while (p + 9 < b.length) {
    if (b[p] !== 0xff) { p++; continue; }
    const marker = b[p + 1];
    // SOF0..SOF15 carry frame geometry, except the non-frame markers C4/C8/CC.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (b[p + 5] << 8) | b[p + 6];
      const width = (b[p + 7] << 8) | b[p + 8];
      return { width, height };
    }
    // Standalone markers (RSTn, SOI, EOI, TEM) have no length field.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { p += 2; continue; }
    const len = (b[p + 2] << 8) | b[p + 3];
    if (len < 2) return null;
    p += 2 + len;
  }
  return null;
}

/** Locate the "Exif\0\0"-prefixed TIFF block in a JPEG's APP1 segment. */
function jpegExifOffset(b: Uint8Array): number | null {
  let p = 2;
  while (p + 4 < b.length) {
    if (b[p] !== 0xff) { p++; continue; }
    const marker = b[p + 1];
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { p += 2; continue; }
    const len = (b[p + 2] << 8) | b[p + 3];
    if (len < 2) return null;
    if (marker === 0xe1 && p + 10 < b.length
      && b[p + 4] === 0x45 && b[p + 5] === 0x78 && b[p + 6] === 0x69 && b[p + 7] === 0x66
      && b[p + 8] === 0x00 && b[p + 9] === 0x00) {
      return p + 10; // first byte of the TIFF header
    }
    p += 2 + len;
  }
  return null;
}

/** PNG geometry (IHDR) and, when present, the EXIF (`eXIf`) chunk offset. */
function pngScan(b: Uint8Array): { width: number | null; height: number | null; exifOffset: number | null } {
  let width: number | null = null;
  let height: number | null = null;
  let exifOffset: number | null = null;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 8; // skip signature
  while (p + 8 <= b.length) {
    const len = view.getUint32(p);
    const type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
    const dataStart = p + 8;
    if (type === "IHDR" && dataStart + 8 <= b.length) {
      width = view.getUint32(dataStart);
      height = view.getUint32(dataStart + 4);
    } else if (type === "eXIf") {
      exifOffset = dataStart;
    }
    if (type === "IEND") break;
    p = dataStart + len + 4; // data + CRC
  }
  return { width, height, exifOffset };
}

interface IfdEntry { tag: number; type: number; count: number; valuePtr: number; }

/** A bounded reader over the TIFF block, honouring its declared endianness. */
class Tiff {
  private readonly view: DataView;
  private readonly le: boolean;
  readonly base: number; // offset of the TIFF header within `bytes`

  private constructor(view: DataView, le: boolean, base: number) {
    this.view = view; this.le = le; this.base = base;
  }

  /** Returns null unless the block starts with a valid TIFF header. */
  static at(b: Uint8Array, base: number): Tiff | null {
    if (base + 8 > b.length) return null;
    const b0 = b[base], b1 = b[base + 1];
    const le = b0 === 0x49 && b1 === 0x49; // "II"
    const be = b0 === 0x4d && b1 === 0x4d; // "MM"
    if (!le && !be) return null;
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const magic = le ? view.getUint16(base + 2, true) : view.getUint16(base + 2, false);
    if (magic !== 42) return null;
    return new Tiff(view, le, base);
  }

  u16(abs: number): number { return this.view.getUint16(abs, this.le); }
  u32(abs: number): number { return this.view.getUint32(abs, this.le); }
  s32(abs: number): number { return this.view.getInt32(abs, this.le); }

  /** Offset of IFD0, relative to the TIFF base. */
  ifd0Offset(): number { return this.u32(this.base + 4); }

  /** Walk one IFD, returning its entries (bounds-checked). */
  entries(ifdRel: number): IfdEntry[] {
    const abs = this.base + ifdRel;
    if (abs + 2 > this.view.byteLength) return [];
    const count = this.u16(abs);
    const out: IfdEntry[] = [];
    for (let i = 0; i < count; i++) {
      const e = abs + 2 + i * 12;
      if (e + 12 > this.view.byteLength) break;
      out.push({ tag: this.u16(e), type: this.u16(e + 2), count: this.u32(e + 4), valuePtr: e + 8 });
    }
    return out;
  }

  /** ASCII value of an entry, NUL-trimmed; null when out of range. */
  ascii(e: IfdEntry): string | null {
    const size = (TYPE_SIZE[e.type] ?? 0) * e.count;
    if (size === 0) return null;
    const start = size <= 4 ? e.valuePtr : this.base + this.u32(e.valuePtr);
    if (start + e.count > this.view.byteLength) return null;
    let s = "";
    for (let i = 0; i < e.count; i++) {
      const c = this.view.getUint8(start + i);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    const trimmed = s.trim();
    return trimmed.length ? trimmed : null;
  }

  /** First SHORT/LONG value of an entry; null when unreadable. */
  int(e: IfdEntry): number | null {
    if (e.type === 3) return this.u16(e.valuePtr);
    if (e.type === 4) return this.u32(e.valuePtr);
    return null;
  }

  /** RATIONAL/SRATIONAL at component `i`; null on divide-by-zero or overflow. */
  rational(e: IfdEntry, i: number): number | null {
    // A rational is 8 bytes, so it never fits the 4-byte inline slot — the value
    // is always at the pointed-to offset.
    const at = this.base + this.u32(e.valuePtr) + i * 8;
    if (at + 8 > this.view.byteLength) return null;
    const num = e.type === 10 ? this.s32(at) : this.u32(at);
    const den = e.type === 10 ? this.s32(at + 4) : this.u32(at + 4);
    if (den === 0) return null;
    return num / den;
  }

  /** Pointer value (Exif/GPS sub-IFD offset) — always a LONG. */
  pointer(e: IfdEntry): number { return this.u32(e.valuePtr); }
}

function normalizeDateTime(raw: string | null): string | null {
  if (!raw) return null;
  // EXIF encodes "YYYY:MM:DD HH:MM:SS"; swap only the date separators.
  const m = /^(\d{4}):(\d{2}):(\d{2})( .+)?$/.exec(raw);
  if (!m) return raw;
  return `${m[1]}-${m[2]}-${m[3]}${m[4] ?? ""}`;
}

function readGps(tiff: Tiff, gpsRel: number): GpsFix | null {
  const entries = tiff.entries(gpsRel);
  let latRef: string | null = null, lonRef: string | null = null, altRef = 0;
  let lat: number | null = null, lon: number | null = null, alt: number | null = null, dir: number | null = null;
  for (const e of entries) {
    switch (e.tag) {
      case 0x01: latRef = tiff.ascii(e); break;             // N / S
      case 0x02: lat = dms(tiff, e); break;
      case 0x03: lonRef = tiff.ascii(e); break;             // E / W
      case 0x04: lon = dms(tiff, e); break;
      case 0x05: altRef = tiff.int(e) ?? 0; break;          // 1 = below sea level
      case 0x06: alt = tiff.rational(e, 0); break;
      case 0x11: dir = tiff.rational(e, 0); break;          // image direction
      default: break;
    }
  }
  if (lat === null || lon === null) return null;
  const latitude = latRef === "S" ? -lat : lat;
  const longitude = lonRef === "W" ? -lon : lon;
  // A parser that trusts an out-of-range coordinate manufactures a false fix.
  // (lat/lon are already finite here — each is a sum of finite rationals.)
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  const altitude = alt === null ? null : (altRef === 1 ? -alt : alt);
  const direction = dir !== null && Number.isFinite(dir) && dir >= 0 && dir <= 360 ? dir : null;
  return { latitude, longitude, altitude, direction };
}

/** Degrees/minutes/seconds triple → signed-magnitude decimal degrees. */
function dms(tiff: Tiff, e: IfdEntry): number | null {
  const d = tiff.rational(e, 0);
  const m = tiff.rational(e, 1);
  const s = tiff.rational(e, 2);
  if (d === null || m === null || s === null) return null;
  return d + m / 60 + s / 3600;
}

function readExifBlock(b: Uint8Array, base: number): { tags: ExifTags; gps: GpsFix | null } | null {
  const tiff = Tiff.at(b, base);
  if (!tiff) return null;
  const tags: ExifTags = { ...EMPTY_TAGS };
  let exifPtr: number | null = null;
  let gpsPtr: number | null = null;

  for (const e of tiff.entries(tiff.ifd0Offset())) {
    switch (e.tag) {
      case 0x010f: tags.make = tiff.ascii(e); break;
      case 0x0110: tags.model = tiff.ascii(e); break;
      case 0x0131: tags.software = tiff.ascii(e); break;
      case 0x0132: tags.dateTimeOriginal = normalizeDateTime(tiff.ascii(e)); break;
      case 0x0112: tags.orientation = tiff.int(e); break;
      case 0x8769: exifPtr = tiff.pointer(e); break;
      case 0x8825: gpsPtr = tiff.pointer(e); break;
      default: break;
    }
  }

  if (exifPtr !== null) {
    for (const e of tiff.entries(exifPtr)) {
      switch (e.tag) {
        case 0x9003: tags.dateTimeOriginal = normalizeDateTime(tiff.ascii(e)) ?? tags.dateTimeOriginal; break;
        case 0xa434: tags.lens = tiff.ascii(e); break;
        case 0x829d: tags.fNumber = tiff.rational(e, 0); break;
        case 0x829a: tags.exposureTime = formatExposure(tiff.rational(e, 0)); break;
        case 0x8827: tags.iso = tiff.int(e); break;
        case 0x920a: tags.focalLength = tiff.rational(e, 0); break;
        default: break;
      }
    }
  }

  const gps = gpsPtr !== null ? readGps(tiff, gpsPtr) : null;
  return { tags, gps };
}

/**
 * A shutter speed reads as "1/250s" below a second, else "2s". Its only caller
 * passes `rational()` output, which is null or a finite division, so a NaN/±∞
 * guard would be dead code.
 */
function formatExposure(seconds: number | null): string | null {
  if (seconds === null || seconds <= 0) return null;
  if (seconds >= 1) return `${Number(seconds.toFixed(1))}s`;
  return `1/${Math.round(1 / seconds)}s`;
}

/**
 * Parse an image's bytes into analyst-facing metadata. Never throws: any
 * structural surprise collapses to `hasExif: false` with whatever geometry was
 * legible, so the UI degrades honestly instead of erroring on a hostile file.
 */
export function parseExif(bytes: Uint8Array): ImageMeta {
  const format = sniffFormat(bytes);
  const meta: ImageMeta = { format, width: null, height: null, hasExif: false, gps: null, tags: { ...EMPTY_TAGS } };

  if (format === "jpeg") {
    const dim = jpegDimensions(bytes);
    if (dim) { meta.width = dim.width; meta.height = dim.height; }
    const off = jpegExifOffset(bytes);
    if (off !== null) {
      const block = readExifBlock(bytes, off);
      if (block) { meta.hasExif = true; meta.tags = block.tags; meta.gps = block.gps; }
    }
  } else if (format === "png") {
    const scan = pngScan(bytes);
    meta.width = scan.width; meta.height = scan.height;
    if (scan.exifOffset !== null) {
      const block = readExifBlock(bytes, scan.exifOffset);
      if (block) { meta.hasExif = true; meta.tags = block.tags; meta.gps = block.gps; }
    }
  }

  return meta;
}

// ── Coordinate + pivot helpers (pure formatting) ─────────────────────────────

/** Decimal degrees → "40°26'46.8\"N" style, for the coordinate panel. */
export function formatDms(dec: number, axis: "lat" | "lon"): string {
  const hemi = axis === "lat" ? (dec >= 0 ? "N" : "S") : (dec >= 0 ? "E" : "W");
  const abs = Math.abs(dec);
  let deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  let min = Math.floor(minFloat);
  // Round the seconds first, then carry — otherwise 151.2 formats as 11'60.0".
  let sec = Math.round((minFloat - min) * 60 * 10) / 10;
  if (sec >= 60) { sec -= 60; min += 1; }
  if (min >= 60) { min -= 60; deg += 1; }
  return `${deg}°${min}'${sec.toFixed(1)}"${hemi}`;
}

/** "lat, lon" rounded for copy/paste into any mapping tool. */
export function decimalPair(gps: GpsFix): string {
  return `${gps.latitude.toFixed(6)}, ${gps.longitude.toFixed(6)}`;
}

export interface Pivot { label: string; url: string; note: string }

/** Map + geolocation launchers for a recovered coordinate (no key). */
export function mapLinks(gps: GpsFix): Pivot[] {
  const { latitude: la, longitude: lo } = gps;
  return [
    { label: "OpenStreetMap", url: `https://www.openstreetmap.org/?mlat=${la}&mlon=${lo}#map=17/${la}/${lo}`, note: "Street map at the coordinate" },
    { label: "Google Maps", url: `https://www.google.com/maps?q=${la},${lo}`, note: "Satellite + Street View" },
    { label: "Google Earth", url: `https://earth.google.com/web/@${la},${lo},0a,1000d`, note: "3D terrain fly-in" },
    { label: "Bing Maps (Bird's Eye)", url: `https://www.bing.com/maps?cp=${la}~${lo}&lvl=18&style=b`, note: "Oblique aerial angles" },
  ];
}

/**
 * Reverse-image / face-search launchers. These engines take an uploaded file,
 * not a URL query, so the analyst drops the same local image into whichever
 * opens — the note says so rather than implying a one-click search.
 */
export function reverseImageLinks(): Pivot[] {
  return [
    { label: "Google Lens", url: "https://lens.google.com/", note: "Drop the image to match objects, text, places" },
    { label: "Yandex Images", url: "https://yandex.com/images/", note: "Strongest for faces and places" },
    { label: "TinEye", url: "https://tineye.com/", note: "Finds exact copies and where they appeared first" },
    { label: "Bing Visual Search", url: "https://www.bing.com/visualsearch", note: "Broad web coverage" },
    { label: "PimEyes", url: "https://pimeyes.com/en", note: "Face search (paid to see results)" },
  ];
}
