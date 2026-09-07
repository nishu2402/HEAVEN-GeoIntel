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

  if (/\/Encrypt\b/.test(s)) notes.push("This PDF is encrypted; some metadata may be withheld or unreadable.");
  if (s.includes("<x:xmpmeta") || s.includes("<?xpacket")) notes.push("Carries an XMP metadata packet (extended document properties).");

  return { fields, notes };
}
