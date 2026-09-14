// ── Fonts, databases, captures and the remaining containers ─────────────────
//
// The formats here are the ones that fall between the big families, and each
// keeps something an analyst wants:
//
//   * a font's name table is a small dossier on its own: the foundry, the
//     designer, the licence, the vendor's URL, and the dates the outlines were
//     built. A font embedded in a document or shipped with an app says who made
//     it and under what terms.
//   * a SQLite database states its page geometry, its text encoding, the
//     application that claims it, and the names of every table in it, which is
//     usually enough to say what the database is for.
//   * a packet capture records the machine and the software that made it, the
//     interface it listened on, and the moment the first packet arrived.
//   * a Matroska or WebM file names the application that muxed it and the one
//     that wrote it, plus the title and the date it was made.
//
// Everything is read from the container's own structures, bounded at each step.

import { Reader } from "./bytes";
import { xmpFields, xmpPacket, XMP_IMAGE } from "./xmp";
import type { Extraction, MetaField } from "./types";

const push = (fields: MetaField[], label: string, value: string | null, group: string, sensitive?: boolean) => {
  if (value !== null && value !== "") fields.push({ label, value, group, sensitive });
};

// ── Fonts (sfnt: TTF, OTF, TTC, WOFF) ───────────────────────────────────────

// The name table's records, by their fixed identifiers. The ones that name
// people and terms are the point: a font's designer, foundry and licence are
// not metadata someone chose to attach, they are part of the format.
const NAME_IDS: Record<number, { label: string; sensitive?: boolean }> = {
  0: { label: "Copyright" },
  1: { label: "Family" },
  2: { label: "Style" },
  3: { label: "Unique identifier", sensitive: true },
  4: { label: "Full name" },
  5: { label: "Version" },
  6: { label: "PostScript name" },
  7: { label: "Trademark" },
  8: { label: "Foundry", sensitive: true },
  9: { label: "Designer", sensitive: true },
  10: { label: "Description" },
  11: { label: "Vendor URL", sensitive: true },
  12: { label: "Designer URL", sensitive: true },
  13: { label: "Licence" },
  14: { label: "Licence URL" },
};

// What the OS/2 table's fsType permits. These are the embedding terms a font
// carries, and they decide whether a document may legally ship it.
const FS_TYPE: Record<number, string> = {
  0: "installable (no embedding restriction)",
  2: "restricted (embedding not permitted)",
  4: "preview and print only",
  8: "editable embedding",
};

const MAC_EPOCH_OFFSET = 2082844800; // 1904-01-01 to 1970-01-01, in seconds
const MAX_UNIX = 32503680000;

/** A font's LONGDATETIME (seconds since 1904) as a date, or null. */
function fontDate(seconds: number | null): string | null {
  if (seconds === null || seconds <= MAC_EPOCH_OFFSET) return null;
  const unix = seconds - MAC_EPOCH_OFFSET;
  if (unix > MAX_UNIX) return null;
  return new Date(unix * 1000).toISOString().replace("T", " ").slice(0, 19);
}

interface SfntTable { tag: string; offset: number; length: number }

/** The table directory of an sfnt font at `base`. */
function sfntTables(r: Reader, base: number): SfntTable[] {
  const count = r.u16(base + 4);
  if (count === null) return [];
  const out: SfntTable[] = [];
  for (let i = 0; i < Math.min(count, 512); i++) {
    const at = base + 12 + i * 16;
    const tag = r.ascii(at, 4);
    const offset = r.u32(at + 8);
    const length = r.u32(at + 12);
    if (tag === null || offset === null || length === null) break;
    out.push({ tag, offset, length });
  }
  return out;
}

/** Read the name table's records, preferring the Windows (UTF-16) strings. */
function readNameTable(r: Reader, base: number, fields: MetaField[]): void {
  const count = r.u16(base + 2);
  const storage = r.u16(base + 4);
  if (count === null || storage === null) return;
  const seen = new Set<number>();
  for (let i = 0; i < Math.min(count, 512); i++) {
    const at = base + 6 + i * 12;
    const platform = r.u16(at);
    const nameId = r.u16(at + 6);
    const length = r.u16(at + 8);
    const offset = r.u16(at + 10);
    if (platform === null || nameId === null || length === null || offset === null) break;
    const spec = NAME_IDS[nameId];
    if (!spec || seen.has(nameId)) continue;
    const raw = r.slice(base + storage + offset, length);
    if (!raw) continue;
    // Platform 3 is Windows, whose strings are UTF-16BE; platform 1 is the old
    // Macintosh encoding, which for the Latin range is Latin-1.
    const text = new TextDecoder(platform === 3 ? "utf-16be" : "latin1").decode(raw).replace(/\0/g, "").trim();
    if (!text) continue;
    seen.add(nameId);
    push(fields, spec.label, text, "Font", spec.sensitive);
  }
}

function extractSfnt(r: Reader, base: number): Extraction {
  const fields: MetaField[] = [];
  const tables = sfntTables(r, base);
  const find = (tag: string) => tables.find((t) => t.tag === tag) ?? null;

  const name = find("name");
  if (name) readNameTable(r, name.offset, fields);

  const head = find("head");
  if (head) {
    const units = r.u16(head.offset + 18);
    push(fields, "Units per em", units === null ? null : String(units), "Font");
    push(fields, "Outlines created", fontDate(r.u64(head.offset + 20)), "Font", true);
    push(fields, "Outlines modified", fontDate(r.u64(head.offset + 28)), "Font");
  }

  const os2 = find("OS/2");
  if (os2) {
    const fsType = r.u16(os2.offset + 8);
    // Only the low four bits carry the permission; the rest are separate flags.
    if (fsType !== null) push(fields, "Embedding", FS_TYPE[fsType & 0x0f] ?? `permission bits 0x${(fsType & 0x0f).toString(16)}`, "Font");
    push(fields, "Vendor id", r.ascii(os2.offset + 58, 4), "Font", true);
  }

  // The reader trims a fixed-width ASCII field, so the CFF tag's trailing
  // space is already gone by the time it is compared.
  const outlines = find("CFF") ? "PostScript (CFF)" : find("glyf") ? "TrueType (glyf)" : null;
  push(fields, "Outline format", outlines, "Font");
  if (tables.length) push(fields, "Tables", `${tables.length} (${tables.map((t) => t.tag).slice(0, 12).join(", ")})`, "Font");
  return { fields };
}

function extractFont(kind: string, r: Reader): Extraction {
  // A TrueType collection is several fonts in one file; its first offset points
  // at the first font's own table directory.
  if (kind === "ttc") {
    const count = r.u32(8);
    const first = r.u32(12);
    const out = first === null ? { fields: [] as MetaField[] } : extractSfnt(r, first);
    if (count !== null) out.fields.unshift({ label: "Fonts in collection", value: String(count), group: "Font" });
    return out;
  }
  if (kind === "woff") {
    const fields: MetaField[] = [];
    const count = r.u16(12);
    push(fields, "Tables", count === null ? null : String(count), "Font");
    const metaLength = r.u32(28);
    if (metaLength !== null && metaLength > 0) {
      push(fields, "Extended metadata", `${metaLength.toLocaleString("en-US")} bytes (compressed XML)`, "Font");
    }
    // A WOFF's tables are individually compressed, so the name table is not
    // readable without inflating each one; the wrapper's own facts are.
    return { fields, notes: ["A WOFF wraps each font table in its own compressed stream, so the name records inside are not readable without expanding them."] };
  }
  if (kind === "woff2") {
    const fields: MetaField[] = [];
    const count = r.u16(12);
    push(fields, "Tables", count === null ? null : String(count), "Font");
    return { fields, notes: ["A WOFF2 stores all its tables in one Brotli stream, so the name records inside are not readable without expanding it."] };
  }
  return extractSfnt(r, 0);
}

// ── SQLite ───────────────────────────────────────────────────────────────────

const SQLITE_ENCODING: Record<number, string> = { 1: "UTF-8", 2: "UTF-16 little-endian", 3: "UTF-16 big-endian" };

/** SQLite's packed version number, e.g. 3045001, as "3.45.1". */
function sqliteVersion(n: number): string {
  return `${Math.floor(n / 1000000)}.${Math.floor((n / 1000) % 1000)}.${n % 1000}`;
}

function extractSqlite(r: Reader): Extraction {
  const fields: MetaField[] = [];
  const rawPageSize = r.u16(16);
  if (rawPageSize === null) return { fields };
  // A stored value of 1 means 65536, which does not fit the 16-bit field.
  push(fields, "Page size", `${rawPageSize === 1 ? 65536 : rawPageSize} bytes`, "Database");

  const pages = r.u32(28);
  if (pages !== null && pages > 0) push(fields, "Pages", pages.toLocaleString("en-US"), "Database");
  const encoding = r.u32(56);
  push(fields, "Text encoding", encoding === null ? null : SQLITE_ENCODING[encoding] ?? null, "Database");
  const changes = r.u32(24);
  if (changes !== null && changes > 0) push(fields, "Change counter", changes.toLocaleString("en-US"), "Database", true);
  const userVersion = r.u32(60);
  if (userVersion !== null && userVersion > 0) push(fields, "User version", String(userVersion), "Database");
  const appId = r.u32(68);
  if (appId !== null && appId > 0) push(fields, "Application id", `0x${appId.toString(16)}`, "Database", true);
  const writeVersion = r.u32(96);
  if (writeVersion !== null && writeVersion > 0) push(fields, "Written by SQLite", sqliteVersion(writeVersion), "Database");

  // The schema is stored as the original CREATE statements, so the table names
  // are literally in the file. They say what the database is for.
  const text = new TextDecoder("latin1").decode(r.bytes.subarray(0, Math.min(r.length, 1 << 20)));
  const tables = [...new Set([...text.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["'`[]?([A-Za-z_][\w$]{0,63})/gi)].map((m) => m[1]))];
  if (tables.length) push(fields, "Tables", tables.slice(0, 24).join(", "), "Database", true);
  return { fields };
}

// ── Packet captures ──────────────────────────────────────────────────────────

const LINK_TYPE: Record<number, string> = {
  0: "loopback", 1: "Ethernet", 6: "Token Ring", 105: "802.11 wireless", 113: "Linux cooked capture",
  127: "802.11 with radiotap", 228: "raw IPv4", 229: "raw IPv6", 276: "Linux cooked capture v2",
};

function extractPcap(r: Reader): Extraction {
  const fields: MetaField[] = [];
  // The magic decides both the byte order and whether timestamps are in
  // microseconds or nanoseconds.
  const le = r.eq(0, [0xd4, 0xc3, 0xb2, 0xa1]);
  const major = r.u16(4, le);
  const minor = r.u16(6, le);
  if (major === null || minor === null) return { fields };
  push(fields, "Format", `pcap ${major}.${minor}`, "Capture");
  const snaplen = r.u32(16, le);
  if (snaplen !== null) push(fields, "Snapshot length", `${snaplen.toLocaleString("en-US")} bytes per packet`, "Capture");
  const link = r.u32(20, le);
  push(fields, "Link type", link === null ? null : LINK_TYPE[link] ?? `link type ${link}`, "Capture");

  const first = r.u32(24, le);
  if (first !== null && first > 0 && first < MAX_UNIX) {
    push(fields, "First packet", new Date(first * 1000).toISOString().replace("T", " ").slice(0, 19), "Capture", true);
  }
  return { fields };
}

// The pcapng options that name the machine and the software behind a capture.
const SHB_OPTIONS: Record<number, { label: string; sensitive?: boolean }> = {
  2: { label: "Capture machine", sensitive: true },
  3: { label: "Capture OS", sensitive: true },
  4: { label: "Capture software", sensitive: true },
};

const IDB_OPTIONS: Record<number, { label: string; sensitive?: boolean }> = {
  2: { label: "Interface", sensitive: true },
  3: { label: "Interface description", sensitive: true },
  12: { label: "Interface OS", sensitive: true },
};

/** Read a pcapng option list, which runs until an end-of-options marker. */
function readOptions(r: Reader, start: number, end: number, le: boolean, specs: Record<number, { label: string; sensitive?: boolean }>, fields: MetaField[]): void {
  let p = start;
  while (p + 4 <= end) {
    const code = r.u16(p, le);
    const length = r.u16(p + 2, le);
    if (code === null || length === null || code === 0) break; // opt_endofopt
    const spec = specs[code];
    if (spec) push(fields, spec.label, r.utf8(p + 4, length), "Capture", spec.sensitive);
    p += 4 + length + ((4 - (length % 4)) % 4); // options are padded to 4 bytes
  }
}

function extractPcapng(r: Reader): Extraction {
  const fields: MetaField[] = [];
  // Byte-order magic inside the section header block decides the endianness.
  const le = r.eq(8, [0x4d, 0x3c, 0x2b, 0x1a]);
  const blockLength = r.u32(4, le);
  if (blockLength === null) return { fields };
  const major = r.u16(12, le);
  const minor = r.u16(14, le);
  if (major !== null && minor !== null) push(fields, "Format", `pcapng ${major}.${minor}`, "Capture");
  readOptions(r, 24, Math.min(blockLength, r.length), le, SHB_OPTIONS, fields);

  // The first interface description block follows the section header, and it
  // names the interface the capture actually listened on.
  const idb = blockLength;
  if (r.u32(idb, le) === 1) {
    const idbLength = r.u32(idb + 4, le) ?? 0;
    const link = r.u16(idb + 8, le);
    push(fields, "Link type", link === null ? null : LINK_TYPE[link] ?? `link type ${link}`, "Capture");
    readOptions(r, idb + 16, Math.min(idb + idbLength, r.length), le, IDB_OPTIONS, fields);
  }
  return { fields };
}

// ── Matroska / WebM ──────────────────────────────────────────────────────────

// EBML element ids, written as the integers their leading-length bytes encode.
const EBML_SEGMENT = 0x18538067;
const EBML_INFO = 0x1549a966;
const EBML_MASTERS = new Set([EBML_SEGMENT, EBML_INFO]);

const EBML_FIELDS: Record<number, { label: string; kind: "text" | "date" | "float"; sensitive?: boolean }> = {
  0x4d80: { label: "Muxed with", kind: "text", sensitive: true },
  0x5741: { label: "Written with", kind: "text", sensitive: true },
  0x7ba9: { label: "Title", kind: "text" },
  0x4461: { label: "Created", kind: "date", sensitive: true },
  0x4489: { label: "Duration", kind: "float" },
};

/** Read an EBML variable-length integer at `p`: id form keeps its marker bit. */
function readVint(r: Reader, p: number, keepMarker: boolean): { value: number; next: number } | null {
  const first = r.u8(p);
  if (first === null || first === 0) return null;
  // The width is the position of the highest set bit, and a non-zero byte
  // always has one, so the loop always settles between 1 and 8.
  let width = 1;
  while ((first & (0x80 >> (width - 1))) === 0) width++;
  let value = keepMarker ? first : first & (0xff >> width);
  for (let i = 1; i < width; i++) {
    const b = r.u8(p + i);
    if (b === null) return null;
    value = value * 256 + b;
  }
  return { value, next: p + width };
}

/** The Matroska epoch is 2001-01-01, and DateUTC counts nanoseconds from it. */
function matroskaDate(nanos: number): string {
  return new Date(Date.UTC(2001, 0, 1) + nanos / 1e6).toISOString().replace("T", " ").slice(0, 19);
}

/** An IEEE double or float, as Matroska stores a duration. */
function readFloat(r: Reader, off: number, length: number): number | null {
  const bytes = r.slice(off, length);
  if (!bytes || (length !== 4 && length !== 8)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return length === 4 ? view.getFloat32(0) : view.getFloat64(0);
}

/** Walk the element tree, descending only into the two master elements needed. */
function walkEbml(r: Reader, start: number, end: number, fields: MetaField[], depth = 0): void {
  let p = start;
  while (p < end && depth < 4) {
    const id = readVint(r, p, true);
    if (!id) return;
    const size = readVint(r, id.next, false);
    if (!size) return;
    const body = size.next;
    const bodyEnd = Math.min(body + size.value, end);
    if (EBML_MASTERS.has(id.value)) {
      walkEbml(r, body, bodyEnd, fields, depth + 1);
    } else {
      const spec = EBML_FIELDS[id.value];
      if (spec?.kind === "text") push(fields, spec.label, r.utf8(body, size.value), "Media", spec.sensitive);
      else if (spec?.kind === "date") {
        const nanos = r.u64(body);
        if (nanos !== null) push(fields, spec.label, matroskaDate(nanos), "Media", spec.sensitive);
      } else if (spec?.kind === "float") {
        const value = readFloat(r, body, size.value);
        if (value !== null) push(fields, spec.label, `${Math.round(value / 1000)} s`, "Media");
      }
    }
    p = bodyEnd;
  }
}

function extractEbml(r: Reader): Extraction {
  const fields: MetaField[] = [];
  walkEbml(r, 0, r.length, fields);
  return { fields };
}

// ── ICO and PSD ──────────────────────────────────────────────────────────────

function extractIco(r: Reader): Extraction {
  const fields: MetaField[] = [];
  const count = r.u16(4, true);
  if (count === null || count === 0) return { fields };
  push(fields, "Images", String(count), "Image");
  const sizes: string[] = [];
  for (let i = 0; i < Math.min(count, 32); i++) {
    const at = 6 + i * 16;
    const w = r.u8(at);
    const h = r.u8(at + 1);
    const bits = r.u16(at + 6, true);
    if (w === null || h === null) break;
    // A stored dimension of 0 means 256, which does not fit one byte.
    sizes.push(`${w === 0 ? 256 : w}×${h === 0 ? 256 : h}${bits ? ` at ${bits}-bit` : ""}`);
  }
  if (sizes.length) push(fields, "Sizes", sizes.join(", "), "Image");
  return { fields };
}

const PSD_MODE: Record<number, string> = {
  0: "bitmap", 1: "greyscale", 2: "indexed", 3: "RGB", 4: "CMYK", 7: "multichannel", 8: "duotone", 9: "Lab",
};

function extractPsd(r: Reader): Extraction {
  const fields: MetaField[] = [];
  const height = r.u32(14);
  const width = r.u32(18);
  if (width === null || height === null) return { fields };
  push(fields, "Canvas", `${width} × ${height} px`, "Image");
  // The channel count sits before the canvas size, so reaching this line means
  // its two bytes are present.
  push(fields, "Channels", String((r.bytes[12] << 8) | r.bytes[13]), "Image");
  const depth = r.u16(22);
  const mode = r.u16(24);
  if (depth !== null) push(fields, "Bit depth", `${depth} bits per channel`, "Image");
  push(fields, "Colour mode", mode === null ? null : PSD_MODE[mode] ?? `mode ${mode}`, "Image");

  // Photoshop writes an XMP packet into the image-resources block.
  const packet = xmpPacket(new TextDecoder("latin1").decode(r.bytes.subarray(0, Math.min(r.length, 1 << 20))));
  if (packet) fields.push(...xmpFields(packet, XMP_IMAGE));
  return { fields };
}

const FONT_KINDS = new Set(["ttf", "otf", "ttc", "woff", "woff2"]);

/** Metadata for the remaining container formats. */
export function extractContainer(kind: string, bytes: Uint8Array): Extraction {
  const r = new Reader(bytes);
  if (FONT_KINDS.has(kind)) return extractFont(kind, r);
  if (kind === "sqlite") return extractSqlite(r);
  if (kind === "pcap") return extractPcap(r);
  if (kind === "pcapng") return extractPcapng(r);
  if (kind === "mkv" || kind === "webm") return extractEbml(r);
  if (kind === "ico" || kind === "cur") return extractIco(r);
  if (kind === "psd") return extractPsd(r);
  return { fields: [] };
}

/** The kinds this module can describe, for the orchestrator's dispatch table. */
export const CONTAINER_KINDS = new Set([...FONT_KINDS, "sqlite", "pcap", "pcapng", "mkv", "webm", "ico", "cur", "psd"]);
