// ── ZIP container + Office / OpenDocument / EPUB properties ──────────────────
//
// Every modern office document is a ZIP: a DOCX, XLSX, PPTX, ODT or EPUB is a
// package whose property files name the author, the account that last saved it,
// the company, and exact created/modified timestamps. That is often the single
// richest attribution a document yields, so this reads the ZIP central directory
// for the archive-level facts and then inflates and parses the specific property
// members. Inflation uses the platform's own DecompressionStream (deflate-raw),
// so there is no third-party dependency. Every field surfaced is a real value
// read from a real member; a missing or corrupt member simply yields nothing.

import { Reader } from "./bytes";
import type { Extraction, MetaField } from "./types";

interface ZipEntry {
  name: string;
  method: number;
  compSize: number;
  localOffset: number;
  date: string | null;
  encrypted: boolean;
}

interface Central {
  entries: ZipEntry[];
  comment: string | null;
  hostOS: string | null;
  latest: string | null;
  encrypted: boolean;
}

const HOST_OS: Record<number, string> = {
  0: "MS-DOS / Windows (FAT)",
  3: "Unix",
  7: "macOS (HFS)",
  10: "Windows (NTFS)",
  19: "macOS (OS X)",
};

const pad = (n: number) => String(n).padStart(2, "0");

/** MS-DOS packed date/time to "YYYY-MM-DD HH:MM:SS", or null when unset/invalid. */
function dosDateTime(date: number, time: number): string | null {
  if (date === 0) return null;
  const day = date & 0x1f;
  const month = (date >> 5) & 0x0f;
  const year = 1980 + ((date >> 9) & 0x7f);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const sec = (time & 0x1f) * 2;
  const min = (time >> 5) & 0x3f;
  const hour = (time >> 11) & 0x1f;
  return `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(min)}:${pad(sec)}`;
}

/** Locate the End-Of-Central-Directory record by scanning back from the end. */
function findEocd(r: Reader): number | null {
  const min = Math.max(0, r.length - 65557); // 22-byte record + up to 64 KB comment
  for (let p = r.length - 22; p >= min; p--) {
    if (r.eq(p, [0x50, 0x4b, 0x05, 0x06])) return p;
  }
  return null;
}

/** Parse the central directory into entries plus archive-level facts. */
function parseCentral(r: Reader): Central | null {
  const eocd = findEocd(r);
  if (eocd === null) return null;
  // findEocd only returns a position with a full 22-byte record in range, so
  // these fixed fields are read directly rather than through the nullable API.
  const b = r.bytes;
  const total = b[eocd + 10] | (b[eocd + 11] << 8);
  const cdOffset = b[eocd + 16] + b[eocd + 17] * 0x100 + b[eocd + 18] * 0x10000 + b[eocd + 19] * 0x1000000;
  const commentLen = b[eocd + 20] | (b[eocd + 21] << 8);
  const comment = commentLen > 0 ? r.utf8(eocd + 22, commentLen) : null;

  const entries: ZipEntry[] = [];
  let hostOS: string | null = null;
  let latest: string | null = null;
  let anyEncrypted = false;

  let p = cdOffset;
  for (let i = 0; i < total; i++) {
    if (!r.eq(p, [0x50, 0x4b, 0x01, 0x02])) break;
    const versionMadeBy = r.u16(p + 4, true) ?? 0;
    const flags = r.u16(p + 8, true) ?? 0;
    const method = r.u16(p + 10, true) ?? 0;
    const time = r.u16(p + 12, true) ?? 0;
    const date = r.u16(p + 14, true) ?? 0;
    const compSize = r.u32(p + 20, true) ?? 0;
    const fnameLen = r.u16(p + 28, true) ?? 0;
    const extraLen = r.u16(p + 30, true) ?? 0;
    const commentLen2 = r.u16(p + 32, true) ?? 0;
    const localOffset = r.u32(p + 42, true) ?? 0;
    const name = r.utf8(p + 46, fnameLen) ?? "";
    const encrypted = (flags & 0x1) === 1;
    if (encrypted) anyEncrypted = true;
    if (hostOS === null) hostOS = HOST_OS[versionMadeBy >> 8] ?? null;
    const when = dosDateTime(date, time);
    if (when && (latest === null || when > latest)) latest = when;
    entries.push({ name, method, compSize, localOffset, date: when, encrypted });
    p += 46 + fnameLen + extraLen + commentLen2;
  }

  return { entries, comment, hostOS, latest, encrypted: anyEncrypted };
}

// A single member never legitimately inflates past this. Office/ODF/EPUB
// property files are a few kilobytes; the cap is orders of magnitude larger, so
// it never truncates a real document, but it stops a decompression bomb (DEFLATE
// reaches ~1000:1, so a small archive could otherwise expand to gigabytes and
// exhaust the tab's memory) by refusing the member the moment it overruns.
const MAX_INFLATE = 32 * 1024 * 1024;

/**
 * Inflate a raw DEFLATE stream with the platform decompressor, or null. Reads
 * the output in chunks and aborts as soon as it exceeds MAX_INFLATE, so a
 * bomb member is discarded instead of being buffered whole.
 */
async function inflateRaw(data: Uint8Array): Promise<Uint8Array | null> {
  try {
    // pipeThrough owns the writable side, so a corrupt stream surfaces as a
    // single rejection here rather than a dangling unhandled promise.
    const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_INFLATE) {
        await reader.cancel(); // stop the decompressor; do not buffer the bomb
        return null;
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
  } catch {
    return null; // corrupt or unsupported stream
  }
}

/** Read and decode a member's text: stored (method 0) or DEFLATE (method 8). */
async function readMember(r: Reader, entry: ZipEntry): Promise<string | null> {
  // The local header repeats the name/extra lengths, which can differ from the
  // central directory's, so the data offset is computed from the local header.
  const fnameLen = r.u16(entry.localOffset + 26, true);
  const extraLen = r.u16(entry.localOffset + 28, true);
  if (fnameLen === null || extraLen === null) return null;
  const dataStart = entry.localOffset + 30 + fnameLen + extraLen;
  const data = r.slice(dataStart, entry.compSize);
  if (!data) return null;
  if (entry.method === 0) return new TextDecoder("utf-8").decode(data);
  if (entry.method === 8) {
    const out = await inflateRaw(data);
    return out ? new TextDecoder("utf-8").decode(out) : null;
  }
  return null; // an unsupported compression method is reported, never guessed
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
}

/** Text content of the first `<tag …>…</tag>` element, or null. */
function xmlText(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i").exec(xml);
  if (!m) return null;
  const v = decodeEntities(m[1].trim());
  return v.length ? v : null;
}

interface XmlField { tag: string; label: string; group: string; sensitive?: boolean }

const CORE_FIELDS: XmlField[] = [
  { tag: "dc:title", label: "Title", group: "Document" },
  { tag: "dc:creator", label: "Author", group: "Document", sensitive: true },
  { tag: "cp:lastModifiedBy", label: "Last saved by", group: "Document", sensitive: true },
  { tag: "dc:subject", label: "Subject", group: "Document" },
  { tag: "dc:description", label: "Description", group: "Document" },
  { tag: "cp:keywords", label: "Keywords", group: "Document" },
  { tag: "cp:revision", label: "Revision", group: "Document" },
  { tag: "dcterms:created", label: "Created", group: "Document", sensitive: true },
  { tag: "dcterms:modified", label: "Modified", group: "Document" },
];

const APP_FIELDS: XmlField[] = [
  { tag: "Application", label: "Application", group: "Document" },
  { tag: "Company", label: "Company", group: "Document", sensitive: true },
  { tag: "Manager", label: "Manager", group: "Document", sensitive: true },
  { tag: "TotalTime", label: "Editing time (min)", group: "Document" },
];

const ODF_FIELDS: XmlField[] = [
  { tag: "meta:initial-creator", label: "Author", group: "Document", sensitive: true },
  { tag: "dc:creator", label: "Last saved by", group: "Document", sensitive: true },
  { tag: "meta:creation-date", label: "Created", group: "Document", sensitive: true },
  { tag: "dc:date", label: "Modified", group: "Document" },
  { tag: "meta:generator", label: "Application", group: "Document" },
  { tag: "meta:editing-cycles", label: "Revisions", group: "Document" },
];

const OPF_FIELDS: XmlField[] = [
  { tag: "dc:title", label: "Title", group: "Document" },
  { tag: "dc:creator", label: "Author", group: "Document", sensitive: true },
  { tag: "dc:publisher", label: "Publisher", group: "Document" },
  { tag: "dc:language", label: "Language", group: "Document" },
  { tag: "dc:date", label: "Date", group: "Document" },
];

function fieldsFromXml(xml: string, specs: XmlField[]): MetaField[] {
  const out: MetaField[] = [];
  for (const spec of specs) {
    const v = xmlText(xml, spec.tag);
    if (v) out.push({ label: spec.label, value: v, group: spec.group, sensitive: spec.sensitive });
  }
  return out;
}

const find = (entries: ZipEntry[], name: string) => entries.find((e) => e.name === name) ?? null;

/** Read the document-property members appropriate to the ZIP-based `kind`. */
async function readDocProps(kind: string, r: Reader, entries: ZipEntry[]): Promise<MetaField[]> {
  if (kind === "docx" || kind === "xlsx" || kind === "pptx") {
    const out: MetaField[] = [];
    const core = find(entries, "docProps/core.xml");
    if (core) { const xml = await readMember(r, core); if (xml) out.push(...fieldsFromXml(xml, CORE_FIELDS)); }
    const app = find(entries, "docProps/app.xml");
    if (app) { const xml = await readMember(r, app); if (xml) out.push(...fieldsFromXml(xml, APP_FIELDS)); }
    return out;
  }
  if (kind === "odt" || kind === "ods" || kind === "odp") {
    const meta = find(entries, "meta.xml");
    if (!meta) return [];
    const xml = await readMember(r, meta);
    return xml ? fieldsFromXml(xml, ODF_FIELDS) : [];
  }
  if (kind === "epub") {
    const container = find(entries, "META-INF/container.xml");
    if (!container) return [];
    const cx = await readMember(r, container);
    const opfPath = cx ? /full-path="([^"]+)"/.exec(cx)?.[1] : undefined;
    if (!opfPath) return [];
    const opf = find(entries, opfPath);
    if (!opf) return [];
    const xml = await readMember(r, opf);
    return xml ? fieldsFromXml(xml, OPF_FIELDS) : [];
  }
  return [];
}

/** Extract ZIP archive facts and, for office/e-book packages, document props. */
export async function extractZip(kind: string, bytes: Uint8Array): Promise<Extraction> {
  const r = new Reader(bytes);
  const fields: MetaField[] = [];
  const notes: string[] = [];

  const central = parseCentral(r);
  if (!central) {
    notes.push("No ZIP central directory was found; the archive may be truncated.");
    return { fields, notes };
  }

  fields.push({ label: "Entries", value: String(central.entries.length), group: "Archive" });
  if (central.hostOS) fields.push({ label: "Created on", value: central.hostOS, group: "Archive" });
  if (central.latest) fields.push({ label: "Newest member", value: central.latest, group: "Archive" });
  if (central.comment) fields.push({ label: "Archive comment", value: central.comment, group: "Archive" });
  if (central.encrypted) notes.push("Contains password-protected (encrypted) entries.");

  fields.push(...await readDocProps(kind, r, central.entries));
  return { fields, notes };
}
