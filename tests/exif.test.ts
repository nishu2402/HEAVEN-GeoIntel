import { describe, it, expect } from "vitest";
import {
  parseExif, sniffFormat, formatDms, decimalPair, mapLinks, reverseImageLinks,
  type ImageMeta,
} from "@/lib/analysis/exif";
import { buildTiff, buildJpeg, buildPng } from "./exifFixtures";

// The fixtures in ./exifFixtures build JPEG/PNG/TIFF byte-by-byte, so the parser
// is proven against a layout we control, in both endiannesses.

// ── sniffFormat ──────────────────────────────────────────────────────────────

describe("sniffFormat", () => {
  it("recognises JPEG, PNG and rejects the rest", () => {
    expect(sniffFormat(new Uint8Array([0xff, 0xd8, 0xff, 0x00]))).toBe("jpeg");
    expect(sniffFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png");
    expect(sniffFormat(new Uint8Array([0x47, 0x49, 0x46]))).toBe("unknown");
    expect(sniffFormat(new Uint8Array([]))).toBe("unknown");
    expect(sniffFormat(new Uint8Array([0x89, 0x50]))).toBe("unknown"); // too short for PNG
  });
});

// ── Full JPEG EXIF + GPS, little-endian ──────────────────────────────────────

describe("parseExif: JPEG with full EXIF + GPS (little-endian)", () => {
  const tiff = buildTiff({
    le: true,
    ifd0: [
      { tag: 0x010f, type: 2, ascii: "Canon" },
      { tag: 0x0110, type: 2, ascii: "Canon EOS R5" },
      { tag: 0x0131, type: 2, ascii: "v1" },                 // <=4 bytes → inline ASCII
      { tag: 0x0132, type: 2, ascii: "2020:01:01 00:00:00" },
      { tag: 0x0112, type: 3, ints: [6] },                   // orientation SHORT (u16 path)
      { tag: 0x013b, type: 2, ascii: "Ansel" },              // Artist: unhandled → default arm
    ],
    exif: [
      { tag: 0x9286, type: 2, ascii: "hi" },                 // UserComment: unhandled → default arm
      { tag: 0x9003, type: 2, ascii: "2023:10:04 12:34:56" }, // DateTimeOriginal overrides
      { tag: 0xa434, type: 2, ascii: "RF 24-70mm F2.8" },
      { tag: 0x829d, type: 5, rationals: [[28, 10]] },        // f/2.8
      { tag: 0x829a, type: 5, rationals: [[1, 250]] },        // 1/250s
      { tag: 0x8827, type: 4, ints: [400] },                  // ISO as LONG (u32 path)
      { tag: 0x920a, type: 10, rationals: [[50, 1]] },        // focal length SRATIONAL
    ],
    gps: [
      { tag: 0x01, type: 2, ascii: "N" },
      { tag: 0x02, type: 5, rationals: [[40, 1], [26, 1], [46, 1]] }, // 40°26'46"
      { tag: 0x03, type: 2, ascii: "W" },
      { tag: 0x04, type: 5, rationals: [[79, 1], [58, 1], [56, 1]] },
      { tag: 0x05, type: 3, ints: [0] },                      // above sea level
      { tag: 0x06, type: 5, rationals: [[100, 1]] },          // 100m
      { tag: 0x11, type: 5, rationals: [[215, 1]] },          // direction 215°
      { tag: 0x1b, type: 2, ascii: "GPS" },                   // ProcessingMethod: unhandled → default arm
    ],
  });
  const meta = parseExif(buildJpeg({ tiff, sof: { w: 8192, h: 5464 }, extraApp1: true }));

  it("reads geometry from the SOF marker", () => {
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(8192);
    expect(meta.height).toBe(5464);
  });

  it("reads camera + capture tags, DateTimeOriginal winning over DateTime", () => {
    expect(meta.hasExif).toBe(true);
    expect(meta.tags.make).toBe("Canon");
    expect(meta.tags.model).toBe("Canon EOS R5");
    expect(meta.tags.software).toBe("v1");
    expect(meta.tags.lens).toBe("RF 24-70mm F2.8");
    expect(meta.tags.orientation).toBe(6);
    expect(meta.tags.dateTimeOriginal).toBe("2023-10-04 12:34:56");
    expect(meta.tags.fNumber).toBeCloseTo(2.8, 5);
    expect(meta.tags.exposureTime).toBe("1/250s");
    expect(meta.tags.iso).toBe(400);
    expect(meta.tags.focalLength).toBe(50);
  });

  it("recovers the GPS fix with hemisphere signs, altitude and direction", () => {
    expect(meta.gps).not.toBeNull();
    expect(meta.gps!.latitude).toBeCloseTo(40.446111, 4);
    expect(meta.gps!.longitude).toBeCloseTo(-79.982222, 4); // W → negative
    expect(meta.gps!.altitude).toBe(100);
    expect(meta.gps!.direction).toBe(215);
  });
});

// ── Big-endian, southern/below-sea, empty DateTimeOriginal fallback ──────────

describe("parseExif: big-endian, S hemisphere, below sea level", () => {
  const tiff = buildTiff({
    le: false,
    ifd0: [
      { tag: 0x0132, type: 2, ascii: "2019:05:05 09:00:00" },
    ],
    exif: [
      { tag: 0x9003, type: 2, ascii: "" },  // empty → keep IFD0 DateTime
    ],
    gps: [
      { tag: 0x01, type: 2, ascii: "S" },
      { tag: 0x02, type: 5, rationals: [[33, 1], [51, 1], [0, 1]] },
      { tag: 0x03, type: 2, ascii: "E" },
      { tag: 0x04, type: 5, rationals: [[151, 1], [12, 1], [0, 1]] },
      { tag: 0x05, type: 3, ints: [1] },              // below sea level
      { tag: 0x06, type: 5, rationals: [[5, 1]] },
    ],
  });
  const meta = parseExif(buildJpeg({ tiff }));

  it("keeps the IFD0 DateTime when DateTimeOriginal is blank", () => {
    expect(meta.tags.dateTimeOriginal).toBe("2019-05-05 09:00:00");
  });

  it("applies S/E signs and negative altitude", () => {
    expect(meta.gps!.latitude).toBeCloseTo(-33.85, 3);
    expect(meta.gps!.longitude).toBeCloseTo(151.2, 3);
    expect(meta.gps!.altitude).toBe(-5);
    expect(meta.gps!.direction).toBeNull(); // not recorded
  });
});

// ── GPS rejection paths (no false coordinate) ────────────────────────────────

describe("parseExif: GPS is rejected rather than faked", () => {
  it("drops an out-of-range coordinate", () => {
    const tiff = buildTiff({
      le: true,
      ifd0: [{ tag: 0x010f, type: 2, ascii: "Test" }],
      gps: [
        { tag: 0x01, type: 2, ascii: "N" },
        { tag: 0x02, type: 5, rationals: [[200, 1], [0, 1], [0, 1]] }, // 200°: impossible
        { tag: 0x03, type: 2, ascii: "E" },
        { tag: 0x04, type: 5, rationals: [[10, 1], [0, 1], [0, 1]] },
      ],
    });
    const meta = parseExif(buildJpeg({ tiff }));
    expect(meta.hasExif).toBe(true);
    expect(meta.gps).toBeNull();
  });

  it("drops GPS when a rational has a zero denominator", () => {
    const tiff = buildTiff({
      le: true,
      ifd0: [{ tag: 0x010f, type: 2, ascii: "Test" }],
      gps: [
        { tag: 0x01, type: 2, ascii: "N" },
        { tag: 0x02, type: 5, rationals: [[40, 0], [0, 1], [0, 1]] }, // divide by zero
        { tag: 0x03, type: 2, ascii: "E" },
        { tag: 0x04, type: 5, rationals: [[10, 1], [0, 1], [0, 1]] },
      ],
    });
    expect(parseExif(buildJpeg({ tiff })).gps).toBeNull();
  });
});

// ── Type edge cases: unknown type, BYTE altitude ref ─────────────────────────

describe("parseExif: tolerant of unusual field types", () => {
  it("returns null for an ASCII tag with an unknown TIFF type", () => {
    const tiff = buildTiff({
      le: true,
      ifd0: [
        { tag: 0x010f, type: 2, ascii: "Nikon" },
        { tag: 0x0131, type: 99 as unknown as 4, ints: [1] }, // unknown type → size 0
      ],
    });
    const meta = parseExif(buildJpeg({ tiff }));
    expect(meta.tags.make).toBe("Nikon");
    expect(meta.tags.software).toBeNull(); // TYPE_SIZE?? 0 → ascii returns null
  });

  it("normalizes a date-only DateTime and passes through an unparseable one", () => {
    const dt = (s: string) => parseExif(buildJpeg({
      tiff: buildTiff({ le: true, ifd0: [{ tag: 0x0132, type: 2, ascii: s }] }),
    })).tags.dateTimeOriginal;
    expect(dt("2021:07:04")).toBe("2021-07-04");      // no time component (m[4] undefined)
    expect(dt("sometime last year")).toBe("sometime last year"); // no match → passthrough
  });

  it("formats exposure across the sub-second boundary and rejects nonsense", () => {
    const mk = (rat: [number, number]) => parseExif(buildJpeg({
      tiff: buildTiff({ le: true, ifd0: [{ tag: 0x010f, type: 2, ascii: "X" }], exif: [{ tag: 0x829a, type: 5, rationals: [rat] }] }),
    })).tags.exposureTime;
    expect(mk([1, 250])).toBe("1/250s"); // sub-second
    expect(mk([2, 1])).toBe("2s");        // ≥ 1 second
    expect(mk([0, 1])).toBeNull();        // zero → rejected
    expect(mk([1, 0])).toBeNull();        // divide-by-zero rational → null
  });

  it("treats a BYTE altitude ref as above-sea (int() returns null → default 0)", () => {
    const tiff = buildTiff({
      le: true,
      ifd0: [{ tag: 0x010f, type: 2, ascii: "Test" }],
      gps: [
        { tag: 0x01, type: 2, ascii: "N" },
        { tag: 0x02, type: 5, rationals: [[10, 1], [0, 1], [0, 1]] },
        { tag: 0x03, type: 2, ascii: "E" },
        { tag: 0x04, type: 5, rationals: [[20, 1], [0, 1], [0, 1]] },
        { tag: 0x05, type: 1, ints: [1] }, // BYTE altitude ref: int() → null → default above-sea
        { tag: 0x06, type: 5, rationals: [[7, 1]] },
      ],
    });
    const meta = parseExif(buildJpeg({ tiff }));
    expect(meta.gps!.altitude).toBe(7); // stays positive because ref read as 0
  });
});

// ── Malformed / hostile inputs never throw ───────────────────────────────────

describe("parseExif: degrades honestly on bad input", () => {
  it("unknown format yields an empty result", () => {
    const meta = parseExif(new Uint8Array([0x00, 0x01, 0x02, 0x03]));
    expect(meta).toEqual<ImageMeta>({
      format: "unknown", width: null, height: null, hasExif: false, gps: null,
      tags: { make: null, model: null, lens: null, software: null, dateTimeOriginal: null, orientation: null, fNumber: null, exposureTime: null, iso: null, focalLength: null },
    });
  });

  it("JPEG with no APP1 has geometry but no EXIF", () => {
    const meta = parseExif(buildJpeg({ sof: { w: 640, h: 480 } }));
    expect(meta.hasExif).toBe(false);
    expect(meta.width).toBe(640);
  });

  it("JPEG with a garbage TIFF header inside APP1 finds no EXIF", () => {
    const meta = parseExif(buildJpeg({ tiff: [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00] }));
    expect(meta.hasExif).toBe(false);
  });

  it("JPEG with a bad TIFF magic (not 42) finds no EXIF", () => {
    const meta = parseExif(buildJpeg({ tiff: [0x49, 0x49, 0x99, 0x00, 0x08, 0x00, 0x00, 0x00] }));
    expect(meta.hasExif).toBe(false);
  });

  it("JPEG whose TIFF header runs off the end of the buffer finds no EXIF", () => {
    const meta = parseExif(buildJpeg({ tiff: [0x49, 0x49] })); // fewer than 8 bytes past base
    expect(meta.hasExif).toBe(false);
  });

  it("PNG with a garbage eXIf chunk finds no EXIF", () => {
    const meta = parseExif(buildPng({ w: 10, h: 10, tiff: [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00] }));
    expect(meta.format).toBe("png");
    expect(meta.hasExif).toBe(false);
  });

  it("a truncated EXIF block drops sub-IFDs without throwing", () => {
    const tiff = buildTiff({
      le: true,
      ifd0: [{ tag: 0x010f, type: 2, ascii: "Sony" }],
      gps: [
        { tag: 0x02, type: 5, rationals: [[10, 1], [0, 1], [0, 1]] },
        { tag: 0x04, type: 5, rationals: [[20, 1], [0, 1], [0, 1]] },
      ],
    });
    const jpeg = buildJpeg({ tiff });
    // Cut the file so the GPS pointer now aims past the end of the buffer.
    const cut = jpeg.slice(0, jpeg.length - 40);
    expect(() => parseExif(cut)).not.toThrow();
  });

  it("a JPEG segment with an impossible length stops the scan", () => {
    // SOI, then an APP2 claiming length 1 (illegal, <2) → jpegExifOffset bails.
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe2, 0x00, 0x01, 0x00, 0x00]);
    const meta = parseExif(bytes);
    expect(meta.hasExif).toBe(false);
  });

  it("stops reading dimensions at a segment with an impossible length", () => {
    // Long enough to enter the SOF loop, then an APP2 claiming length 1 (<2).
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe2, 0x00, 0x01, 0, 0, 0, 0, 0, 0, 0]);
    expect(parseExif(bytes).width).toBeNull();
  });

  it("skips a stray non-marker byte while hunting for the SOF", () => {
    // FFD8 FFD0(standalone) 0x00(stray) FFC0(SOF, 20×10) FFD9
    const bytes = new Uint8Array([
      0xff, 0xd8, 0xff, 0xd0, 0x00,
      0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x0a, 0x00, 0x14, 0x01, 0x01, 0x11, 0x00,
      0xff, 0xd9,
    ]);
    const meta = parseExif(bytes);
    expect(meta.width).toBe(20);
    expect(meta.height).toBe(10);
  });

  const truncFixture = buildJpeg({
    tiff: buildTiff({
      le: true,
      ifd0: [{ tag: 0x010f, type: 2, ascii: "Sony" }], // 5 bytes → out-of-line ASCII
      gps: [
        { tag: 0x02, type: 5, rationals: [[10, 1], [0, 1], [0, 1]] },
        { tag: 0x04, type: 5, rationals: [[20, 1], [0, 1], [0, 1]] },
      ],
    }),
  });

  it("breaks mid-IFD when an entry runs off a truncated buffer", () => {
    const meta = parseExif(truncFixture.slice(0, 44));
    expect(meta.hasExif).toBe(true);
    expect(meta.gps).toBeNull();
  });

  it("drops a sub-IFD pointer and an ASCII value that point past the buffer", () => {
    const meta = parseExif(truncFixture.slice(0, 50));
    expect(meta.hasExif).toBe(true);
    expect(meta.tags.make).toBeNull(); // ASCII offset is past the end → null, not a throw
    expect(meta.gps).toBeNull();       // GPS IFD offset is past the end → no entries
  });
});

// ── PNG ──────────────────────────────────────────────────────────────────────

describe("parseExif: PNG", () => {
  it("reads IHDR geometry and an eXIf chunk", () => {
    const tiff = buildTiff({
      le: true,
      ifd0: [{ tag: 0x0110, type: 2, ascii: "Pixel 8 Pro" }],
      gps: [
        { tag: 0x01, type: 2, ascii: "N" },
        { tag: 0x02, type: 5, rationals: [[51, 1], [30, 1], [0, 1]] },
        { tag: 0x03, type: 2, ascii: "W" },
        { tag: 0x04, type: 5, rationals: [[0, 1], [7, 1], [0, 1]] },
      ],
    });
    const meta = parseExif(buildPng({ w: 4032, h: 3024, tiff }));
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(4032);
    expect(meta.height).toBe(3024);
    expect(meta.tags.model).toBe("Pixel 8 Pro");
    expect(meta.gps!.latitude).toBeCloseTo(51.5, 3);
    expect(meta.gps!.longitude).toBeCloseTo(-0.116667, 4);
  });

  it("reads geometry from a PNG with no eXIf chunk", () => {
    const meta = parseExif(buildPng({ w: 100, h: 200 }));
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(200);
    expect(meta.hasExif).toBe(false);
  });
});

// ── Pure formatting helpers ──────────────────────────────────────────────────

describe("coordinate + pivot formatting", () => {
  it("formats DMS for every hemisphere", () => {
    expect(formatDms(40.446111, "lat")).toBe(`40°26'46.0"N`);
    expect(formatDms(-33.85, "lat")).toBe(`33°51'0.0"S`);
    expect(formatDms(151.2, "lon")).toBe(`151°12'0.0"E`);   // seconds carry to minutes
    expect(formatDms(-0.116667, "lon")).toBe(`0°7'0.0"W`);
    expect(formatDms(9.9999999, "lat")).toBe(`10°0'0.0"N`); // minutes carry to degrees
  });

  it("emits a copy-paste decimal pair", () => {
    expect(decimalPair({ latitude: 40.446111, longitude: -79.982222, altitude: null, direction: null }))
      .toBe("40.446111, -79.982222");
  });

  it("builds map + reverse-image launchers", () => {
    const maps = mapLinks({ latitude: 1.5, longitude: 2.5, altitude: null, direction: null });
    expect(maps).toHaveLength(4);
    expect(maps[0].url).toContain("mlat=1.5");
    expect(maps[1].url).toContain("q=1.5,2.5");
    const rev = reverseImageLinks();
    expect(rev.map((r) => r.label)).toContain("Yandex Images");
    expect(rev.every((r) => r.url.startsWith("https://"))).toBe(true);
  });
});
