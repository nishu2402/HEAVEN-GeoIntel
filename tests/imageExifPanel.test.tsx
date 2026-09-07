// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import ImageExifPanel from "@/components/image/ImageExifPanel";
import { jpegWithGps, jpegExifNoGps, jpegGpsNoAlt, buildPng } from "./exifFixtures";
import { asciiBytes } from "@/lib/analysis/meta/bytes";
import { hashFile } from "@/lib/analysis/meta/fileMeta";

// hashFile is wrapped so one test can hold it pending to observe the interim
// "computing" state; by default it delegates to the real digest implementation.
vi.mock("@/lib/analysis/meta/fileMeta", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/analysis/meta/fileMeta")>();
  return { ...actual, hashFile: vi.fn(actual.hashFile) };
});

const A = (s: string) => asciiBytes(s);
const cat = (...p: (number[] | Uint8Array)[]) => new Uint8Array(p.flatMap((x) => Array.from(x)));
const u16be = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u32be = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const fourcc = (s: string) => [...s].map((c) => c.charCodeAt(0));
const box = (type: string, payload: number[]) => [...u32be(8 + payload.length), ...fourcc(type), ...payload];
const ftyp = (b: string) => box("ftyp", [...fourcc(b.padEnd(4).slice(0, 4)), ...u32be(0)]);

const PDF = new TextEncoder().encode(
  "%PDF-1.7\n1 0 obj<< /Author (Nadia Rao) /Producer (LibreOffice) /CreationDate (D:20230101093000Z) >>endobj\n" +
  "trailer<< /Info 1 0 R >>\n<?xpacket begin?>%%EOF");

const MP4 = cat(ftyp("isom"), box("moov", [
  ...box("mvhd", [0, 0, 0, 0, ...u32be(3755376000), ...u32be(3755376000), ...u32be(1000), ...u32be(5000)]),
  ...box("udta", box("©xyz", [...u16be(18), ...u16be(0), ...A("+37.7749-122.4194/")])),
]));

const HIGH_ENTROPY = new Uint8Array(Array.from({ length: 256 }, (_, i) => i));
const LOW_ENTROPY = new Uint8Array(500); // all zeros

function fakeFile(bytes: Uint8Array, name: string, type = "", size?: number): File {
  const file = new File([bytes as unknown as BlobPart], name, { type });
  Object.defineProperty(file, "size", { value: size ?? bytes.length });
  Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  return file;
}
function drop(file: File | null) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: file ? [file] : [] } });
}

beforeEach(() => {
  cleanup();
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});

describe("File metadata panel — images", () => {
  it("surfaces GPS, camera, capture, hashes and entropy from a JPEG", async () => {
    render(<ImageExifPanel />);
    drop(fakeFile(jpegWithGps(), "photo.jpg", "image/jpeg", 2_000_000));

    await screen.findByText("40.446111, -79.982222");
    expect(screen.getByText(/EXIF PRESENT · GPS FOUND/)).toBeTruthy();
    expect(screen.getByText(/1\.9 MB/)).toBeTruthy();
    expect(screen.getByText(/4000×3000px/)).toBeTruthy();
    expect(screen.getByText("iPhone 15 Pro")).toBeTruthy();
    expect(screen.getByText(`40°26'46.0"N`)).toBeTruthy();
    expect(screen.getByText("100.0 m")).toBeTruthy();
    expect(screen.getByText("215°")).toBeTruthy();
    expect(screen.getByText("f/2.8")).toBeTruthy();
    expect(screen.getByText("Yandex Images")).toBeTruthy();
    expect((document.querySelector("img") as HTMLImageElement).src).toContain("blob:preview");

    await screen.findByText("SHA-256"); // digests resolve asynchronously
    expect(screen.getByText(/bits\/byte/)).toBeTruthy();
  });

  it("loads the opt-in map and confirms coordinate and hash copies", async () => {
    render(<ImageExifPanel />);
    drop(fakeFile(jpegWithGps(), "photo.jpg", "image/jpeg"));
    await screen.findByText("40.446111, -79.982222");

    fireEvent.click(screen.getByText(/Load map preview/));
    expect((document.querySelector("iframe") as HTMLIFrameElement).src).toContain("openstreetmap.org/export/embed");

    await screen.findByText("SHA-256");
    vi.useFakeTimers();
    fireEvent.click(screen.getByTitle("Copy coordinate"));
    expect(screen.getByText("Copied")).toBeTruthy();
    fireEvent.click(screen.getByTitle("Copy SHA-256"));
    fireEvent.click(screen.getByTitle("Copy SHA-1"));
    act(() => { vi.advanceTimersByTime(1700); });
    vi.useRealTimers();
    expect(screen.getByText("Copy")).toBeTruthy(); // coordinate button reset
  });

  it("shows a GPS fix without altitude or heading when absent", async () => {
    render(<ImageExifPanel />);
    drop(fakeFile(jpegGpsNoAlt(), "geo.jpg", "image/jpeg", 5000));
    await screen.findByText(/48\.85.*, 2\.35/);
    expect(screen.getByText(/4\.9 KB/)).toBeTruthy();
    expect(screen.queryByText(/ m$/)).toBeNull();
  });

  it("reports EXIF present but no GPS when the GPS IFD is missing", async () => {
    render(<ImageExifPanel />);
    drop(fakeFile(jpegExifNoGps(), "cam.jpg", "image/jpeg"));
    await screen.findByText("Fujifilm");
    expect(screen.getByText(/EXIF PRESENT/)).toBeTruthy();
    expect(screen.queryByText(/GPS FOUND/)).toBeNull();
    expect(screen.queryByText(/GPS COORDINATE/)).toBeNull();
  });

  it("renders a PNG with dimensions and reverse-image links, no EXIF", async () => {
    render(<ImageExifPanel />);
    drop(fakeFile(buildPng({ w: 128, h: 96 }), "flat.png", "image/png"));
    await screen.findByText(/128×96px/);
    expect(screen.getByText(/REVERSE-IMAGE/)).toBeTruthy();
    expect(screen.queryByText(/EXIF PRESENT/)).toBeNull();
  });
});

describe("File metadata panel — documents, media and other files", () => {
  it("extracts grouped, sensitive fields from a PDF (no image sections)", async () => {
    render(<ImageExifPanel />);
    drop(fakeFile(PDF, "leak.pdf", "application/pdf"));
    await screen.findByText("Nadia Rao");
    expect(screen.getByText("Document")).toBeTruthy();       // group header
    expect(screen.getByText("LibreOffice")).toBeTruthy();
    expect(screen.queryByText(/REVERSE-IMAGE/)).toBeNull();  // not an image
    expect(document.querySelector("img")).toBeNull();        // pdf is not previewable
    expect(screen.getByText(/XMP metadata/)).toBeTruthy();   // honest note
  });

  it("recovers a GPS fix and container facts from an MP4 video", async () => {
    render(<ImageExifPanel />);
    drop(fakeFile(MP4, "clip.mp4", "video/mp4"));
    await screen.findByText(/37\.774900, -122\.419400/);
    expect(screen.getByText("isom")).toBeTruthy();           // Brand field
    expect(screen.getByText("Media")).toBeTruthy();          // group header
    expect(screen.queryByText(/CAMERA/)).toBeNull();         // no EXIF camera block
  });

  it("flags an extension/content mismatch", async () => {
    render(<ImageExifPanel />);
    drop(fakeFile(buildPng({ w: 10, h: 10 }), "sneaky.jpg", "image/jpeg"));
    await screen.findByText(/Extension mismatch/);
    expect(screen.getByText(/actually/)).toBeTruthy();
  });

  it("marks an unidentified file and reads its entropy (high and low)", async () => {
    render(<ImageExifPanel />);
    drop(fakeFile(HIGH_ENTROPY, "blob.bin"));
    await screen.findByText(/UNIDENTIFIED/);
    expect(screen.getByText(/could not be identified/)).toBeTruthy();
    expect(screen.getByText(/high — likely compressed or encrypted/)).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();

    drop(fakeFile(LOW_ENTROPY, "zeros.bin"));
    await screen.findByText(/very low — highly repetitive/);
  });

  it("shows the computing state while digests are still pending", async () => {
    vi.mocked(hashFile).mockReturnValueOnce(new Promise<never>(() => {})); // never resolves
    render(<ImageExifPanel />);
    drop(fakeFile(buildPng({ w: 8, h: 8 }), "p.png", "image/png"));
    await screen.findByText(/Computing digests/);
    expect(screen.queryByText("SHA-256")).toBeNull(); // digests have not arrived
  });

  it("stays usable when hashing fails", async () => {
    vi.mocked(hashFile).mockRejectedValueOnce(new Error("no crypto"));
    render(<ImageExifPanel />);
    drop(fakeFile(buildPng({ w: 8, h: 8 }), "p.png", "image/png"));
    await screen.findByText(/Computing digests/); // .catch keeps hashes null
    // The metadata still renders even though the digests never arrived.
    expect(screen.queryByText("SHA-256")).toBeNull();
  });
});

describe("File metadata panel — input handling", () => {
  it("rejects a file over the size ceiling", async () => {
    render(<ImageExifPanel />);
    drop(fakeFile(jpegWithGps(), "huge.jpg", "image/jpeg", 101 * 1024 * 1024));
    await screen.findByText(/larger than 100 MB/);
    expect(screen.queryByText(/EXIF PRESENT/)).toBeNull();
  });

  it("revokes the previous preview URL when a second file is dropped", async () => {
    render(<ImageExifPanel />);
    drop(fakeFile(jpegWithGps(), "a.jpg", "image/jpeg"));
    await screen.findByText("iPhone 15 Pro");
    drop(fakeFile(jpegExifNoGps(), "b.jpg", "image/jpeg"));
    await screen.findByText("Fujifilm");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });

  it("shows an error instead of crashing when the file cannot be read", async () => {
    render(<ImageExifPanel />);
    const bad = new File([new Uint8Array([1, 2, 3]) as unknown as BlobPart], "bad.bin");
    Object.defineProperty(bad, "size", { value: 3 });
    Object.defineProperty(bad, "arrayBuffer", { value: async () => { throw new Error("read failed"); } });
    drop(bad);
    await screen.findByText(/could not be read/);
    expect(screen.queryByText(/INTEGRITY/)).toBeNull(); // nothing rendered past the error
  });

  it("handles drag state and drop, and ignores empty selections", async () => {
    render(<ImageExifPanel />);
    const zone = document.querySelector("label") as HTMLLabelElement;
    fireEvent.dragOver(zone);
    fireEvent.dragLeave(zone);
    fireEvent.drop(zone, { dataTransfer: { files: [fakeFile(jpegExifNoGps(), "d.jpg", "image/jpeg")] } });
    await screen.findByText("X-T5");

    drop(null);
    fireEvent.drop(zone, { dataTransfer: { files: [] } });
    expect(screen.getByText("X-T5")).toBeTruthy();
  });
});
