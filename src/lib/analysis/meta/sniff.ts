// ── Content-based file identification ────────────────────────────────────────
//
// What a file *is* has nothing to do with its name. This module answers "what
// are these bytes" from the bytes alone: a magic-signature catalogue spanning
// images, video, audio, documents, archives, executables, fonts, databases and
// disk images, plus dedicated logic for the container formats whose real
// identity is one level down — ISO base media (HEIC vs MP4 vs MOV), ZIP (a plain
// archive vs a DOCX vs an EPUB), RIFF (WebP vs WAV vs AVI) and EBML (MKV vs
// WebM). Anything textual is sub-typed from its leading bytes. The point is that
// every file gets an honest identity, so even a format the engine cannot deeply
// parse is still named correctly rather than dumped as "unknown".

import { Reader, asciiBytes } from "./bytes";
import type { FileCategory, FileIdentity } from "./types";

interface Signature {
  kind: string;
  label: string;
  category: FileCategory;
  mime: string;
  ext: string;
  offset: number;
  magic: number[];
}

const S = (
  kind: string, label: string, category: FileCategory, mime: string, ext: string,
  magic: number[], offset = 0,
): Signature => ({ kind, label, category, mime, ext, offset, magic });

// Ordered most-specific first; the first whose magic matches wins. Container and
// text formats are handled separately (see `sniff`), so they are absent here.
const SIGNATURES: Signature[] = [
  // Images
  S("png", "PNG image", "image", "image/png", "png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  S("jpeg", "JPEG image", "image", "image/jpeg", "jpg", [0xff, 0xd8, 0xff]),
  S("gif", "GIF image", "image", "image/gif", "gif", asciiBytes("GIF87a")),
  S("gif", "GIF image", "image", "image/gif", "gif", asciiBytes("GIF89a")),
  S("bmp", "BMP image", "image", "image/bmp", "bmp", asciiBytes("BM")),
  S("psd", "Photoshop document", "image", "image/vnd.adobe.photoshop", "psd", asciiBytes("8BPS")),
  S("ico", "Windows icon", "image", "image/x-icon", "ico", [0x00, 0x00, 0x01, 0x00]),
  S("cur", "Windows cursor", "image", "image/x-icon", "cur", [0x00, 0x00, 0x02, 0x00]),
  S("jxl", "JPEG XL image", "image", "image/jxl", "jxl", [0xff, 0x0a]),
  S("jxl", "JPEG XL image", "image", "image/jxl", "jxl", [0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20]),
  S("jp2", "JPEG 2000 image", "image", "image/jp2", "jp2", [0x00, 0x00, 0x00, 0x0c, 0x6a, 0x50, 0x20, 0x20]),
  // TIFF (and the raw-camera formats built on it). Endianness both ways.
  S("tiff", "TIFF image", "image", "image/tiff", "tif", [0x49, 0x49, 0x2a, 0x00]),
  S("tiff", "TIFF image", "image", "image/tiff", "tif", [0x4d, 0x4d, 0x00, 0x2a]),

  // Audio
  S("flac", "FLAC audio", "audio", "audio/flac", "flac", asciiBytes("fLaC")),
  S("mp3", "MP3 audio", "audio", "audio/mpeg", "mp3", asciiBytes("ID3")),
  S("midi", "MIDI sequence", "audio", "audio/midi", "mid", asciiBytes("MThd")),
  S("amr", "AMR audio", "audio", "audio/amr", "amr", asciiBytes("#!AMR")),

  // Video (non-container)
  S("flv", "Flash video", "video", "video/x-flv", "flv", asciiBytes("FLV")),
  S("asf", "ASF / WMV media", "video", "video/x-ms-asf", "wmv", [0x30, 0x26, 0xb2, 0x75]),
  S("mpeg", "MPEG program stream", "video", "video/mpeg", "mpg", [0x00, 0x00, 0x01, 0xba]),
  S("mpeg", "MPEG video", "video", "video/mpeg", "mpg", [0x00, 0x00, 0x01, 0xb3]),

  // Documents
  S("pdf", "PDF document", "document", "application/pdf", "pdf", asciiBytes("%PDF-")),
  S("rtf", "Rich Text document", "document", "application/rtf", "rtf", asciiBytes("{\\rtf")),
  S("ps", "PostScript document", "document", "application/postscript", "ps", asciiBytes("%!PS")),
  S("ole", "Legacy Office document (OLE2)", "document", "application/x-ole-storage", "doc",
    [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  S("chm", "Compiled HTML Help", "document", "application/vnd.ms-htmlhelp", "chm", asciiBytes("ITSF")),

  // Archives / compression
  S("gzip", "GZIP archive", "archive", "application/gzip", "gz", [0x1f, 0x8b]),
  S("bzip2", "BZIP2 archive", "archive", "application/x-bzip2", "bz2", asciiBytes("BZh")),
  S("xz", "XZ archive", "archive", "application/x-xz", "xz", [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]),
  S("zstd", "Zstandard archive", "archive", "application/zstd", "zst", [0x28, 0xb5, 0x2f, 0xfd]),
  S("lz4", "LZ4 archive", "archive", "application/x-lz4", "lz4", [0x04, 0x22, 0x4d, 0x18]),
  S("sevenzip", "7-Zip archive", "archive", "application/x-7z-compressed", "7z",
    [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]),
  S("rar", "RAR archive", "archive", "application/vnd.rar", "rar", [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]),
  S("cab", "Cabinet archive", "archive", "application/vnd.ms-cab-compressed", "cab", asciiBytes("MSCF")),
  S("ar", "Unix ar / Debian package", "archive", "application/x-archive", "ar", asciiBytes("!<arch>")),
  S("rpm", "RPM package", "archive", "application/x-rpm", "rpm", [0xed, 0xab, 0xee, 0xdb]),
  // TAR carries its magic 257 bytes in, at the first file header.
  S("tar", "TAR archive", "archive", "application/x-tar", "tar", asciiBytes("ustar"), 257),

  // Executables / bytecode
  S("elf", "ELF executable", "executable", "application/x-elf", "elf", [0x7f, 0x45, 0x4c, 0x46]),
  S("pe", "Windows executable (PE)", "executable", "application/vnd.microsoft.portable-executable", "exe",
    asciiBytes("MZ")),
  S("macho", "Mach-O executable", "executable", "application/x-mach-binary", "", [0xfe, 0xed, 0xfa, 0xce]),
  S("macho", "Mach-O executable", "executable", "application/x-mach-binary", "", [0xce, 0xfa, 0xed, 0xfe]),
  S("macho", "Mach-O executable", "executable", "application/x-mach-binary", "", [0xfe, 0xed, 0xfa, 0xcf]),
  S("macho", "Mach-O executable", "executable", "application/x-mach-binary", "", [0xcf, 0xfa, 0xed, 0xfe]),
  S("class", "Java class file", "executable", "application/java-vm", "class", [0xca, 0xfe, 0xba, 0xbe]),
  S("wasm", "WebAssembly module", "executable", "application/wasm", "wasm", [0x00, 0x61, 0x73, 0x6d]),

  // Fonts
  S("woff2", "WOFF2 font", "font", "font/woff2", "woff2", asciiBytes("wOF2")),
  S("woff", "WOFF font", "font", "font/woff", "woff", asciiBytes("wOFF")),
  S("otf", "OpenType font", "font", "font/otf", "otf", asciiBytes("OTTO")),
  S("ttc", "TrueType collection", "font", "font/collection", "ttc", asciiBytes("ttcf")),
  S("ttf", "TrueType font", "font", "font/ttf", "ttf", [0x00, 0x01, 0x00, 0x00]),

  // Databases
  S("sqlite", "SQLite database", "database", "application/vnd.sqlite3", "sqlite", asciiBytes("SQLite format 3\0")),
  S("mdb", "Microsoft Access database", "database", "application/x-msaccess", "mdb", asciiBytes("Standard Jet DB"), 4),
  S("mdb", "Microsoft Access database", "database", "application/x-msaccess", "accdb", asciiBytes("Standard ACE DB"), 4),

  // Captures / other binary data
  S("pcap", "Packet capture (pcap)", "data", "application/vnd.tcpdump.pcap", "pcap", [0xd4, 0xc3, 0xb2, 0xa1]),
  S("pcap", "Packet capture (pcap)", "data", "application/vnd.tcpdump.pcap", "pcap", [0xa1, 0xb2, 0xc3, 0xd4]),
  S("pcapng", "Packet capture (pcapng)", "data", "application/x-pcapng", "pcapng", [0x0a, 0x0d, 0x0d, 0x0a]),
];

const UNKNOWN: FileIdentity = {
  kind: "unknown", label: "Unknown / unrecognized", category: "unknown",
  mime: "application/octet-stream", ext: "",
};

const id = (
  kind: string, label: string, category: FileCategory, mime: string, ext: string,
): FileIdentity => ({ kind, label, category, mime, ext });

/** ISO base media: the 4CC brand at offset 8 decides the real format. */
function sniffIsoBmff(r: Reader): FileIdentity | null {
  if (!r.eq(4, asciiBytes("ftyp"))) return null;
  const brand = r.ascii(8, 4);
  if (!brand) return null;
  const b = brand.toLowerCase();
  if (b.startsWith("heic") || b.startsWith("heix") || b === "mif1" || b === "heim" || b === "heis")
    return id("heic", "HEIC image", "image", "image/heic", "heic");
  if (b.startsWith("avif")) return id("avif", "AVIF image", "image", "image/avif", "avif");
  if (b.startsWith("avis")) return id("avif", "AVIF image sequence", "image", "image/avif", "avifs");
  if (b === "qt") return id("mov", "QuickTime video", "video", "video/quicktime", "mov");
  if (b === "m4a" || b === "m4b") return id("m4a", "MPEG-4 audio", "audio", "audio/mp4", "m4a");
  if (b === "m4v") return id("mp4", "MPEG-4 video", "video", "video/mp4", "m4v");
  if (b.startsWith("3g")) return id("3gp", "3GPP media", "video", "video/3gpp", "3gp");
  // isom, mp41, mp42, dash, and other MP4 brands.
  return id("mp4", "MPEG-4 video", "video", "video/mp4", "mp4");
}

/** RIFF: the form type at offset 8 separates WebP, WAV and AVI. */
function sniffRiff(r: Reader): FileIdentity | null {
  if (!r.eq(0, asciiBytes("RIFF"))) return null;
  const form = r.ascii(8, 4);
  if (form === "WEBP") return id("webp", "WebP image", "image", "image/webp", "webp");
  if (form === "WAVE") return id("wav", "WAV audio", "audio", "audio/wav", "wav");
  if (form === "AVI") return id("avi", "AVI video", "video", "video/x-msvideo", "avi");
  return id("riff", "RIFF container", "data", "application/octet-stream", "");
}

/** AIFF and other "FORM"-tagged IFF containers. */
function sniffIff(r: Reader): FileIdentity | null {
  if (!r.eq(0, asciiBytes("FORM"))) return null;
  const form = r.ascii(8, 4);
  if (form === "AIFF" || form === "AIFC") return id("aiff", "AIFF audio", "audio", "audio/aiff", "aiff");
  return id("iff", "IFF container", "data", "application/octet-stream", "");
}

/** OGG carries Vorbis, Opus, FLAC or Theora; the codec ID sits in the first page. */
function sniffOgg(r: Reader): FileIdentity | null {
  if (!r.eq(0, asciiBytes("OggS"))) return null;
  // Codec signature begins at byte 28 of the first page (after the 27-byte page
  // header + 1 segment-count byte's table, which for the first page is one entry).
  const head = r.ascii(29, 6) ?? "";
  if (head.includes("vorbis")) return id("ogg", "OGG Vorbis audio", "audio", "audio/ogg", "ogg");
  if (r.ascii(28, 4) === "Opus") return id("opus", "Opus audio", "audio", "audio/ogg", "opus");
  if (r.ascii(29, 4) === "FLAC") return id("oggflac", "OGG FLAC audio", "audio", "audio/ogg", "oga");
  if (r.ascii(29, 6) === "theora") return id("ogv", "OGG Theora video", "video", "video/ogg", "ogv");
  return id("ogg", "OGG media", "audio", "audio/ogg", "ogg");
}

/** EBML: MKV and WebM share a signature and differ only by DocType. */
function sniffEbml(r: Reader): FileIdentity | null {
  if (!r.eq(0, [0x1a, 0x45, 0xdf, 0xa3])) return null;
  // DocType is a short string within the EBML header; scan the first 64 bytes.
  // The signature match guarantees at least four bytes, so this span is always
  // in range — read it straight off the buffer.
  const s = new TextDecoder("latin1").decode(r.bytes.subarray(0, Math.min(64, r.length)));
  if (s.includes("webm")) return id("webm", "WebM video", "video", "video/webm", "webm");
  return id("mkv", "Matroska video", "video", "video/x-matroska", "mkv");
}

/** ISO 9660 optical image: the "CD001" descriptor sits at 0x8001. */
function sniffIso9660(r: Reader): FileIdentity | null {
  if (r.length >= 0x8006 && r.eq(0x8001, asciiBytes("CD001")))
    return id("iso", "ISO 9660 disk image", "disk-image", "application/x-iso9660-image", "iso");
  return null;
}

/**
 * ZIP-based formats. The bytes start with the local-file-header magic, but the
 * real identity is decided by which member names appear inside. A bounded scan
 * for the tell-tale entries is enough and avoids a full central-directory parse.
 */
function sniffZip(r: Reader): FileIdentity | null {
  // PK\x03\x04 (local header), PK\x05\x06 (empty archive) or PK\x07\x08 (spanned).
  const pk = r.eq(0, [0x50, 0x4b, 0x03, 0x04]) || r.eq(0, [0x50, 0x4b, 0x05, 0x06]) || r.eq(0, [0x50, 0x4b, 0x07, 0x08]);
  if (!pk) return null;

  // EPUB and ODF stamp their MIME type as the first, stored (uncompressed) entry
  // right after the local header, so it is legible without inflating anything.
  // subarray clamps to the buffer end, so a short file simply yields a short string.
  const early = new TextDecoder("latin1").decode(r.bytes.subarray(30, 90));
  if (early.startsWith("mimetypeapplication/epub+zip"))
    return id("epub", "EPUB e-book", "document", "application/epub+zip", "epub");
  if (early.startsWith("mimetypeapplication/vnd.oasis.opendocument.text"))
    return id("odt", "OpenDocument text", "document", "application/vnd.oasis.opendocument.text", "odt");
  if (early.startsWith("mimetypeapplication/vnd.oasis.opendocument.spreadsheet"))
    return id("ods", "OpenDocument spreadsheet", "document", "application/vnd.oasis.opendocument.spreadsheet", "ods");
  if (early.startsWith("mimetypeapplication/vnd.oasis.opendocument.presentation"))
    return id("odp", "OpenDocument presentation", "document", "application/vnd.oasis.opendocument.presentation", "odp");

  // OOXML and other zip payloads: look for characteristic member paths anywhere.
  const has = (s: string) => r.indexOf(asciiBytes(s)) !== -1;
  if (has("word/document.xml"))
    return id("docx", "Word document", "document", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx");
  if (has("xl/workbook.xml"))
    return id("xlsx", "Excel workbook", "document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx");
  if (has("ppt/presentation.xml"))
    return id("pptx", "PowerPoint presentation", "document", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx");
  if (has("AndroidManifest.xml"))
    return id("apk", "Android package", "archive", "application/vnd.android.package-archive", "apk");
  if (has("META-INF/MANIFEST.MF"))
    return id("jar", "Java archive", "archive", "application/java-archive", "jar");
  return id("zip", "ZIP archive", "archive", "application/zip", "zip");
}

/** A byte is "text" if it is a common control char or a printable/UTF-8 byte. */
function textualRatio(bytes: Uint8Array): number {
  // The only caller runs after `sniff` has returned early for an empty file, so
  // `bytes` is always non-empty and `n` is at least 1.
  const n = Math.min(bytes.length, 4096);
  let printable = 0;
  for (let i = 0; i < n; i++) {
    const c = bytes[i];
    if (c === 0x09 || c === 0x0a || c === 0x0d || (c >= 0x20 && c < 0x7f) || c >= 0x80) printable++;
  }
  return printable / n;
}

const TEXT_EXT: Record<string, { label: string; mime: string }> = {
  csv: { label: "CSV data", mime: "text/csv" },
  tsv: { label: "TSV data", mime: "text/tab-separated-values" },
  md: { label: "Markdown document", mime: "text/markdown" },
  yaml: { label: "YAML document", mime: "application/yaml" },
  yml: { label: "YAML document", mime: "application/yaml" },
  ini: { label: "INI configuration", mime: "text/plain" },
  toml: { label: "TOML configuration", mime: "application/toml" },
  log: { label: "Log file", mime: "text/plain" },
  srt: { label: "SubRip subtitles", mime: "application/x-subrip" },
  vtt: { label: "WebVTT subtitles", mime: "text/vtt" },
};

/** Classify a file the binary catalogue did not claim but that reads as text. */
function sniffText(bytes: Uint8Array, ext: string): FileIdentity | null {
  if (textualRatio(bytes) < 0.9) return null;
  const head = new TextDecoder("utf-8").decode(bytes.subarray(0, 512)).trimStart();
  const lower = head.toLowerCase();
  if (lower.startsWith("<!doctype html") || lower.startsWith("<html"))
    return id("html", "HTML document", "document", "text/html", "html");
  if (head.startsWith("<")) {
    // An SVG is XML, but it is an image first; everything else angle-bracketed
    // (including a leading "<?xml" declaration) is reported as generic XML.
    if (lower.includes("<svg")) return id("svg", "SVG image", "image", "image/svg+xml", "svg");
    return id("xml", "XML document", "text", "application/xml", "xml");
  }
  if (head.startsWith("{") || head.startsWith("[")) return id("json", "JSON data", "text", "application/json", "json");
  if (head.startsWith("#!")) return id("script", "Shell / interpreter script", "text", "text/x-shellscript", "sh");
  const known = TEXT_EXT[ext];
  if (known) return id(ext, known.label, "text", known.mime, ext);
  return id("text", "Plain text", "text", "text/plain", "txt");
}

/**
 * Identify a file from its bytes. `filename` is used only to sub-type otherwise
 * indistinguishable plain-text files (CSV vs. log vs. Markdown); it never
 * overrides a binary signature, so a mislabelled file is still identified by
 * what it actually contains.
 */
export function sniff(bytes: Uint8Array, filename = ""): FileIdentity {
  if (bytes.length === 0) return { ...UNKNOWN, kind: "empty", label: "Empty file", category: "data" };
  const r = new Reader(bytes);

  const container =
    sniffIsoBmff(r) ?? sniffRiff(r) ?? sniffIff(r) ?? sniffOgg(r) ??
    sniffEbml(r) ?? sniffZip(r) ?? sniffIso9660(r);
  if (container) return container;

  for (const s of SIGNATURES) {
    if (r.eq(s.offset, s.magic)) return id(s.kind, s.label, s.category, s.mime, s.ext);
  }

  // MP3 without an ID3 tag still starts with an MPEG audio frame sync.
  const b0 = bytes[0], b1 = bytes[1];
  if (b0 === 0xff && b1 !== undefined && (b1 & 0xe0) === 0xe0)
    return id("mp3", "MP3 audio", "audio", "audio/mpeg", "mp3");

  const ext = filenameExt(filename);
  const text = sniffText(bytes, ext);
  if (text) return text;

  return UNKNOWN;
}

/** Lower-cased extension without the dot, or "" when there is none. */
export function filenameExt(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot < 0 || dot === filename.length - 1) return "";
  return filename.slice(dot + 1).toLowerCase();
}

// Extensions that legitimately map to the same content kind, so a JPEG named
// ".jpeg" or a TIFF named ".tif" is not falsely flagged as a mismatch.
const EXT_ALIASES: Record<string, string[]> = {
  jpg: ["jpg", "jpeg", "jpe", "jfif"],
  tif: ["tif", "tiff"],
  html: ["html", "htm"],
  mp4: ["mp4", "m4v"],
  m4a: ["m4a", "m4b", "aac"],
  aiff: ["aiff", "aif", "aifc"],
  mid: ["mid", "midi"],
  sqlite: ["sqlite", "sqlite3", "db"],
  exe: ["exe", "dll", "sys", "ocx"],
  gz: ["gz", "tgz"],
  jxl: ["jxl"],
  txt: ["txt", "text"],
  ps: ["ps", "eps"],
};

/**
 * Compare a filename's extension against the detected content. Returns the pair
 * when they genuinely disagree (a real forensic signal: a `.jpg` that is really
 * a ZIP), or null when they match, when one side is unknown, or when there is no
 * extension to check.
 */
export function extensionMismatch(identity: FileIdentity, filename: string): { claimed: string; actual: string } | null {
  const claimed = filenameExt(filename);
  if (!claimed) return null;
  if (identity.kind === "unknown" || !identity.ext) return null;
  const accepted = EXT_ALIASES[identity.ext] ?? [identity.ext];
  if (accepted.includes(claimed)) return null;
  return { claimed, actual: identity.ext };
}
