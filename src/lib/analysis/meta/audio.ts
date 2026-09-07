// ── Audio tag metadata (MP3 / FLAC / WAV) ───────────────────────────────────
//
// Audio files carry attribution too: the artist and title, but more usefully for
// an analyst the encoder software and the "encoded by" tag, which often name a
// person or a tool. This reads ID3v2 (with an ID3v1 fallback) from MP3, Vorbis
// comments and stream info from FLAC, and the RIFF INFO list from WAV, all by
// walking the byte structure directly. Text is decoded only in its declared
// encoding, never guessed, and a malformed tag block simply yields nothing.

import { Reader, asciiBytes } from "./bytes";
import type { Extraction, MetaField } from "./types";

const pad = (n: number) => String(n).padStart(2, "0");
function duration(totalSamples: number, rate: number): string | null {
  if (rate <= 0 || totalSamples <= 0) return null;
  const s = Math.round(totalSamples / rate);
  const m = Math.floor(s / 60);
  return `${m}m ${pad(s % 60)}s`;
}

// ── MP3 / ID3 ────────────────────────────────────────────────────────────────
const ID3V2_FRAMES: Record<string, { label: string; sensitive?: boolean }> = {
  TIT2: { label: "Title" },
  TPE1: { label: "Artist", sensitive: true },
  TALB: { label: "Album" },
  TYER: { label: "Year" },
  TDRC: { label: "Year" },
  TCON: { label: "Genre" },
  TSSE: { label: "Encoder" },
  TENC: { label: "Encoded by", sensitive: true },
};

/** Decode an ID3v2 text-frame body by its leading encoding byte. The caller only
 *  ever passes a frame of at least one byte (the encoding indicator). */
function decodeId3Text(bytes: Uint8Array): string {
  const enc = bytes[0];
  const body = bytes.subarray(1);
  let label: string;
  if (enc === 1) label = body[0] === 0xff && body[1] === 0xfe ? "utf-16le" : "utf-16be";
  else if (enc === 2) label = "utf-16be";
  else if (enc === 3) label = "utf-8";
  else label = "latin1";
  return new TextDecoder(label).decode(body).replace(/\0+$/, "").trim();
}

/** Four synchsafe bytes (7 bits each) to an integer, as ID3 sizes are stored. */
function synchsafe(r: Reader, off: number): number | null {
  const a = r.u8(off), b = r.u8(off + 1), c = r.u8(off + 2), d = r.u8(off + 3);
  if (a === null || b === null || c === null || d === null) return null;
  return (a << 21) | (b << 14) | (c << 7) | d;
}

function readId3v2(r: Reader, fields: MetaField[]): void {
  const version = r.u8(3);
  const size = synchsafe(r, 6);
  if (version === null || size === null) return;
  fields.push({ label: "Tag version", value: `ID3v2.${version}`, group: "Media" });
  if (version !== 3 && version !== 4) return; // v2.2 and below use a different frame layout
  const end = Math.min(10 + size, r.length);
  const b = r.bytes;
  let p = 10;
  while (p + 10 <= end) {
    const id = r.ascii(p, 4);
    if (id === null) break; // padding (zero bytes) marks the end of the frames
    // p + 10 <= end <= length guarantees the four size bytes are in range. v2.4
    // stores the size synchsafe (7 bits/byte); v2.3 stores it as a plain integer.
    const frameSize = version === 4
      ? ((b[p + 4] & 0x7f) << 21) | ((b[p + 5] & 0x7f) << 14) | ((b[p + 6] & 0x7f) << 7) | (b[p + 7] & 0x7f)
      : b[p + 4] * 0x1000000 + b[p + 5] * 0x10000 + b[p + 6] * 0x100 + b[p + 7];
    if (frameSize <= 0) break;
    const spec = ID3V2_FRAMES[id];
    if (spec) {
      const body = r.slice(p + 10, frameSize);
      if (body) { const v = decodeId3Text(body); if (v) push(fields, spec.label, v, spec.sensitive); }
    }
    p += 10 + frameSize;
  }
}

function readId3v1(r: Reader, fields: MetaField[]): void {
  const base = r.length - 128;
  if (base < 0 || !r.eq(base, asciiBytes("TAG"))) return;
  const at = (off: number, len: number) => r.ascii(base + off, len);
  push(fields, "Title", at(3, 30));
  push(fields, "Artist", at(33, 30), true);
  push(fields, "Album", at(63, 30));
  push(fields, "Year", at(93, 4));
  push(fields, "Comment", at(97, 30));
}

/** Push a field only when the value is a real, non-empty string. */
function push(fields: MetaField[], label: string, value: string | null, sensitive?: boolean): void {
  if (value) fields.push({ label, value, group: "Media", sensitive });
}

function extractMp3(r: Reader): Extraction {
  const fields: MetaField[] = [];
  if (r.eq(0, asciiBytes("ID3"))) readId3v2(r, fields);
  if (fields.filter((f) => f.label !== "Tag version").length === 0) readId3v1(r, fields);
  return { fields };
}

// ── FLAC ─────────────────────────────────────────────────────────────────────
const VORBIS_TAGS: Record<string, { label: string; sensitive?: boolean }> = {
  TITLE: { label: "Title" },
  ARTIST: { label: "Artist", sensitive: true },
  ALBUM: { label: "Album" },
  DATE: { label: "Date" },
  GENRE: { label: "Genre" },
  ENCODER: { label: "Encoder" },
};

/** Parse a Vorbis comment block (vendor string + KEY=value list) at `off`. */
function readVorbisComments(r: Reader, off: number, fields: MetaField[]): void {
  const vendorLen = r.u32(off, true);
  if (vendorLen === null) return;
  const vendor = r.utf8(off + 4, vendorLen);
  if (vendor) push(fields, "Encoder", vendor);
  let p = off + 4 + vendorLen;
  const count = r.u32(p, true);
  if (count === null) return;
  p += 4;
  for (let i = 0; i < count; i++) {
    const len = r.u32(p, true);
    if (len === null) break;
    const text = r.utf8(p + 4, len);
    p += 4 + len;
    if (!text) continue;
    const eq = text.indexOf("=");
    if (eq < 0) continue;
    const spec = VORBIS_TAGS[text.slice(0, eq).toUpperCase()];
    if (spec) push(fields, spec.label, text.slice(eq + 1), spec.sensitive);
  }
}

function extractFlac(r: Reader): Extraction {
  const fields: MetaField[] = [];
  let p = 4; // after "fLaC"
  for (;;) {
    const header = r.u8(p);
    const size = r.u32(p, false);
    if (header === null || size === null) break;
    const type = header & 0x7f;
    const blockSize = size & 0xffffff;
    const body = p + 4;
    if (type === 0) {
      // STREAMINFO: sample rate is 20 bits at byte offset 10; total samples 36 bits.
      const rate = r.u32(body + 10, false);
      const lowSamples = r.u32(body + 14, false);
      if (rate !== null && lowSamples !== null) {
        const sampleRate = (rate >>> 12) & 0xfffff;
        const totalSamples = lowSamples; // low 32 of the 36-bit count; exact for < ~27h
        push(fields, "Sample rate", sampleRate > 0 ? `${sampleRate} Hz` : null);
        push(fields, "Duration", duration(totalSamples, sampleRate));
      }
    } else if (type === 4) {
      readVorbisComments(r, body, fields);
    }
    if ((header & 0x80) !== 0) break; // last-block flag
    p = body + blockSize;
  }
  return { fields };
}

// ── WAV (RIFF) ────────────────────────────────────────────────────────────────
const INFO_TAGS: Record<string, { label: string; sensitive?: boolean }> = {
  INAM: { label: "Title" },
  IART: { label: "Artist", sensitive: true },
  IPRD: { label: "Album" },
  ICRD: { label: "Date" },
  ISFT: { label: "Software" },
  ICMT: { label: "Comment" },
  IGNR: { label: "Genre" },
  ICOP: { label: "Copyright" },
};

function readInfoList(r: Reader, start: number, end: number, fields: MetaField[]): void {
  let p = start + 4; // skip the "INFO" form type
  while (p + 8 <= end) {
    const id = r.ascii(p, 4);
    const size = r.u32(p + 4, true);
    if (id === null || size === null) break;
    const spec = INFO_TAGS[id];
    if (spec) { const v = r.ascii(p + 8, size); if (v) push(fields, spec.label, v, spec.sensitive); }
    p += 8 + size + (size & 1); // chunks are padded to an even length
  }
}

function extractWav(r: Reader): Extraction {
  const fields: MetaField[] = [];
  const b = r.bytes;
  let p = 12; // after "RIFF"<size>"WAVE"
  // The loop bound guarantees the 8-byte chunk header is in range, so the 4CC
  // and size read directly. The fmt chunk id keeps its conventional trailing space.
  while (p + 8 <= r.length) {
    const id = String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
    const size = b[p + 4] + b[p + 5] * 0x100 + b[p + 6] * 0x10000 + b[p + 7] * 0x1000000;
    const body = p + 8;
    if (id === "fmt ") {
      const channels = r.u16(body + 2, true);
      const rate = r.u32(body + 4, true);
      const bits = r.u16(body + 14, true);
      if (rate) push(fields, "Sample rate", `${rate} Hz`);
      if (channels) push(fields, "Channels", String(channels));
      if (bits) push(fields, "Bit depth", `${bits}-bit`);
    } else if (id === "LIST" && r.ascii(body, 4) === "INFO") {
      readInfoList(r, body, body + size, fields);
    }
    p = body + size + (size & 1);
  }
  return { fields };
}

/** Extract tag metadata from an audio file identified as `kind`. */
export function extractAudio(kind: string, bytes: Uint8Array): Extraction {
  const r = new Reader(bytes);
  if (kind === "mp3") return extractMp3(r);
  if (kind === "flac") return extractFlac(r);
  if (kind === "wav") return extractWav(r);
  return { fields: [] };
}
