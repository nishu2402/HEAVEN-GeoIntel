// ── Audio tag metadata (MP3 / FLAC / WAV) ───────────────────────────────────
//
// Audio files carry attribution too: the artist and title, but more usefully for
// an analyst the encoder software and the "encoded by" tag, which often name a
// person or a tool. This reads ID3v2 (with an ID3v1 fallback) from MP3, Vorbis
// comments and stream info from FLAC, and the RIFF INFO list from WAV, all by
// walking the byte structure directly. Text is decoded only in its declared
// encoding, never guessed, and a malformed tag block simply yields nothing.
//
// Beyond the tags, the stream itself is described: an MP3's first frame header
// states the MPEG version, layer, bitrate, sample rate and channel mode, and a
// Xing header turns that into a real duration rather than a guess from the file
// size. A WAV may carry a Broadcast Wave block, which is what professional
// recorders write, and it names the machine that made the recording, its own
// reference string and the exact date and time the take started.

import { Reader, asciiBytes } from "./bytes";
import type { Extraction, MetaField } from "./types";

const pad = (n: number) => String(n).padStart(2, "0");

/** Minutes and seconds for a sample count. The caller has already established
 *  that `rate` is a real, positive sample rate. */
function duration(totalSamples: number, rate: number): string | null {
  if (totalSamples <= 0) return null;
  const s = Math.round(totalSamples / rate);
  const m = Math.floor(s / 60);
  return `${m}m ${pad(s % 60)}s`;
}

// ── MP3 / ID3 ────────────────────────────────────────────────────────────────
const ID3V2_FRAMES: Record<string, { label: string; sensitive?: boolean }> = {
  TIT2: { label: "Title" },
  TPE1: { label: "Artist", sensitive: true },
  TPE2: { label: "Album artist", sensitive: true },
  TCOM: { label: "Composer", sensitive: true },
  TOPE: { label: "Original artist", sensitive: true },
  TOWN: { label: "File owner", sensitive: true },
  TALB: { label: "Album" },
  TRCK: { label: "Track" },
  TPOS: { label: "Disc" },
  TYER: { label: "Year" },
  TDRC: { label: "Year" },
  TDRL: { label: "Released" },
  TDTG: { label: "Tagged", sensitive: true },
  TCON: { label: "Genre" },
  TPUB: { label: "Publisher" },
  TCOP: { label: "Copyright" },
  TLAN: { label: "Language" },
  TSRC: { label: "ISRC" },
  TMED: { label: "Media type" },
  TBPM: { label: "Tempo (BPM)" },
  TKEY: { label: "Musical key" },
  TSSE: { label: "Encoder" },
  TENC: { label: "Encoded by", sensitive: true },
  WOAR: { label: "Artist page" },
  WCOP: { label: "Licence page" },
  WOAF: { label: "File page" },
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
    const body = r.slice(p + 10, frameSize);
    if (body && spec) {
      const v = decodeId3Text(body);
      if (v) push(fields, spec.label, v, spec.sensitive);
    } else if (body && (id === "COMM" || id === "TXXX" || id === "WXXX")) {
      // These three are a description and a value, separated by a NUL inside
      // one frame, so the pair is split rather than printed as one run-on line.
      const pair = describedFrame(id, body);
      if (pair) push(fields, pair.label, pair.value, true);
    } else if (body && id === "PRIV") {
      // The owner identifier names the application that wrote the frame. Only a
      // printable identifier is reported: the rest of a PRIV frame is binary,
      // and a frame with no readable owner has nothing to say.
      const owner = new TextDecoder("latin1").decode(body).split("\u0000")[0].trim();
      if (/^[\x20-\x7e]+$/.test(owner)) push(fields, "Private frame owner", owner, true);
    } else if (body && (id === "APIC" || id === "GEOB")) {
      push(fields, id === "APIC" ? "Embedded artwork" : "Embedded object", `${frameSize.toLocaleString("en-US")} bytes`);
    }
    p += 10 + frameSize;
  }
}

/**
 * COMM, TXXX and WXXX hold a description and a value in one frame. COMM also
 * carries a three-letter language code before the description. The description
 * is what makes the value legible ("iTunNORM" is not a comment a person wrote),
 * so it becomes the field's own label.
 */
function describedFrame(id: string, body: Uint8Array): { label: string; value: string } | null {
  const enc = body[0];
  const rest = body.subarray(id === "COMM" ? 4 : 1);
  const wide = enc === 1 || enc === 2;
  const encoding = wide ? "utf-16" : enc === 3 ? "utf-8" : "latin1";
  const text = new TextDecoder(encoding).decode(rest);
  const nul = text.indexOf("\u0000");
  if (nul < 0) return null;
  const description = text.slice(0, nul).trim();
  const value = text.slice(nul + 1).replace(/\u0000+$/, "").trim();
  if (!value) return null;
  const base = id === "WXXX" ? "URL" : id === "TXXX" ? "Custom" : "Comment";
  return { label: description ? `${base}: ${description}` : base, value };
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

// ── MP3 stream header ────────────────────────────────────────────────────────
//
// Bitrate tables are indexed by the header's 4-bit bitrate field. Index 0 is
// "free" and 15 is invalid, so both are left absent rather than reported.
const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000], // MPEG 1
  2: [22050, 24000, 16000], // MPEG 2
  0: [11025, 12000, 8000],  // MPEG 2.5
};
const VERSION_NAME: Record<number, string> = { 3: "MPEG 1", 2: "MPEG 2", 0: "MPEG 2.5" };
const CHANNEL_MODE = ["stereo", "joint stereo", "dual channel", "mono"];

/** Seconds of audio, as "4m 07s" or "1h 02m 07s". */
function span(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${pad(m)}m ${pad(s % 60)}s` : `${m}m ${pad(s % 60)}s`;
}

/**
 * Describe the MPEG audio stream from its first frame header, and give the
 * playing time. A variable-bitrate file states its own frame count in a Xing or
 * Info header inside that first frame, which is exact; a constant-bitrate file
 * has none, and the length divided by the bitrate is exact for it instead.
 */
function readMpegFrame(r: Reader, start: number, fields: MetaField[]): void {
  const b = r.bytes;
  // Find the frame sync within a bounded window past the tag, so a file with a
  // little padding is still read and a file with none is not scanned whole.
  let at = -1;
  for (let i = start; i < Math.min(r.length - 4, start + 8192); i++) {
    if (b[i] === 0xff && (b[i + 1] & 0xe0) === 0xe0) { at = i; break; }
  }
  if (at < 0) return;

  const version = (b[at + 1] >> 3) & 0x03;
  const layer = (b[at + 1] >> 1) & 0x03;
  const rates = SAMPLE_RATES[version];
  if (layer !== 1 || !rates) return; // only Layer III is described here

  const sampleRate = rates[(b[at + 2] >> 2) & 0x03];
  const table = version === 3 ? BITRATES_V1_L3 : BITRATES_V2_L3;
  const bitrate = table[(b[at + 2] >> 4) & 0x0f];
  const mode = CHANNEL_MODE[(b[at + 3] >> 6) & 0x03];

  push(fields, "Format", `${VERSION_NAME[version]} Layer III`);
  push(fields, "Sample rate", sampleRate ? `${sampleRate} Hz` : null);
  push(fields, "Channels", mode);

  // The Xing/Info header sits at a fixed offset after the frame header that
  // depends on the version and channel mode.
  const xingAt = at + 4 + (version === 3 ? (mode === "mono" ? 17 : 32) : (mode === "mono" ? 9 : 17));
  const tag = r.ascii(xingAt, 4);
  const vbr = tag === "Xing" || tag === "Info";
  const frameCount = vbr && ((r.u32(xingAt + 4) ?? 0) & 1) === 1 ? r.u32(xingAt + 8) : null;

  push(fields, "Bitrate", bitrate > 0 ? `${bitrate} kbps${vbr ? " (variable)" : ""}` : null);
  if (frameCount !== null && sampleRate) {
    // Layer III packs 1152 samples per frame at every bitrate.
    push(fields, "Duration", span((frameCount * 1152) / sampleRate));
  } else if (bitrate > 0) {
    push(fields, "Duration", span(((r.length - at) * 8) / (bitrate * 1000)));
  }
}

function extractMp3(r: Reader): Extraction {
  const fields: MetaField[] = [];
  let audioStart = 0;
  if (r.eq(0, asciiBytes("ID3"))) {
    readId3v2(r, fields);
    audioStart = 10 + (synchsafe(r, 6) ?? 0);
  }
  if (fields.filter((f) => f.label !== "Tag version").length === 0) readId3v1(r, fields);
  readMpegFrame(r, audioStart, fields);
  return { fields };
}

// ── FLAC ─────────────────────────────────────────────────────────────────────
const VORBIS_TAGS: Record<string, { label: string; sensitive?: boolean }> = {
  TITLE: { label: "Title" },
  ARTIST: { label: "Artist", sensitive: true },
  ALBUMARTIST: { label: "Album artist", sensitive: true },
  COMPOSER: { label: "Composer", sensitive: true },
  PERFORMER: { label: "Performer", sensitive: true },
  ALBUM: { label: "Album" },
  TRACKNUMBER: { label: "Track" },
  DISCNUMBER: { label: "Disc" },
  DATE: { label: "Date" },
  GENRE: { label: "Genre" },
  ORGANIZATION: { label: "Organisation", sensitive: true },
  LABEL: { label: "Label" },
  COPYRIGHT: { label: "Copyright" },
  LICENSE: { label: "Licence" },
  ISRC: { label: "ISRC" },
  COMMENT: { label: "Comment", sensitive: true },
  DESCRIPTION: { label: "Description", sensitive: true },
  CONTACT: { label: "Contact", sensitive: true },
  LOCATION: { label: "Location", sensitive: true },
  ENCODER: { label: "Encoder" },
  ENCODED_BY: { label: "Encoded by", sensitive: true },
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
    const key = text.slice(0, eq).toUpperCase();
    const spec = VORBIS_TAGS[key];
    // A key the standard does not define is still a real field a tool wrote, so
    // it is kept under its own name rather than dropped.
    if (spec) push(fields, spec.label, text.slice(eq + 1), spec.sensitive);
    else if (!/^REPLAYGAIN_/.test(key)) push(fields, key, text.slice(eq + 1));
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
      // STREAMINFO packs the sample rate (20 bits), channel count (3) and bits
      // per sample (5) into one 32-bit word at byte offset 10, whose last four
      // bits begin the 36-bit sample total.
      const packed = r.u32(body + 10, false);
      const lowSamples = r.u32(body + 14, false);
      if (packed !== null && lowSamples !== null) {
        // Channels and bit depth are stored one less than their real value, so
        // they only mean anything once the block is known to be a real one, and
        // a zeroed STREAMINFO would otherwise read as "1 channel, 1-bit".
        const sampleRate = (packed >>> 12) & 0xfffff;
        if (sampleRate > 0) {
          push(fields, "Sample rate", `${sampleRate} Hz`);
          push(fields, "Channels", String(((packed >>> 9) & 0x07) + 1));
          push(fields, "Bit depth", `${((packed >>> 4) & 0x1f) + 1}-bit`);
          push(fields, "Duration", duration(lowSamples, sampleRate));
        }
      }
    } else if (type === 4) {
      readVorbisComments(r, body, fields);
    } else if (type === 6) {
      push(fields, "Embedded artwork", `${blockSize.toLocaleString("en-US")} bytes`);
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
  ISFT: { label: "Software", sensitive: true },
  ICMT: { label: "Comment", sensitive: true },
  IGNR: { label: "Genre" },
  ICOP: { label: "Copyright" },
  IENG: { label: "Engineer", sensitive: true },
  ITCH: { label: "Technician", sensitive: true },
  ISRC: { label: "Source", sensitive: true },
  ICMS: { label: "Commissioned by", sensitive: true },
  IARL: { label: "Archival location", sensitive: true },
  ISBJ: { label: "Subject" },
  IKEY: { label: "Keywords" },
  IMED: { label: "Medium" },
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

// The WAVE format codes worth naming. Anything else is reported by number so
// the file still states what it is rather than silently omitting it.
const WAV_FORMAT: Record<number, string> = {
  1: "PCM", 2: "Microsoft ADPCM", 3: "IEEE float", 6: "A-law", 7: "µ-law",
  0x11: "IMA ADPCM", 0x31: "GSM 6.10", 0x50: "MPEG", 0x55: "MP3", 0xfffe: "extensible",
};

/**
 * The Broadcast Wave extension, which every professional field recorder and
 * every broadcast editor writes. It is the richest metadata a WAV carries: the
 * description of the take, the machine or person that originated it, that
 * originator's own reference string, and the exact date and time recording
 * started, which places the recording in time far more precisely than a file
 * timestamp does.
 */
function readBext(r: Reader, body: number, size: number, fields: MetaField[]): void {
  push(fields, "Description", r.utf8(body, 256), true);
  push(fields, "Originator", r.ascii(body + 256, 32), true);
  push(fields, "Originator reference", r.ascii(body + 288, 32), true);
  const date = r.ascii(body + 320, 10);
  const time = r.ascii(body + 330, 8);
  if (date) push(fields, "Recorded", time ? `${date} ${time}` : date, true);
  // Coding history runs from offset 602 to the end of the chunk: a free-text
  // log of every conversion the audio has been through, each line naming the
  // tool that did it. Its length comes from the chunk, never from a guess.
  const history = r.utf8(body + 602, Math.min(1024, Math.max(0, size - 602)));
  if (history) push(fields, "Coding history", history.replace(/\s+/g, " ").trim().slice(0, 500));
}

function extractWav(r: Reader): Extraction {
  const fields: MetaField[] = [];
  const b = r.bytes;
  let p = 12; // after "RIFF"<size>"WAVE"
  let byteRate = 0;
  let dataBytes = 0;
  // The loop bound guarantees the 8-byte chunk header is in range, so the 4CC
  // and size read directly. The fmt chunk id keeps its conventional trailing space.
  while (p + 8 <= r.length) {
    const id = String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
    const size = b[p + 4] + b[p + 5] * 0x100 + b[p + 6] * 0x10000 + b[p + 7] * 0x1000000;
    const body = p + 8;
    if (id === "fmt ") {
      const format = r.u16(body, true);
      const channels = r.u16(body + 2, true);
      const rate = r.u32(body + 4, true);
      const bits = r.u16(body + 14, true);
      byteRate = r.u32(body + 8, true) ?? 0;
      if (format) push(fields, "Format", WAV_FORMAT[format] ?? `format code ${format}`);
      if (rate) push(fields, "Sample rate", `${rate} Hz`);
      if (channels) push(fields, "Channels", String(channels));
      if (bits) push(fields, "Bit depth", `${bits}-bit`);
    } else if (id === "data") {
      dataBytes = size;
    } else if (id === "bext") {
      readBext(r, body, size, fields);
    } else if (id === "iXML") {
      // Film and television sound keeps the scene and take here, as XML.
      const xml = r.utf8(body, Math.min(size, 8192)) ?? "";
      for (const [tag, label] of [["PROJECT", "Project"], ["SCENE", "Scene"], ["TAKE", "Take"], ["NOTE", "Note"]] as const) {
        const m = new RegExp(`<${tag}>([^<]+)</${tag}>`, "i").exec(xml);
        if (m) push(fields, label, m[1].trim(), true);
      }
    } else if (id === "LIST" && r.ascii(body, 4) === "INFO") {
      readInfoList(r, body, body + size, fields);
    }
    p = body + size + (size & 1);
  }
  if (byteRate > 0 && dataBytes > 0) push(fields, "Duration", span(dataBytes / byteRate));
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
