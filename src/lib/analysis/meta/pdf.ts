// ── PDF document information ─────────────────────────────────────────────────
//
// A PDF's document-information dictionary routinely carries the author's real
// name, the authoring software, and precise creation and modification
// timestamps: some of the most useful attribution an analyst gets from a leaked
// or shared document. This reads those keys from the raw bytes without a PDF
// engine. Values are only ever surfaced as genuine PDF string or date objects
// (balanced-parenthesis literals, hex strings, or "D:" dates); anything that is
// not a well-formed string token is skipped rather than guessed at, so a stray
// key name in the file never becomes a fabricated field.
//
// The Info dictionary is only the first layer. A PDF also states how many pages
// it has and at what paper size, how many times it has been saved (every
// incremental update leaves its own %%EOF), which typefaces it embeds, whether
// it carries active content, and, in its XMP packet, a pair of identifiers that
// survive editing: xmpMM:DocumentID stays the same across every saved copy of a
// document and xmpMM:InstanceID changes on each save, so two files can be shown
// to be revisions of one original. All of that is read here as well, because an
// author's name alone is rarely the whole of what a document discloses.

import { xmpFields, xmpPacket, XMP_DOCUMENT } from "./xmp";
import type { Extraction, MetaField } from "./types";

const KEYS: { key: string; label: string; date?: boolean; sensitive?: boolean }[] = [
  { key: "Title", label: "Title" },
  { key: "Author", label: "Author", sensitive: true },
  { key: "Subject", label: "Subject" },
  { key: "Keywords", label: "Keywords" },
  { key: "Creator", label: "Creator", sensitive: true },
  { key: "Producer", label: "Producer" },
  { key: "CreationDate", label: "Created", date: true, sensitive: true },
  { key: "ModDate", label: "Modified", date: true },
];

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20].map((c) => String.fromCharCode(c)));

// Bounds that keep a hostile PDF from stalling the parser. A real Info value is
// short (a title, a name, a date), so 64 KiB never truncates a genuine field but
// caps the scan of a string whose closing delimiter is missing. A real document
// carries one Info dictionary (a few via incremental updates); a file with
// thousands of repeated keys is adversarial, so only the first MAX_KEY_MATCHES
// of each key are parsed. Together these turn what was a quadratic scan (every
// one of N unterminated "(" re-read to end of file) into a linear one.
const MAX_PDF_VALUE = 1 << 16;
const MAX_KEY_MATCHES = 256;

/** Decode a hex string's bytes, honouring a UTF-16BE byte-order mark. */
function decodeBytes(bytes: number[]): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let s = "";
    for (let i = 2; i + 1 < bytes.length; i += 2) s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    return s;
  }
  return bytes.map((b) => String.fromCharCode(b)).join("");
}

const SIMPLE_ESCAPE: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92 };

/** Parse a PDF literal string "(...)" starting at the "(", returning its text. */
function readLiteral(s: string, start: number): { value: string; next: number } {
  const out: number[] = [];
  let depth = 0;
  let i = start;
  const limit = Math.min(s.length, start + MAX_PDF_VALUE); // bound an unterminated "("
  for (; i < limit; i++) {
    const c = s[i];
    if (c === "\\") {
      const n = s[i + 1];
      if (n === undefined) break; // trailing backslash at end of input
      i++; // consume the escaped character
      if (n in SIMPLE_ESCAPE) out.push(SIMPLE_ESCAPE[n]);
      else if (n >= "0" && n <= "7") {
        let oct = n; // up to three octal digits form one byte code
        while (oct.length < 3 && s[i + 1] >= "0" && s[i + 1] <= "7") { oct += s[i + 1]; i++; }
        out.push(parseInt(oct, 8) & 0xff);
      } else if (n !== "\n") out.push(n.charCodeAt(0)); // "\<newline>" is a dropped line continuation
      continue;
    }
    if (c === "(") { depth++; out.push(40); continue; }
    if (c === ")") {
      if (depth === 0) { i++; break; }
      depth--; out.push(41); continue;
    }
    out.push(c.charCodeAt(0));
  }
  return { value: decodeBytes(out).trim(), next: i };
}

/** Parse a PDF hex string "<...>" starting at the "<", returning its text. */
function readHex(s: string, start: number): { value: string; next: number } {
  let hex = "";
  let i = start + 1;
  const limit = Math.min(s.length, start + 1 + MAX_PDF_VALUE); // bound an unterminated "<"
  for (; i < limit && s[i] !== ">"; i++) if (!WS.has(s[i])) hex += s[i];
  if (hex.length % 2) hex += "0"; // an odd final digit is padded with 0
  const bytes: number[] = [];
  for (let j = 0; j < hex.length; j += 2) bytes.push(parseInt(hex.slice(j, j + 2), 16) & 0xff);
  return { value: decodeBytes(bytes).trim(), next: i + 1 };
}

/** Read the string value that follows a `/Key`, or null if none is present. */
function readValue(s: string, from: number): string | null {
  let i = from;
  while (i < s.length && WS.has(s[i])) i++;
  if (s[i] === "(") return readLiteral(s, i + 1).value || null;
  if (s[i] === "<" && s[i + 1] !== "<") return readHex(s, i).value || null;
  return null; // names, references and numbers are not Info string values
}

/** "D:YYYYMMDDHHmmSS…" to "YYYY-MM-DD HH:MM:SS", or the raw value if unparseable. */
function normalizePdfDate(raw: string): string {
  const m = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(raw);
  if (!m) return raw;
  const [, y, mo = "01", d = "01", h = "00", mi = "00", se = "00"] = m;
  return `${y}-${mo}-${d} ${h}:${mi}:${se}`;
}

// ── Structure: pages, paper size, save history ───────────────────────────────

/**
 * Count matches of a global pattern in one linear pass. Every pattern passed
 * here consumes at least one character, so `lastIndex` always advances and the
 * loop terminates; counting rather than collecting keeps a file with a million
 * page objects from materialising a million strings.
 */
function countMatches(s: string, re: RegExp): number {
  let n = 0;
  re.lastIndex = 0;
  while (re.exec(s) !== null) n++;
  return n;
}

// Standard sheets, in PostScript points (1/72 inch), with the millimetre
// equivalent an analyst actually thinks in. Matched to the nearest 3 points,
// which absorbs a producer's rounding without letting two sizes collide.
const PAPER: { name: string; w: number; h: number }[] = [
  { name: "A4", w: 595, h: 842 },
  { name: "A3", w: 842, h: 1191 },
  { name: "A5", w: 420, h: 595 },
  { name: "Letter", w: 612, h: 792 },
  { name: "Legal", w: 612, h: 1008 },
  { name: "Tabloid", w: 792, h: 1224 },
];

const mm = (pt: number) => Math.round((pt * 25.4) / 72);

/** Name the sheet a width/height pair in points corresponds to, or null. */
function paperName(w: number, h: number): string | null {
  for (const p of PAPER) {
    if (Math.abs(w - p.w) <= 3 && Math.abs(h - p.h) <= 3) return p.name;
  }
  return null;
}

/** Describe the first /MediaBox as a size, a sheet name and an orientation. */
function pageSize(s: string): string | null {
  const m = /\/MediaBox\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/.exec(s);
  if (!m) return null;
  const w = Math.round(Math.abs(parseFloat(m[3]) - parseFloat(m[1])));
  const h = Math.round(Math.abs(parseFloat(m[4]) - parseFloat(m[2])));
  if (w <= 0 || h <= 0) return null;
  const portrait = h >= w;
  const name = paperName(Math.min(w, h), Math.max(w, h));
  const sheet = name ? `${name} ${portrait ? "portrait" : "landscape"}, ` : "";
  return `${w} × ${h} pt (${sheet}${mm(w)} × ${mm(h)} mm)`;
}

// ── Encryption ───────────────────────────────────────────────────────────────

/**
 * Name the encryption a PDF declares, from the /Encrypt dictionary's algorithm
 * version. Reported as the standard's own terms so the reader can judge what is
 * withheld, rather than a bare "encrypted".
 */
function encryptionKind(s: string): string {
  if (/\/AESV3\b/.test(s)) return "AES-256";
  if (/\/AESV2\b/.test(s)) return "AES-128";
  const v = /\/Encrypt[\s\S]{0,400}?\/V\s+(\d+)/.exec(s);
  const length = /\/Encrypt[\s\S]{0,400}?\/Length\s+(\d+)/.exec(s);
  if (v && v[1] === "1") return "RC4 40-bit";
  if (v && v[1] === "2") return length ? `RC4 ${length[1]}-bit` : "RC4";
  return "undeclared algorithm";
}

// ── Active content ───────────────────────────────────────────────────────────

// Features that change what opening the document does. Each is a real key in a
// real PDF dictionary, so a hit is a statement about the file's structure, not a
// verdict about intent: a form or an attachment is ordinary in a business
// document and worth knowing about in one that arrived unexpectedly.
const ACTIVE: { re: RegExp; label: string }[] = [
  { re: /\/JavaScript\b|\/JS\b/, label: "JavaScript" },
  { re: /\/OpenAction\b/, label: "Open action (runs on open)" },
  { re: /\/Launch\b/, label: "Launch action (starts a program)" },
  { re: /\/EmbeddedFile(?:s)?\b/, label: "Embedded file attachment" },
  { re: /\/AcroForm\b/, label: "Fillable form" },
  { re: /\/XFA\b/, label: "XFA form" },
  { re: /\/RichMedia\b/, label: "Rich media (video / Flash)" },
  { re: /\/GoToR\b/, label: "Remote go-to action" },
  { re: /\/SubmitForm\b/, label: "Form submission action" },
];

// ── Embedded fonts ───────────────────────────────────────────────────────────

// A subset font is written as "ABCDEF+Helvetica": six letters, a plus, then the
// real name. The tag is per-file noise, so it is stripped and the names deduped,
// leaving the typeface list itself, which says a good deal about the authoring
// machine (a document set in Calibri was written on Windows Office; one in
// Helvetica Neue on a Mac).
function fontNames(s: string): string[] {
  const out = new Set<string>();
  const re = /\/BaseFont\s*\/([A-Za-z0-9#+._-]{1,127})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    out.add(m[1].replace(/^[A-Z]{6}\+/, ""));
    if (out.size >= 24) break; // enough to characterise; not a full inventory
  }
  return [...out];
}

/**
 * Extract the document-information fields from a PDF. Later occurrences of a key
 * win, so an incremental update's newer metadata overrides the original.
 */
export function extractPdf(bytes: Uint8Array): Extraction {
  const s = new TextDecoder("latin1").decode(bytes);
  const fields: MetaField[] = [];
  const notes: string[] = [];

  const version = /^%PDF-(\d+\.\d+)/.exec(s);
  if (version) fields.push({ label: "PDF version", value: version[1], group: "Document" });

  for (const spec of KEYS) {
    const re = new RegExp(`/${spec.key}(?![A-Za-z])`, "g");
    let last: string | null = null;
    let m: RegExpExecArray | null;
    let matches = 0;
    while ((m = re.exec(s)) !== null) {
      const v = readValue(s, m.index + m[0].length);
      if (v !== null) last = v;
      if (++matches >= MAX_KEY_MATCHES) break; // an adversarial flood of one key
    }
    if (last === null) continue;
    fields.push({ label: spec.label, value: spec.date ? normalizePdfDate(last) : last, group: "Document", sensitive: spec.sensitive });
  }

  const lang = /\/Lang\s*\(([^)]{1,32})\)/.exec(s);
  if (lang) fields.push({ label: "Language", value: lang[1], group: "Document" });

  // ── Structure ──────────────────────────────────────────────────────────────
  // Page objects are counted directly rather than trusting /Count, which an
  // incremental update can leave stale. A PDF whose objects live in compressed
  // object streams shows none from here, and then the field is simply omitted.
  const pages = countMatches(s, /\/Type\s*\/Page(?![sA-Za-z])/g);
  if (pages > 0) fields.push({ label: "Pages", value: String(pages), group: "Structure" });

  const size = pageSize(s);
  if (size) fields.push({ label: "Page size", value: size, group: "Structure" });

  // Every save appends a new body and its own %%EOF, so the count is the number
  // of times the file has been written: a document on its fourth revision has
  // three earlier versions still inside it.
  const saves = countMatches(s, /%%EOF/g);
  if (saves > 1) {
    fields.push({ label: "Saved", value: `${saves} times (${saves - 1} incremental ${saves === 2 ? "update" : "updates"})`, group: "Structure" });
    notes.push(`This file has been saved ${saves} times. Earlier revisions are still present in the bytes and may contain content that was edited out of the visible document.`);
  }

  if (/\/Linearized\b/.test(s)) fields.push({ label: "Linearized", value: "yes (optimised for web viewing)", group: "Structure" });
  if (/\/MarkInfo\b/.test(s)) fields.push({ label: "Tagged PDF", value: "yes (accessibility structure present)", group: "Structure" });

  const images = countMatches(s, /\/Subtype\s*\/Image\b/g);
  if (images > 0) fields.push({ label: "Embedded images", value: String(images), group: "Structure" });

  const fonts = fontNames(s);
  if (fonts.length) fields.push({ label: "Embedded fonts", value: fonts.join(", "), group: "Structure" });

  // ── Active content ─────────────────────────────────────────────────────────
  const active = ACTIVE.filter((a) => a.re.test(s)).map((a) => a.label);
  if (active.length) {
    fields.push({ label: "Active content", value: active.join(", "), group: "Structure", sensitive: true });
    notes.push("Opening this PDF does more than render pages: it declares " + active.join(", ").toLowerCase() + ". Open it in a sandbox if its origin is not trusted.");
  }

  // ── XMP ────────────────────────────────────────────────────────────────────
  const xmp = xmpPacket(s);
  if (xmp) {
    const read = xmpFields(xmp, XMP_DOCUMENT);
    fields.push(...read);
    notes.push(read.length === 0
      ? "Carries an XMP metadata packet, but none of its standard properties were populated."
      : "Document ID and Instance ID come from the XMP packet: the document ID is carried by every saved copy of the same original, so two files sharing one are revisions of each other.");
  }

  if (/\/Encrypt\b/.test(s)) {
    fields.push({ label: "Encryption", value: encryptionKind(s), group: "Document" });
    notes.push("This PDF is encrypted; some metadata may be withheld or unreadable.");
  }

  return { fields, notes };
}
