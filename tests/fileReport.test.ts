import { describe, it, expect } from "vitest";
import {
  buildFileReport, reportOutline, reportStats, reportToText, reportToMarkdown,
  reportToStixBundle, reportTitle, methodologyFor, provenanceNotice, slug, controlRows,
  FILE_METHODOLOGY, METHODOLOGY,
} from "@/lib/analysis/report";
import { reportToHtml } from "@/lib/analysis/reportHtml";
import { reportToPrintHtml } from "@/lib/analysis/reportPrint";
import type { UniversalMeta } from "@/lib/analysis/meta/types";
import { EMPTY_TAGS } from "@/lib/analysis/exif";

// A file the engine read fully: a phone photo with a coordinate, camera tags
// and format-specific fields spread across several groups.
const photo: UniversalMeta = {
  identity: { kind: "jpeg", label: "JPEG image", category: "image", mime: "image/jpeg", ext: "jpg" },
  size: 3_145_728,
  extMismatch: null,
  fields: [
    { label: "Photographer", value: "Lucia Ferrara", group: "IPTC", sensitive: true },
    { label: "City", value: "Trieste", group: "IPTC", sensitive: true },
    { label: "Encoding", value: "progressive", group: "Image" },
    { label: "Authoring tool", value: "Adobe Lightroom 13.2", group: "XMP", sensitive: true },
    { label: "Camera serial", value: "042917000123", group: "XMP", sensitive: true },
    { label: "Custom group field", value: "kept", group: "Something else" },
  ],
  gps: { latitude: 45.6495, longitude: 13.7768, altitude: 22.5, direction: 271 },
  image: {
    format: "jpeg", width: 4032, height: 3024, hasExif: true,
    gps: { latitude: 45.6495, longitude: 13.7768, altitude: 22.5, direction: 271 },
    tags: {
      ...EMPTY_TAGS, make: "Apple", model: "iPhone 15 Pro", lens: "Main camera",
      software: "17.4.1", dateTimeOriginal: "2024-03-02 10:15:00",
      fNumber: 1.78, exposureTime: "1/120", iso: 64, focalLength: 6.9, orientation: 1,
    },
  },
  entropy: 7.92,
  notes: ["Carries a Multi-Picture block."],
  hasDeepMeta: true,
};

const hashes = { sha1: "a".repeat(40), sha256: "b".repeat(64) };

const model = () => buildFileReport({ meta: photo, fileName: "IMG_4471.jpg", lastModified: "2024-03-02 11:02:19", hashes });

const sectionRows = (m: ReturnType<typeof buildFileReport>, heading: string) =>
  Object.fromEntries((m.sections.find((s) => s.heading === heading)?.rows ?? []).map((r) => [r.label, r.value]));

describe("buildFileReport", () => {
  it("states the file's identity, size, timestamp and entropy", () => {
    const rows = sectionRows(model(), "File");
    expect(rows["Name"]).toBe("IMG_4471.jpg");
    expect(rows["Detected type"]).toBe("JPEG image");
    expect(rows["MIME type"]).toBe("image/jpeg");
    expect(rows["Category"]).toBe("image");
    expect(rows["Size"]).toBe("3.0 MB (3,145,728 bytes)");
    expect(rows["Modified on disk"]).toBe("2024-03-02 11:02:19");
    expect(rows["Extension check"]).toBe("the name matches the contents");
    expect(rows["Entropy"]).toBe("7.92 bits/byte (high, so the contents are likely compressed or encrypted)");
  });

  it("sizes a small file in kilobytes and a tiny one in bytes", () => {
    const kb = buildFileReport({ meta: { ...photo, size: 4096 }, fileName: "small.jpg" });
    expect(sectionRows(kb, "File")["Size"]).toBe("4.0 KB (4,096 bytes)");
    const tiny = buildFileReport({ meta: { ...photo, size: 12 }, fileName: "tiny.jpg" });
    expect(sectionRows(tiny, "File")["Size"]).toBe("12 bytes (12 bytes)");
  });

  it("reads the entropy figure out, and omits it for an empty file", () => {
    const at = (entropy: number | null) =>
      sectionRows(buildFileReport({ meta: { ...photo, entropy }, fileName: "f.bin" }), "File")["Entropy"];
    expect(at(4.1)).toBe("4.10 bits/byte (typical for structured data)");
    expect(at(0.2)).toBe("0.20 bits/byte (very low, so the contents are highly repetitive)");
    expect(at(null)).toBeUndefined();
  });

  it("names a disguised extension as the mismatch it is", () => {
    const disguised = buildFileReport({
      meta: { ...photo, extMismatch: { claimed: "jpg", actual: "zip" } },
      fileName: "holiday.jpg",
    });
    expect(sectionRows(disguised, "File")["Extension check"]).toBe("MISMATCH: named .jpg, contents are zip");
  });

  it("reports the digests, the coordinate and the camera block", () => {
    const m = model();
    expect(sectionRows(m, "Integrity")["SHA-256"]).toBe("b".repeat(64));
    const location = sectionRows(m, "Location");
    expect(location["Coordinate"]).toContain("45.6495");
    expect(location["Latitude"]).toContain("45");
    expect(location["Altitude"]).toBe("22.5 m");
    expect(location["Heading"]).toBe("271°");
    const camera = sectionRows(m, "Camera and capture");
    expect(camera["Make"]).toBe("Apple");
    expect(camera["Model"]).toBe("iPhone 15 Pro");
    expect(camera["Taken"]).toBe("2024-03-02 10:15:00");
    expect(camera["Aperture"]).toBe("f/1.78");
    expect(camera["Shutter"]).toBe("1/120");
    expect(camera["ISO"]).toBe("64");
    expect(camera["Focal length"]).toBe("6.9 mm");
    expect(sectionRows(m, "Image")["Dimensions"]).toBe("4032 × 3024 px");
    expect(sectionRows(m, "Image")["EXIF block"]).toBe("present");
  });

  it("prints one section per metadata group, in a fixed order", () => {
    const headings = model().sections.map((s) => s.heading);
    expect(headings).toEqual([
      "File", "Integrity", "Location", "Image", "Camera and capture",
      "Image metadata", "IPTC metadata", "XMP metadata", "Something else metadata",
      "Reading notes",
    ]);
  });

  it("summarises what the file gave up, and counts the attribution fields", () => {
    const m = model();
    expect(m.headline?.value).toBe("JPEG image carrying 6 embedded fields");
    const summary = Object.fromEntries((m.summary ?? []).map((r) => [r.label, r.value]));
    expect(summary["Embedded fields"]).toBe("6");
    expect(summary["Attribution fields"]).toBe("4");
    expect(summary["Coordinate"]).toContain("45.6495");
    expect(summary["SHA-256"]).toBe("b".repeat(64));
  });

  it("says plainly when a file carries nothing, and pluralises one field", () => {
    const bare = buildFileReport({
      meta: { ...photo, fields: [], gps: null, image: null, hasDeepMeta: false, notes: [] },
      fileName: "opaque.bin",
    });
    expect(bare.headline?.value).toBe("JPEG image with no embedded metadata");
    expect(bare.sections.map((s) => s.heading)).toEqual(["File"]);
    expect(Object.fromEntries((bare.summary ?? []).map((r) => [r.label, r.value]))["Attribution fields"]).toBeUndefined();

    const one = buildFileReport({
      meta: { ...photo, fields: [{ label: "Author", value: "x", group: "Document" }], gps: null, image: null },
      fileName: "one.txt",
    });
    expect(one.headline?.value).toBe("JPEG image carrying 1 embedded field");
  });

  it("names the file by its detected type when it was dropped without a name", () => {
    expect(buildFileReport({ meta: photo, fileName: "" }).subject).toBe("JPEG image");
  });

  it("offers map and reverse-image pivots, and none for a file with neither", () => {
    const m = model();
    expect(m.pivots.length).toBeGreaterThan(2);
    expect(m.pivots.some((p) => /openstreetmap|google/i.test(p.url))).toBe(true);
    const plain = buildFileReport({ meta: { ...photo, gps: null, image: null }, fileName: "notes.txt" });
    expect(plain.pivots).toEqual([]);
  });

  it("emits the SHA-256 as a STIX file observable, and none without a digest", () => {
    const bundle = reportToStixBundle(model()) as { objects: { type: string; hashes?: Record<string, string> }[] };
    const file = bundle.objects.find((o) => o.type === "file");
    expect(file?.hashes?.["SHA-256"]).toBe("b".repeat(64));
    expect(buildFileReport({ meta: photo, fileName: "x.jpg" }).observables).toEqual([]);
  });

  it("carries no risk block and no source table, because it queried nothing", () => {
    const m = model();
    expect(m.assessment).toBeUndefined();
    expect(m.sources).toEqual([]);
    expect(reportStats(m).sources).toBe(0);
    expect(reportOutline(m)).not.toContain("Risk assessment");
    expect(reportOutline(m)).not.toContain("Data sources");
  });

  it("is titled for the mode it belongs to", () => {
    expect(reportTitle(model())).toBe("File Metadata Intelligence Report");
  });
});

describe("a file report does not repeat claims that are only true of a lookup", () => {
  it("swaps in a methodology about bytes rather than sources", () => {
    expect(methodologyFor(model())).toBe(FILE_METHODOLOGY);
    expect(FILE_METHODOLOGY[0]).toContain("reading the file's own bytes");
    expect(FILE_METHODOLOGY.join(" ")).not.toContain("API key");
    // Every other mode keeps the original set.
    const domainish = { ...model(), kind: "domain" as const };
    expect(methodologyFor(domainish)).toBe(METHODOLOGY);
  });

  it("states the evidence basis as a local read, not a failed collection", () => {
    const rows = Object.fromEntries(controlRows(model()).map((r) => [r.label, r.value]));
    expect(rows["Evidence basis"]).toMatch(/^read from the file's own bytes, \d+ recorded fields$/);
    expect(rows["Subject type"]).toBe("File Metadata");
    const lookup = Object.fromEntries(
      controlRows({ ...model(), kind: "domain", sources: [{ source: "DNS", ok: true }] }).map((r) => [r.label, r.value]),
    );
    expect(lookup["Evidence basis"]).toMatch(/^1 sources queried, 1 answered/);
  });

  it("says on the cover what was actually read, not that zero sources answered", () => {
    const notice = provenanceNotice(model());
    expect(notice).toContain("read from the file's own bytes");
    expect(notice).not.toContain("0 open-source");
    expect(notice).toMatch(/\d+ fields were recorded across \d+ sections/);
    const lookup = provenanceNotice({ ...model(), kind: "domain", sources: [{ source: "DNS", ok: true, ms: 40 }] });
    expect(lookup).toContain("1 open-source source, of which 1 answered");
  });

  it("counts the sections it actually printed, singular included", () => {
    const one = buildFileReport({
      meta: { ...photo, fields: [], gps: null, image: null, notes: [] },
      fileName: "x.bin",
    });
    expect(provenanceNotice(one)).toContain("across 1 section.");
    expect(provenanceNotice(model())).toMatch(/across \d+ sections\./);
  });
});

describe("the file report renders in every format", () => {
  it("prints the metadata sections in all four documents", () => {
    const m = model();
    const outline = reportOutline(m);
    const print = reportToPrintHtml(m);
    const screen = reportToHtml(m);
    const text = reportToText(m);
    const markdown = reportToMarkdown(m);

    for (const doc of [print, screen]) {
      expect(doc).toContain("Lucia Ferrara");
      expect(doc).toContain("Adobe Lightroom 13.2");
      expect(doc).toContain("iPhone 15 Pro");
    }
    expect(text).toContain("LUCIA FERRARA".length > 0 ? "Lucia Ferrara" : "");
    expect(markdown).toContain("| Photographer | Lucia Ferrara |");

    // The paged document follows the same outline as every other mode's.
    for (const heading of outline) expect(print).toContain(`id="${slug(heading)}"`);
    expect(print).toContain("File Metadata Intelligence Report");
    // And it prints the file methodology, not the lookup one.
    expect(print).toContain("reading the file's own bytes");
    expect(print).not.toContain("no API key is configured");
  });
});
