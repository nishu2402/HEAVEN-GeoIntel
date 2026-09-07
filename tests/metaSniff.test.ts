import { describe, it, expect } from "vitest";
import { sniff, filenameExt, extensionMismatch } from "@/lib/analysis/meta/sniff";
import { asciiBytes } from "@/lib/analysis/meta/bytes";

const A = (s: string) => asciiBytes(s);
function cat(...parts: (number[] | Uint8Array)[]): Uint8Array {
  const flat: number[] = [];
  for (const p of parts) flat.push(...Array.from(p));
  return new Uint8Array(flat);
}
const pad = (n: number) => new Array(n).fill(0);
const kindOf = (b: Uint8Array, name = "") => sniff(b, name).kind;

/** An ISO-BMFF header with the given major brand at offset 8. */
function ftyp(brand: string): Uint8Array {
  return cat([0, 0, 0, 0x18], A("ftyp"), A(brand.padEnd(4).slice(0, 4)), pad(12));
}
/** An OGG first page with a codec signature planted at the usual offsets. */
function ogg(sig: number[], at: number): Uint8Array {
  const buf = new Uint8Array(40);
  buf.set(A("OggS"));
  buf.set(sig, at);
  return buf;
}
/** A ZIP header (PK + the two variant bytes) followed by raw bytes at offset 30. */
function zip(b2 = 0x03, b3 = 0x04, tail: number[] = []): Uint8Array {
  return cat([0x50, 0x4b, b2, b3], pad(26), tail);
}

describe("meta/sniff container disambiguation", () => {
  it("resolves ISO base media brands", () => {
    expect(kindOf(ftyp("heic"))).toBe("heic");
    expect(kindOf(ftyp("mif1"))).toBe("heic");
    expect(kindOf(ftyp("avif"))).toBe("avif");
    expect(kindOf(ftyp("avis"))).toBe("avif");
    expect(kindOf(ftyp("qt  "))).toBe("mov");
    expect(kindOf(ftyp("M4A "))).toBe("m4a");
    expect(kindOf(ftyp("M4V "))).toBe("mp4");
    expect(kindOf(ftyp("3gp5"))).toBe("3gp");
    expect(kindOf(ftyp("isom"))).toBe("mp4");
    // "ftyp" present but too short to read a brand -> not ISO-BMFF.
    expect(kindOf(cat([0, 0, 0, 8], A("ftyp")))).toBe("unknown");
  });

  it("resolves RIFF and IFF form types", () => {
    expect(kindOf(cat(A("RIFF"), pad(4), A("WEBP")))).toBe("webp");
    expect(kindOf(cat(A("RIFF"), pad(4), A("WAVE")))).toBe("wav");
    expect(kindOf(cat(A("RIFF"), pad(4), A("AVI ")))).toBe("avi");
    expect(kindOf(cat(A("RIFF"), pad(4), A("ZZZZ")))).toBe("riff");
    expect(kindOf(cat(A("FORM"), pad(4), A("AIFF")))).toBe("aiff");
    expect(kindOf(cat(A("FORM"), pad(4), A("AIFC")))).toBe("aiff");
    expect(kindOf(cat(A("FORM"), pad(4), A("ZZZZ")))).toBe("iff");
  });

  it("resolves OGG codecs and EBML doctypes", () => {
    expect(kindOf(ogg([0x01, ...A("vorbis")], 28))).toBe("ogg");
    expect(kindOf(ogg(A("Opus"), 28))).toBe("opus");
    expect(kindOf(ogg([0x7f, ...A("FLAC")], 28))).toBe("oggflac");
    expect(kindOf(ogg([0x80, ...A("theora")], 28))).toBe("ogv");
    expect(kindOf(ogg([0x99, 0x99], 28))).toBe("ogg");
    expect(kindOf(new Uint8Array(A("OggS")))).toBe("ogg"); // too short for any codec sig
    expect(kindOf(cat([0x1a, 0x45, 0xdf, 0xa3], A("...webm...")))).toBe("webm");
    expect(kindOf(cat([0x1a, 0x45, 0xdf, 0xa3], A("...matroska")))).toBe("mkv");
  });

  it("resolves ZIP-based document and package formats", () => {
    const mime = (m: string) => cat([0x50, 0x4b, 0x03, 0x04], pad(26), A("mimetype"), A(m));
    expect(kindOf(mime("application/epub+zip"))).toBe("epub");
    expect(kindOf(mime("application/vnd.oasis.opendocument.text"))).toBe("odt");
    expect(kindOf(mime("application/vnd.oasis.opendocument.spreadsheet"))).toBe("ods");
    expect(kindOf(mime("application/vnd.oasis.opendocument.presentation"))).toBe("odp");
    expect(kindOf(zip(0x03, 0x04, A("word/document.xml")))).toBe("docx");
    expect(kindOf(zip(0x03, 0x04, A("xl/workbook.xml")))).toBe("xlsx");
    expect(kindOf(zip(0x03, 0x04, A("ppt/presentation.xml")))).toBe("pptx");
    expect(kindOf(zip(0x03, 0x04, A("AndroidManifest.xml")))).toBe("apk");
    expect(kindOf(zip(0x03, 0x04, A("META-INF/MANIFEST.MF")))).toBe("jar");
    expect(kindOf(zip(0x05, 0x06))).toBe("zip"); // empty-archive magic, no members
    expect(kindOf(zip(0x07, 0x08))).toBe("zip"); // spanned-archive magic
  });

  it("resolves an ISO 9660 disk image by its far-offset descriptor", () => {
    const buf = new Uint8Array(0x8006);
    buf.set(A("CD001"), 0x8001);
    expect(sniff(buf).category).toBe("disk-image");
    expect(kindOf(buf)).toBe("iso");
  });
});

describe("meta/sniff magic-signature catalogue", () => {
  const cases: [string, Uint8Array][] = [
    ["png", cat([0x89], A("PNG"), [0x0d, 0x0a, 0x1a, 0x0a])],
    ["jpeg", cat([0xff, 0xd8, 0xff, 0xe0])],
    ["gif", cat(A("GIF87a"))],
    ["gif", cat(A("GIF89a"))],
    ["bmp", cat(A("BM"), pad(20))],
    ["psd", cat(A("8BPS"))],
    ["ico", cat([0, 0, 1, 0])],
    ["cur", cat([0, 0, 2, 0])],
    ["jxl", cat([0xff, 0x0a])],
    ["jxl", cat([0, 0, 0, 0x0c, 0x4a, 0x58, 0x4c, 0x20])],
    ["jp2", cat([0, 0, 0, 0x0c, 0x6a, 0x50, 0x20, 0x20])],
    ["tiff", cat([0x49, 0x49, 0x2a, 0x00])],
    ["tiff", cat([0x4d, 0x4d, 0x00, 0x2a])],
    ["flac", cat(A("fLaC"))],
    ["mp3", cat(A("ID3"), pad(10))],
    ["midi", cat(A("MThd"))],
    ["amr", cat(A("#!AMR"))],
    ["flv", cat(A("FLV"))],
    ["asf", cat([0x30, 0x26, 0xb2, 0x75])],
    ["mpeg", cat([0, 0, 1, 0xba])],
    ["mpeg", cat([0, 0, 1, 0xb3])],
    ["pdf", cat(A("%PDF-1.7"))],
    ["rtf", cat(A("{\\rtf1"))],
    ["ps", cat(A("%!PS-Adobe"))],
    ["ole", cat([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])],
    ["chm", cat(A("ITSF"))],
    ["gzip", cat([0x1f, 0x8b, 0x08])],
    ["bzip2", cat(A("BZh"))],
    ["xz", cat([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])],
    ["zstd", cat([0x28, 0xb5, 0x2f, 0xfd])],
    ["lz4", cat([0x04, 0x22, 0x4d, 0x18])],
    ["sevenzip", cat([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])],
    ["rar", cat([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])],
    ["cab", cat(A("MSCF"))],
    ["ar", cat(A("!<arch>"))],
    ["rpm", cat([0xed, 0xab, 0xee, 0xdb])],
    ["tar", cat(pad(257), A("ustar"))],
    ["elf", cat([0x7f], A("ELF"))],
    ["pe", cat(A("MZ"), pad(20))],
    ["macho", cat([0xfe, 0xed, 0xfa, 0xce])],
    ["macho", cat([0xce, 0xfa, 0xed, 0xfe])],
    ["macho", cat([0xfe, 0xed, 0xfa, 0xcf])],
    ["macho", cat([0xcf, 0xfa, 0xed, 0xfe])],
    ["class", cat([0xca, 0xfe, 0xba, 0xbe])],
    ["wasm", cat([0x00, 0x61, 0x73, 0x6d])],
    ["woff2", cat(A("wOF2"))],
    ["woff", cat(A("wOFF"))],
    ["otf", cat(A("OTTO"))],
    ["ttc", cat(A("ttcf"))],
    ["ttf", cat([0x00, 0x01, 0x00, 0x00])],
    ["sqlite", cat(A("SQLite format 3\0"))],
    ["mdb", cat(pad(4), A("Standard Jet DB"))],
    ["mdb", cat(pad(4), A("Standard ACE DB"))],
    ["pcap", cat([0xd4, 0xc3, 0xb2, 0xa1])],
    ["pcap", cat([0xa1, 0xb2, 0xc3, 0xd4])],
    ["pcapng", cat([0x0a, 0x0d, 0x0d, 0x0a])],
  ];
  it.each(cases)("identifies %s", (kind, bytes) => {
    expect(sniff(bytes).kind).toBe(kind);
  });

  it("identifies a raw MP3 frame with no ID3 tag", () => {
    expect(kindOf(cat([0xff, 0xfb, 0x90, 0x00]))).toBe("mp3");
  });
});

describe("meta/sniff text sub-typing and fallbacks", () => {
  it("classifies textual content by its leading bytes", () => {
    expect(kindOf(new Uint8Array(A("<!DOCTYPE html><html>")))).toBe("html");
    expect(kindOf(new Uint8Array(A("<html>hi</html>")))).toBe("html");
    expect(kindOf(new Uint8Array(A('<?xml version="1.0"?><svg></svg>')))).toBe("svg");
    expect(kindOf(new Uint8Array(A('<?xml version="1.0"?><a/>')))).toBe("xml");
    expect(kindOf(new Uint8Array(A('{"a":1}')))).toBe("json");
    expect(kindOf(new Uint8Array(A("[1,2,3]")))).toBe("json");
    expect(kindOf(new Uint8Array(A("#!/bin/bash\necho hi")))).toBe("script");
  });

  it("uses the filename only to sub-type otherwise-plain text", () => {
    expect(kindOf(new Uint8Array(A("a,b,c\n1,2,3")), "data.csv")).toBe("csv");
    expect(sniff(new Uint8Array(A("# title")), "notes.md").label).toBe("Markdown document");
    expect(kindOf(new Uint8Array(A("hello world")), "readme.txt")).toBe("text");
    expect(kindOf(new Uint8Array(A("plain, no extension")))).toBe("text");
  });

  it("returns 'empty' for a zero-byte file and 'unknown' for opaque binary", () => {
    expect(sniff(new Uint8Array(0)).kind).toBe("empty");
    // Mostly non-printable bytes: not text, not a known signature.
    expect(kindOf(new Uint8Array([0x03, 0x04, 0x05, 0x00, 0x99, 0xfa]))).toBe("unknown");
  });

  it("treats a lone 0xFF byte as text, exercising the frame-sync guard", () => {
    expect(sniff(new Uint8Array([0xff])).category).toBe("text");
  });
});

describe("meta/sniff filename helpers", () => {
  it("extracts a lowercased extension", () => {
    expect(filenameExt("photo.JPG")).toBe("jpg");
    expect(filenameExt("archive.tar.gz")).toBe("gz");
    expect(filenameExt("noextension")).toBe("");
    expect(filenameExt("trailingdot.")).toBe("");
  });

  it("flags a genuine extension/content mismatch and nothing else", () => {
    const png = sniff(cat([0x89], A("PNG"), [0x0d, 0x0a, 0x1a, 0x0a]));
    const docx = sniff(zip(0x03, 0x04, A("word/document.xml")));
    const macho = sniff(cat([0xfe, 0xed, 0xfa, 0xce]));
    const jpeg = sniff(cat([0xff, 0xd8, 0xff, 0xe0]));
    // Match via alias -> no flag.
    expect(extensionMismatch(jpeg, "photo.jpeg")).toBeNull();
    // Exact match -> no flag.
    expect(extensionMismatch(png, "logo.png")).toBeNull();
    // No extension, unknown kind, or blank canonical ext -> no flag.
    expect(extensionMismatch(png, "logo")).toBeNull();
    expect(extensionMismatch(sniff(new Uint8Array([0x03, 0x99])), "x.bin")).toBeNull();
    expect(extensionMismatch(macho, "tool.bin")).toBeNull();
    // Real disagreement -> flagged.
    expect(extensionMismatch(docx, "resume.pdf")).toEqual({ claimed: "pdf", actual: "docx" });
    expect(extensionMismatch(png, "logo.gif")).toEqual({ claimed: "gif", actual: "png" });
  });
});
