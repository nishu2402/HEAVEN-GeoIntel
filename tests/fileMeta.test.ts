import { describe, it, expect } from "vitest";
import { extractFileMeta, hashFile, shannonEntropy } from "@/lib/analysis/meta/fileMeta";
import { asciiBytes } from "@/lib/analysis/meta/bytes";
import { buildJpeg, buildPng, buildTiff, jpegWithGps } from "./exifFixtures";

const A = (s: string) => asciiBytes(s);
const cat = (...p: (number[] | Uint8Array)[]) => new Uint8Array(p.flatMap((x) => Array.from(x)));
const u16le = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u32be = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const u16be = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const fourcc = (s: string) => [...s].map((c) => c.charCodeAt(0));
const box = (type: string, payload: number[]) => [...u32be(8 + payload.length), ...fourcc(type), ...payload];
const ftyp = (brand: string) => box("ftyp", [...fourcc(brand.padEnd(4).slice(0, 4)), ...u32be(0)]);
const field = (m: { fields: { label: string; value: string }[] }, label: string) =>
  m.fields.find((f) => f.label === label)?.value;

describe("meta/fileMeta entropy and hashing", () => {
  it("computes Shannon entropy, zero for uniform bytes and null for empty", () => {
    expect(shannonEntropy(new Uint8Array(0))).toBeNull();
    expect(shannonEntropy(new Uint8Array(64).fill(7))).toBe(0); // one symbol -> 0 bits
    const twoSymbols = new Uint8Array([...new Array(32).fill(0), ...new Array(32).fill(1)]);
    expect(shannonEntropy(twoSymbols)).toBe(1); // even split of two symbols -> 1 bit
  });

  it("produces real SHA-1 and SHA-256 digests", async () => {
    const h = await hashFile(new TextEncoder().encode("abc"));
    expect(h.sha1).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
    expect(h.sha256).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("meta/fileMeta dispatch", () => {
  it("routes a JPEG through the EXIF parser and lifts its GPS", async () => {
    const m = await extractFileMeta(jpegWithGps(), "photo.jpg");
    expect(m.identity.kind).toBe("jpeg");
    expect(m.image?.tags.make).toBe("Apple");
    expect(m.gps?.latitude).toBeGreaterThan(40);
    expect(m.hasDeepMeta).toBe(true);
    expect(m.extMismatch).toBeNull();
  });

  it("routes PNG and raster images, and reports dimensions as informative", async () => {
    const png = await extractFileMeta(buildPng({ w: 800, h: 600 }));
    expect(png.identity.kind).toBe("png");
    expect(png.image?.width).toBe(800);
    expect(png.hasDeepMeta).toBe(true);

    const gif = await extractFileMeta(cat(A("GIF89a"), u16le(320), u16le(240), [0, 0, 0]));
    expect(gif.identity.kind).toBe("gif");
    expect(gif.image?.width).toBe(320);
  });

  it("routes an MP4 (location atom) and a HEIC (image with EXIF)", async () => {
    const mp4 = await extractFileMeta(cat(ftyp("isom"),
      box("moov", box("udta", box("©xyz", [...u16be(14), ...u16be(0), ...A("+37.33-122.03/")])))));
    expect(mp4.identity.kind).toBe("mp4");
    expect(mp4.gps?.latitude).toBeCloseTo(37.33, 2);
    expect(field(mp4, "Brand")).toBe("isom");

    const tiff = buildTiff({ le: true, ifd0: [{ tag: 0x010f, type: 2, ascii: "Canon" }] });
    const ispe = box("ispe", [0, 0, 0, 0, ...u32be(4032), ...u32be(3024)]);
    const heic = await extractFileMeta(cat(ftyp("heic"),
      box("meta", [0, 0, 0, 0, ...box("iprp", box("ipco", ispe)), ...A("Exif\0\0"), ...tiff])));
    expect(heic.identity.kind).toBe("heic");
    expect(heic.image?.width).toBe(4032);
    expect(heic.image?.tags.make).toBe("Canon");
  });

  it("routes PDF, ZIP, audio and archive kinds", async () => {
    const pdf = await extractFileMeta(new TextEncoder().encode("%PDF-1.7 /Author (Nadia)"));
    expect(pdf.identity.kind).toBe("pdf");
    expect(field(pdf, "Author")).toBe("Nadia");

    // A minimal empty ZIP (EOCD only, zero entries).
    const zip = await extractFileMeta(cat([0x50, 0x4b, 0x05, 0x06], new Uint8Array(18)));
    expect(zip.identity.kind).toBe("zip");
    expect(field(zip, "Entries")).toBe("0");

    const frame = cat(A("TIT2"), [0, 0, 0, 4], [0, 0], [0], A("Hey")); // size 4, flags, enc, "Hey"
    const mp3 = await extractFileMeta(cat(A("ID3"), [4, 0, 0], [0, 0, 0, frame.length], frame));
    expect(mp3.identity.kind).toBe("mp3");
    expect(field(mp3, "Title")).toBe("Hey");

    const gz = await extractFileMeta(cat([0x1f, 0x8b, 0x08, 0x08], new Uint8Array(6), A("orig.txt"), [0]));
    expect(gz.identity.kind).toBe("gzip");
    expect(field(gz, "Original filename")).toBe("orig.txt");
  });

  it("flags an extension/content mismatch", async () => {
    const m = await extractFileMeta(buildJpeg({ sof: { w: 10, h: 10 } }), "notreally.png");
    expect(m.extMismatch).toEqual({ claimed: "png", actual: "jpg" });
  });

  it("notes an unidentified file and a recognized-but-bare file", async () => {
    const unknown = await extractFileMeta(new Uint8Array([0x03, 0x04, 0x99, 0xfa, 0x00, 0x01]));
    expect(unknown.identity.kind).toBe("unknown");
    expect(unknown.hasDeepMeta).toBe(false);
    expect(unknown.notes.some((n) => /could not be identified/i.test(n))).toBe(true);

    // WOFF is recognized by signature but this engine parses no fields from it.
    const woff = await extractFileMeta(cat(A("wOFF"), new Uint8Array(40)), "font.woff");
    expect(woff.identity.kind).toBe("woff");
    expect(woff.hasDeepMeta).toBe(false);
    expect(woff.notes.some((n) => /no embedded metadata/i.test(n))).toBe(true);
    expect(woff.entropy).not.toBeNull();
  });
});
