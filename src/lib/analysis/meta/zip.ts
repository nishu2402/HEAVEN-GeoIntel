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
import { inflate } from "./inflate";
import type { Extraction, MetaField } from "./types";

interface ZipEntry {
  name: string;
  method: number;
  compSize: number;
  rawSize: number;
  localOffset: number;
  date: string | null;
  encrypted: boolean;
}

interface Central {
  entries: ZipEntry[];
  comment: string | null;
  hostOS: string | null;
  oldest: string | null;
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
  let oldest: string | null = null;
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
    const rawSize = r.u32(p + 24, true) ?? 0;
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
    if (when && (oldest === null || when < oldest)) oldest = when;
    entries.push({ name, method, compSize, rawSize, localOffset, date: when, encrypted });
    p += 46 + fnameLen + extraLen + commentLen2;
  }

  return { entries, comment, hostOS, oldest, latest, encrypted: anyEncrypted };
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
    const out = await inflate(data, "deflate-raw");
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
  { tag: "AppVersion", label: "Application version", group: "Document" },
  { tag: "Company", label: "Company", group: "Document", sensitive: true },
  { tag: "Manager", label: "Manager", group: "Document", sensitive: true },
  { tag: "Template", label: "Template", group: "Document", sensitive: true },
  { tag: "HyperlinkBase", label: "Hyperlink base", group: "Document", sensitive: true },
  { tag: "TotalTime", label: "Editing time (min)", group: "Document", sensitive: true },
  { tag: "DocSecurity", label: "Document security flag", group: "Document" },
  { tag: "Pages", label: "Pages", group: "Statistics" },
  { tag: "Slides", label: "Slides", group: "Statistics" },
  { tag: "Notes", label: "Notes", group: "Statistics" },
  { tag: "HiddenSlides", label: "Hidden slides", group: "Statistics" },
  { tag: "Words", label: "Words", group: "Statistics" },
  { tag: "Characters", label: "Characters", group: "Statistics" },
  { tag: "CharactersWithSpaces", label: "Characters with spaces", group: "Statistics" },
  { tag: "Lines", label: "Lines", group: "Statistics" },
  { tag: "Paragraphs", label: "Paragraphs", group: "Statistics" },
];

const ODF_FIELDS: XmlField[] = [
  { tag: "dc:title", label: "Title", group: "Document" },
  { tag: "dc:subject", label: "Subject", group: "Document" },
  { tag: "meta:initial-creator", label: "Author", group: "Document", sensitive: true },
  { tag: "dc:creator", label: "Last saved by", group: "Document", sensitive: true },
  { tag: "meta:printed-by", label: "Last printed by", group: "Document", sensitive: true },
  { tag: "meta:print-date", label: "Last printed", group: "Document", sensitive: true },
  { tag: "meta:creation-date", label: "Created", group: "Document", sensitive: true },
  { tag: "dc:date", label: "Modified", group: "Document" },
  { tag: "meta:generator", label: "Application", group: "Document" },
  { tag: "meta:editing-cycles", label: "Revisions", group: "Document" },
  { tag: "meta:editing-duration", label: "Editing time", group: "Document", sensitive: true },
  { tag: "meta:keyword", label: "Keywords", group: "Document" },
];

// OpenDocument keeps its counts as attributes on one element rather than as
// child elements, so they are read by name from that element's attributes.
const ODF_STATS: { attr: string; label: string }[] = [
  { attr: "meta:page-count", label: "Pages" },
  { attr: "meta:word-count", label: "Words" },
  { attr: "meta:character-count", label: "Characters" },
  { attr: "meta:paragraph-count", label: "Paragraphs" },
  { attr: "meta:image-count", label: "Images" },
  { attr: "meta:table-count", label: "Tables" },
  { attr: "meta:object-count", label: "Embedded objects" },
];

const OPF_FIELDS: XmlField[] = [
  { tag: "dc:title", label: "Title", group: "Document" },
  { tag: "dc:creator", label: "Author", group: "Document", sensitive: true },
  { tag: "dc:contributor", label: "Contributor", group: "Document", sensitive: true },
  { tag: "dc:publisher", label: "Publisher", group: "Document" },
  { tag: "dc:identifier", label: "Identifier", group: "Document" },
  { tag: "dc:language", label: "Language", group: "Document" },
  { tag: "dc:date", label: "Date", group: "Document" },
  { tag: "dc:rights", label: "Rights", group: "Document" },
  { tag: "dc:description", label: "Description", group: "Document" },
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

/** One attribute's value on the element that declares it, or null. */
function xmlAttr(xml: string, attr: string): string | null {
  const m = new RegExp(`\\b${attr}="([^"]*)"`).exec(xml);
  return m && m[1].trim() ? m[1].trim() : null;
}

// Java's manifest is a plain key/value file, and a build tool fills in three
// keys that name the machine it ran on: the account that ran the build, the
// toolchain, and the JDK. They are routinely left in shipped jars.
const MANIFEST_KEYS: { key: string; label: string; sensitive?: boolean }[] = [
  { key: "Built-By", label: "Built by", sensitive: true },
  { key: "Created-By", label: "Created by", sensitive: true },
  { key: "Build-Jdk", label: "Build JDK" },
  { key: "Build-Jdk-Spec", label: "Build JDK" },
  { key: "Main-Class", label: "Main class" },
  { key: "Implementation-Title", label: "Implementation title" },
  { key: "Implementation-Version", label: "Implementation version" },
  { key: "Implementation-Vendor", label: "Vendor" },
  { key: "Bundle-SymbolicName", label: "Bundle name" },
];

/** Read the key/value pairs a Java manifest declares. */
function manifestFields(text: string): MetaField[] {
  const out: MetaField[] = [];
  const seen = new Set<string>();
  for (const spec of MANIFEST_KEYS) {
    const m = new RegExp(`^${spec.key}:[ \\t]*(.+)$`, "mi").exec(text);
    if (!m || seen.has(spec.label)) continue;
    seen.add(spec.label);
    out.push({ label: spec.label, value: m[1].trim(), group: "Build", sensitive: spec.sensitive });
  }
  return out;
}

/** Human-readable byte count for an archive's totals. */
function humanBytes(n: number): string {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// A member name that escapes the extraction directory. Both forms are real
// attacks ("zip slip"), and both are worth naming rather than counting.
const isTraversal = (name: string) => name.startsWith("/") || name.startsWith("../") || name.includes("/../");

// Extensions that execute when opened. In an archive that arrived by email this
// is the first thing to look at; in a software distribution it is unremarkable.
const EXECUTABLE = /\.(exe|dll|scr|bat|cmd|com|pif|vbs|vbe|js|jse|wsf|wsh|ps1|jar|msi|lnk|hta|sh|app)$/i;

/** Android ABIs a package ships native code for, from its lib/ paths. */
function androidAbis(entries: ZipEntry[]): string[] {
  const abis = new Set<string>();
  for (const e of entries) {
    const m = /^lib\/([^/]+)\//.exec(e.name);
    if (m) abis.add(m[1]);
  }
  return [...abis];
}

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
    if (!xml) return [];
    const out = fieldsFromXml(xml, ODF_FIELDS);
    const stats = /<meta:document-statistic\b[^>]*>/.exec(xml)?.[0];
    if (stats) {
      for (const spec of ODF_STATS) {
        const v = xmlAttr(stats, spec.attr);
        if (v) out.push({ label: spec.label, value: v, group: "Statistics" });
      }
    }
    return out;
  }
  if (kind === "jar" || kind === "apk") {
    const manifest = find(entries, "META-INF/MANIFEST.MF");
    const text = manifest ? await readMember(r, manifest) : null;
    const out = text ? manifestFields(text) : [];
    const signed = entries.some((e) => /^META-INF\/.+\.(RSA|DSA|EC|SF)$/i.test(e.name));
    out.push({ label: "Signed", value: signed ? "yes (signature block present)" : "no signature block", group: "Build" });
    if (kind === "apk") {
      const abis = androidAbis(entries);
      if (abis.length) out.push({ label: "Native ABIs", value: abis.join(", "), group: "Build" });
      const dex = entries.filter((e) => /^classes\d*\.dex$/.test(e.name)).length;
      if (dex > 0) out.push({ label: "DEX files", value: String(dex), group: "Build" });
    }
    return out;
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

  const entries = central.entries;
  const files = entries.filter((e) => !e.name.endsWith("/"));
  const raw = files.reduce((n, e) => n + e.rawSize, 0);
  const packed = files.reduce((n, e) => n + e.compSize, 0);

  fields.push({ label: "Entries", value: String(entries.length), group: "Archive" });
  if (entries.length !== files.length) {
    fields.push({ label: "Folders", value: String(entries.length - files.length), group: "Archive" });
  }
  if (raw > 0) {
    fields.push({ label: "Uncompressed", value: humanBytes(raw), group: "Archive" });
    // The ratio is the archive's own numbers, and a wildly high one is the
    // signature of a decompression bomb as much as of well-compressed text.
    fields.push({ label: "Compression", value: `${(100 - (packed / raw) * 100).toFixed(1)}% smaller packed`, group: "Archive" });
  }
  if (central.hostOS) fields.push({ label: "Created on", value: central.hostOS, group: "Archive" });
  if (central.oldest && central.oldest !== central.latest) {
    fields.push({ label: "Oldest member", value: central.oldest, group: "Archive", sensitive: true });
  }
  if (central.latest) fields.push({ label: "Newest member", value: central.latest, group: "Archive", sensitive: true });
  if (central.comment) fields.push({ label: "Archive comment", value: central.comment, group: "Archive" });

  // The deepest path and a sample of names say what the archive is for far
  // faster than a count does, and the sample is what an analyst reads first.
  const sample = files.slice(0, 8).map((e) => e.name);
  if (sample.length) {
    fields.push({ label: "Contents", value: sample.join(", ") + (files.length > sample.length ? `, and ${files.length - sample.length} more` : ""), group: "Archive" });
  }

  const executables = files.filter((e) => EXECUTABLE.test(e.name));
  if (executables.length) {
    fields.push({ label: "Executable members", value: executables.slice(0, 6).map((e) => e.name).join(", "), group: "Archive", sensitive: true });
  }

  const traversal = files.filter((e) => isTraversal(e.name));
  if (traversal.length) {
    fields.push({ label: "Paths outside the archive", value: traversal.slice(0, 6).map((e) => e.name).join(", "), group: "Archive", sensitive: true });
    notes.push("One or more members name a path outside the extraction directory. That is how a zip-slip archive overwrites files elsewhere on the machine; extract it only in a sandbox.");
  }

  if (central.encrypted) notes.push("Contains password-protected (encrypted) entries.");

  fields.push(...await readDocProps(kind, r, entries));
  return { fields, notes };
}
