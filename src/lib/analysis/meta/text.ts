// ── Text formats: HTML, SVG, XML, JSON, CSV, RTF, email, scripts ────────────
//
// A text file has no metadata block, which is exactly why the metadata in one
// gets forgotten. It is written in plain sight instead:
//
//   * an SVG exported from Illustrator or Inkscape keeps the name of the file
//     it was saved from, the version of the editor, and often the author's RDF
//     block. sodipodi:docname is a local filename, in the clear.
//   * an HTML page names its generator, its author, and every external host it
//     pulls from, and its comments are where build systems and content editors
//     leave notes nobody expects a reader to see.
//   * an RTF carries the same author, operator and company that a Word document
//     does, as plain control words.
//   * an .eml file is an entire mail transaction: the sender, the recipients,
//     the client that composed it, and the chain of servers it passed through.
//
// Everything below is read out of the text as written. Nothing is inferred from
// the content: a field appears because the file states it.

import type { Extraction, MetaField } from "./types";

const push = (fields: MetaField[], label: string, value: string | null | undefined, group: string, sensitive?: boolean) => {
  const v = value?.replace(/\s+/g, " ").trim();
  if (v) fields.push({ label, value: v.length > 2000 ? `${v.slice(0, 2000)}…` : v, group, sensitive });
};

/** How much of a text file to read. Metadata lives at the top of every format
 *  below except CSV, whose row count needs the whole file. */
const MAX_TEXT = 1 << 20;

const decodeEntities = (s: string) => s
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&amp;/g, "&");

/** The text of the first `<tag>…</tag>`, entities decoded. */
function element(text: string, tag: string): string | null {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i").exec(text);
  return m ? decodeEntities(m[1].replace(/<[^>]*>/g, " ")) : null;
}

/** The value of an attribute wherever it appears, entities decoded. */
function attribute(text: string, attr: string): string | null {
  const m = new RegExp(`\\b${attr}\\s*=\\s*"([^"]*)"`, "i").exec(text);
  return m ? decodeEntities(m[1]) : null;
}

// ── Facts every text file has ────────────────────────────────────────────────

/**
 * Encoding and line-ending facts, read from the bytes rather than assumed. The
 * line ending alone says which family of machine last wrote the file, and a
 * byte-order mark says which editor did.
 */
function textShape(bytes: Uint8Array, text: string): MetaField[] {
  const fields: MetaField[] = [];
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? "UTF-8 byte-order mark"
    : bytes[0] === 0xff && bytes[1] === 0xfe ? "UTF-16 little-endian byte-order mark"
      : bytes[0] === 0xfe && bytes[1] === 0xff ? "UTF-16 big-endian byte-order mark" : null;
  push(fields, "Byte-order mark", bom, "Text");

  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/(?<!\r)\n/g) ?? []).length;
  if (crlf > 0 || lf > 0) {
    push(fields, "Line endings", crlf > 0 && lf > 0 ? "mixed (CRLF and LF)" : crlf > 0 ? "CRLF (Windows)" : "LF (Unix)", "Text");
    push(fields, "Lines", String(crlf + lf + (/[^\r\n]$/.test(text) ? 1 : 0)), "Text");
  }
  const nonAscii = /[^\x00-\x7f]/.test(text);
  push(fields, "Character set", nonAscii ? "beyond ASCII (accented or non-Latin characters present)" : "ASCII only", "Text");
  return fields;
}

// ── HTML ─────────────────────────────────────────────────────────────────────

const META_NAMES: { name: string; label: string; sensitive?: boolean }[] = [
  { name: "generator", label: "Generator", sensitive: true },
  { name: "author", label: "Author", sensitive: true },
  { name: "description", label: "Description" },
  { name: "keywords", label: "Keywords" },
  { name: "copyright", label: "Copyright" },
  { name: "application-name", label: "Application" },
  { name: "robots", label: "Robots directive" },
];

/** `<meta name="…" content="…">` in either attribute order. */
function metaContent(html: string, name: string): string | null {
  const re = new RegExp(`<meta[^>]*\\bname\\s*=\\s*"${name}"[^>]*>`, "i");
  const tag = re.exec(html)?.[0] ?? new RegExp(`<meta[^>]*\\bcontent\\s*=\\s*"[^"]*"[^>]*\\bname\\s*=\\s*"${name}"[^>]*>`, "i").exec(html)?.[0];
  return tag ? attribute(tag, "content") : null;
}

/** Distinct external hosts a document loads from or links to. */
function externalHosts(text: string): string[] {
  const hosts = new Set<string>();
  const re = /\bhttps?:\/\/([A-Za-z0-9.-]{1,253})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null && hosts.size < 20) hosts.add(m[1].toLowerCase());
  return [...hosts];
}

function extractHtml(text: string): Extraction {
  const fields: MetaField[] = [];
  push(fields, "Title", element(text, "title"), "Document");
  for (const spec of META_NAMES) push(fields, spec.label, metaContent(text, spec.name), "Document", spec.sensitive);

  const og = /<meta[^>]*property\s*=\s*"og:site_name"[^>]*>/i.exec(text)?.[0];
  push(fields, "Site name", og ? attribute(og, "content") : null, "Document");
  push(fields, "Language", attribute(/<html[^>]*>/i.exec(text)?.[0] ?? "", "lang"), "Document");

  const scripts = (text.match(/<script\b/gi) ?? []).length;
  const styles = (text.match(/<link\b[^>]*stylesheet/gi) ?? []).length;
  const images = (text.match(/<img\b/gi) ?? []).length;
  const forms = (text.match(/<form\b/gi) ?? []).length;
  push(fields, "Structure", `${scripts} scripts, ${styles} stylesheets, ${images} images, ${forms} forms`, "Document");

  const hosts = externalHosts(text);
  if (hosts.length) push(fields, "External hosts", hosts.join(", "), "Document", true);

  // Comments are where a build pipeline, a CMS or an editor leaves notes that
  // were never meant for a reader.
  const comments = [...text.matchAll(/<!--([\s\S]{1,400}?)-->/g)]
    .map((m) => m[1].trim())
    .filter((c) => c.length > 0 && !c.startsWith("["));
  if (comments.length) push(fields, "Comments", comments.slice(0, 5).join(" | "), "Document", true);
  return { fields };
}

// ── SVG ──────────────────────────────────────────────────────────────────────

const SVG_ATTRS: { attr: string; label: string; sensitive?: boolean }[] = [
  { attr: "sodipodi:docname", label: "Original filename", sensitive: true },
  { attr: "inkscape:version", label: "Inkscape version", sensitive: true },
  { attr: "inkscape:export-filename", label: "Export path", sensitive: true },
  { attr: "width", label: "Width" },
  { attr: "height", label: "Height" },
  { attr: "viewBox", label: "View box" },
];

// Hosts an SVG carries because of the tool that drew it, not because the
// document points at anything: the SVG namespace, Inkscape's own namespaces and
// the SourceForge URL its DTD still uses.
//
// Matched label by label rather than by suffix. "evilw3.org" ends with "w3.org"
// and is somebody else's host, and an editor that quietly dropped it would hide
// the one host in the file worth reporting.
const TOOLCHAIN_HOSTS = new Set(["w3.org", "sourceforge.net", "inkscape.org"]);

function isToolchainHost(host: string): boolean {
  const labels = host.replace(/\.+$/, "").split(".");
  for (let i = 0; i < labels.length; i++) {
    if (TOOLCHAIN_HOSTS.has(labels.slice(i).join("."))) return true;
  }
  return false;
}

function extractSvg(text: string): Extraction {
  const fields: MetaField[] = [];
  push(fields, "Title", element(text, "title"), "Image");
  push(fields, "Description", element(text, "desc"), "Image");
  const root = /<svg[\s\S]*?>/i.exec(text)?.[0] ?? "";
  for (const spec of SVG_ATTRS) push(fields, spec.label, attribute(root, spec.attr), "Image", spec.sensitive);

  // Illustrator writes its version into a comment above the root element.
  const generator = /<!--\s*(Generator:[\s\S]*?)\s*-->/i.exec(text)?.[1];
  push(fields, "Generator", generator, "Image", true);

  // An embedded RDF block carries the same Dublin Core fields a photo would.
  for (const [tag, label] of [["dc:creator", "Creator"], ["dc:title", "RDF title"], ["dc:rights", "Rights"], ["dc:date", "Date"]] as const) {
    push(fields, label, element(text, tag), "Image", label === "Creator");
  }

  const elements = (text.match(/<(?!\/|!|\?)[A-Za-z]/g) ?? []).length;
  if (elements > 0) push(fields, "Elements", String(elements), "Image");
  const embedded = (text.match(/data:image\//g) ?? []).length;
  if (embedded > 0) push(fields, "Embedded images", String(embedded), "Image");
  const hosts = externalHosts(text).filter((h) => !isToolchainHost(h));
  if (hosts.length) push(fields, "External hosts", hosts.join(", "), "Image", true);
  return { fields };
}

// ── XML ──────────────────────────────────────────────────────────────────────

/** Index just past `close`, or -1 when the token is never closed. */
function skipPast(text: string, open: number, openLength: number, close: string): number {
  const end = text.indexOf(close, open + openLength);
  return end === -1 ? -1 : end + close.length;
}

/**
 * The name of the first real element, skipping whatever prologue precedes it.
 *
 * This was one `replace()` deleting every declaration, comment and doctype at
 * once, and a single pass cannot promise its own output is free of them: on
 * `<!<!-- -->-- x --><real/>` it removes the inner comment and the halves left
 * either side close up into a new `<!-- x -->`, behind the point the pass has
 * already read. The name it returned was still right, but only because the
 * regex that read it skips whatever it does not recognise — the strip was not
 * doing the job it looked like it was doing (CodeQL js/incomplete-multi-
 * character-sanitization). A forward scan reads each token where it actually
 * starts, so there is nothing to reassemble and nothing to leave behind.
 */
function rootElement(text: string): string | undefined {
  const name = /<([A-Za-z_][\w.:-]*)/y;
  let at = text.indexOf("<");
  while (at !== -1) {
    let next: number;
    if (text.startsWith("<?", at)) next = skipPast(text, at, 2, "?>");
    else if (text.startsWith("<!--", at)) next = skipPast(text, at, 4, "-->");
    else if (text.startsWith("<!", at)) next = skipPast(text, at, 2, ">");
    else {
      name.lastIndex = at;
      const m = name.exec(text);
      if (m) return m[1];
      next = at + 1;   // a "<" that starts nothing at all: step over it
    }
    // An unterminated declaration or comment swallows the rest of the file:
    // there is no element after it to name.
    if (next === -1) return undefined;
    at = text.indexOf("<", next);
  }
  return undefined;
}

function extractXml(text: string): Extraction {
  const fields: MetaField[] = [];
  const decl = /<\?xml[^>]*\?>/.exec(text)?.[0] ?? "";
  push(fields, "XML version", attribute(decl, "version"), "Document");
  push(fields, "Declared encoding", attribute(decl, "encoding"), "Document");
  const doctype = /<!DOCTYPE\s+([^\s>[]+)/i.exec(text)?.[1];
  push(fields, "Document type", doctype, "Document");
  const root = rootElement(text);
  push(fields, "Root element", root, "Document");
  const namespaces = [...new Set([...text.matchAll(/xmlns(?::[\w.-]+)?\s*=\s*"([^"]+)"/g)].map((m) => m[1]))];
  if (namespaces.length) push(fields, "Namespaces", namespaces.slice(0, 8).join(", "), "Document");
  return { fields };
}

// ── JSON ─────────────────────────────────────────────────────────────────────

function extractJson(text: string): Extraction {
  const fields: MetaField[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { fields, notes: ["The file begins like JSON but does not parse, so nothing is described from its structure."] };
  }
  if (Array.isArray(parsed)) {
    push(fields, "Shape", `array of ${parsed.length} ${parsed.length === 1 ? "item" : "items"}`, "Data");
    const first = parsed[0];
    if (first !== null && typeof first === "object") {
      push(fields, "Item fields", Object.keys(first as object).slice(0, 20).join(", "), "Data");
    }
    return { fields };
  }
  if (parsed !== null && typeof parsed === "object") {
    const keys = Object.keys(parsed as object);
    push(fields, "Shape", `object with ${keys.length} top-level ${keys.length === 1 ? "key" : "keys"}`, "Data");
    push(fields, "Top-level keys", keys.slice(0, 20).join(", "), "Data");
    return { fields };
  }
  push(fields, "Shape", `a single ${typeof parsed} value`, "Data");
  return { fields };
}

// ── Delimited data ───────────────────────────────────────────────────────────

function extractDelimited(text: string, delimiter: string, name: string): Extraction {
  const fields: MetaField[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return { fields };
  push(fields, "Delimiter", name, "Data");
  const header = lines[0].split(delimiter);
  push(fields, "Columns", String(header.length), "Data");
  push(fields, "Rows", String(Math.max(0, lines.length - 1)), "Data");
  // The header row is the single most useful thing in a data file: it says what
  // the rows are about, and whether they are about people.
  push(fields, "Header", header.slice(0, 24).map((h) => h.replace(/^"|"$/g, "").trim()).join(", "), "Data", true);
  return { fields };
}

// ── RTF ──────────────────────────────────────────────────────────────────────

const RTF_INFO: { word: string; label: string; sensitive?: boolean }[] = [
  { word: "title", label: "Title" },
  { word: "subject", label: "Subject" },
  { word: "author", label: "Author", sensitive: true },
  { word: "manager", label: "Manager", sensitive: true },
  { word: "company", label: "Company", sensitive: true },
  { word: "operator", label: "Last saved by", sensitive: true },
  { word: "category", label: "Category" },
  { word: "keywords", label: "Keywords" },
  { word: "comment", label: "Comment" },
  { word: "doccomm", label: "Document comment" },
];

/** An RTF timestamp group, e.g. `\creatim\yr2024\mo3\dy2\hr10\min15`. */
function rtfDate(text: string, word: string): string | null {
  const m = new RegExp(`\\\\${word}([^}]*)`).exec(text);
  if (!m) return null;
  const part = (k: string, fallback: number) => {
    const v = new RegExp(`\\\\${k}(\\d+)`).exec(m[1]);
    return v ? Number(v[1]) : fallback;
  };
  const year = part("yr", 0);
  if (year === 0) return null;
  const two = (n: number) => String(n).padStart(2, "0");
  return `${year}-${two(part("mo", 1))}-${two(part("dy", 1))} ${two(part("hr", 0))}:${two(part("min", 0))}`;
}

function extractRtf(text: string): Extraction {
  const fields: MetaField[] = [];
  for (const spec of RTF_INFO) {
    const m = new RegExp(`\\\\${spec.word}\\s*([^\\\\{}]*)`).exec(text);
    push(fields, spec.label, m?.[1], "Document", spec.sensitive);
  }
  push(fields, "Created", rtfDate(text, "creatim"), "Document", true);
  push(fields, "Modified", rtfDate(text, "revtim"), "Document");
  push(fields, "Last printed", rtfDate(text, "printim"), "Document", true);
  const generator = /\\\*\\generator\s*([^\\{}]*)/.exec(text)?.[1];
  push(fields, "Generator", generator, "Document", true);
  const edmins = /\\edmins(\d+)/.exec(text)?.[1];
  push(fields, "Total editing time", edmins ? `${edmins} minutes` : null, "Document", true);
  const version = /\\vern(\d+)/.exec(text)?.[1];
  push(fields, "Internal version", version, "Document");
  const pages = /\\nofpages(\d+)/.exec(text)?.[1];
  push(fields, "Pages", pages, "Statistics");
  const words = /\\nofwords(\d+)/.exec(text)?.[1];
  push(fields, "Words", words, "Statistics");
  if (/\\objdata|\\objemb/.test(text)) {
    push(fields, "Embedded objects", "present", "Document", true);
  }
  return { fields };
}

// ── Email (.eml) ─────────────────────────────────────────────────────────────

const MAIL_HEADERS: { header: string; label: string; sensitive?: boolean }[] = [
  { header: "From", label: "From", sensitive: true },
  { header: "To", label: "To", sensitive: true },
  { header: "Cc", label: "Cc", sensitive: true },
  { header: "Reply-To", label: "Reply to", sensitive: true },
  { header: "Return-Path", label: "Return path", sensitive: true },
  { header: "Subject", label: "Subject" },
  { header: "Date", label: "Sent", sensitive: true },
  { header: "Message-ID", label: "Message id", sensitive: true },
  { header: "In-Reply-To", label: "In reply to" },
  { header: "X-Mailer", label: "Mail client", sensitive: true },
  { header: "User-Agent", label: "Mail client", sensitive: true },
  { header: "X-Originating-IP", label: "Originating IP", sensitive: true },
  { header: "Content-Type", label: "Content type" },
];

/** One unfolded header value: continuation lines begin with whitespace. */
function mailHeader(text: string, name: string): string | null {
  const m = new RegExp(`^${name}:[ \\t]*([^\\r\\n]*(?:\\r?\\n[ \\t][^\\r\\n]*)*)`, "im").exec(text);
  return m ? m[1].replace(/\r?\n[ \t]+/g, " ").trim() || null : null;
}

function extractEmail(text: string): Extraction {
  const fields: MetaField[] = [];
  const head = text.split(/\r?\n\r?\n/)[0];
  const seen = new Set<string>();
  for (const spec of MAIL_HEADERS) {
    if (seen.has(spec.label)) continue;
    const v = mailHeader(head, spec.header);
    if (v === null) continue;
    seen.add(spec.label);
    push(fields, spec.label, v, "Mail", spec.sensitive);
  }
  // Each Received line is one server that handled the message, so the count is
  // the length of the delivery path and the last one is the first sender.
  const received = [...head.matchAll(/^Received:/gim)].length;
  if (received > 0) push(fields, "Delivery hops", String(received), "Mail");
  const dkim = /^DKIM-Signature:[\s\S]*?\bd=([^;\s]+)/im.exec(head)?.[1];
  push(fields, "DKIM signing domain", dkim, "Mail", true);
  const spf = /^Received-SPF:[ \t]*(\w+)/im.exec(head)?.[1];
  push(fields, "SPF result", spf, "Mail");
  const attachments = [...text.matchAll(/filename\s*=\s*"?([^";\r\n]+)/gi)].map((m) => m[1].trim());
  if (attachments.length) push(fields, "Attachments", [...new Set(attachments)].slice(0, 10).join(", "), "Mail", true);
  return { fields };
}

// ── Scripts and plain text ───────────────────────────────────────────────────

function extractScript(text: string): Extraction {
  const fields: MetaField[] = [];
  // Only the first line is the shebang, so the match is bounded to it: a
  // greedy read would swallow the first command as though it were an argument.
  const shebang = /^#!([^\r\n]*)/.exec(text);
  if (shebang) push(fields, "Interpreter", shebang[1], "Text");
  return { fields };
}

const TEXT_KINDS = new Set(["text", "md", "log", "yaml", "yml", "ini", "toml", "srt", "vtt"]);

/**
 * Metadata for a text-shaped file. Returns nothing for a kind this module does
 * not cover, so the orchestrator can fall through.
 */
export function extractText(kind: string, bytes: Uint8Array): Extraction {
  const text = new TextDecoder("utf-8").decode(bytes.subarray(0, MAX_TEXT));
  const shape = textShape(bytes, text);

  let body: Extraction = { fields: [] };
  if (kind === "html") body = extractHtml(text);
  else if (kind === "svg") body = extractSvg(text);
  else if (kind === "xml") body = extractXml(text);
  else if (kind === "json") body = extractJson(text);
  else if (kind === "csv") body = extractDelimited(text, ",", "comma");
  else if (kind === "tsv") body = extractDelimited(text, "\t", "tab");
  else if (kind === "rtf") body = extractRtf(text);
  else if (kind === "eml") body = extractEmail(text);
  else if (kind === "script") body = extractScript(text);
  else if (!TEXT_KINDS.has(kind)) return { fields: [] };

  return { fields: [...body.fields, ...shape], notes: body.notes };
}
