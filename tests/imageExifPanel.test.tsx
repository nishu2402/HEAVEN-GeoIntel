// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import ImageExifPanel from "@/components/image/ImageExifPanel";
import { jpegWithGps, jpegExifNoGps, jpegGpsNoAlt, buildPng } from "./exifFixtures";

// A File whose bytes and reported size can be set independently — so a small
// fixture can stand in for a multi-megabyte or over-limit file.
function fakeFile(bytes: Uint8Array, name: string, type: string, size?: number): File {
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

describe("ImageExifPanel", () => {
  it("surfaces a full GPS fix, camera and capture facts from a JPEG", async () => {
    render(<ImageExifPanel />);
    drop(fakeFile(jpegWithGps(), "photo.jpg", "image/jpeg", 2_000_000));

    await screen.findByText("40.446111, -79.982222");
    expect(screen.getByText(/EXIF PRESENT · GPS FOUND/)).toBeTruthy();
    expect(screen.getByText(/1\.9 MB/)).toBeTruthy();       // MB size branch
    expect(screen.getByText(/4000×3000px/)).toBeTruthy();
    expect(screen.getByText("iPhone 15 Pro")).toBeTruthy();
    expect(screen.getByText("Apple")).toBeTruthy();
    expect(screen.getByText(`40°26'46.0"N`)).toBeTruthy();
    expect(screen.getByText("100.0 m")).toBeTruthy();       // altitude present
    expect(screen.getByText("215°")).toBeTruthy();          // heading present
    expect(screen.getByText("f/2.8")).toBeTruthy();
    expect(screen.getByText("Yandex Images")).toBeTruthy();
    expect((document.querySelector("img") as HTMLImageElement).src).toContain("blob:preview");
  });

  it("loads the opt-in map and confirms a copy", async () => {
    render(<ImageExifPanel />);
    drop(fakeFile(jpegWithGps(), "photo.jpg", "image/jpeg"));
    await screen.findByText("40.446111, -79.982222");

    fireEvent.click(screen.getByText(/Load map preview/));
    expect((document.querySelector("iframe") as HTMLIFrameElement).src).toContain("openstreetmap.org/export/embed");

    // Fake timers enabled BEFORE the click, so the reset setTimeout is captured.
    vi.useFakeTimers();
    fireEvent.click(screen.getByTitle("Copy coordinate"));
    expect(screen.getByText("Copied")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(1700); }); // fires the reset callback
    vi.useRealTimers();
    expect(screen.getByText("Copy")).toBeTruthy();
  });

  it("shows a GPS panel without altitude or heading when they are absent", async () => {
    render(<ImageExifPanel />);
    drop(fakeFile(jpegGpsNoAlt(), "geo.jpg", "image/jpeg", 5000)); // KB size branch
    await screen.findByText(/48\.85.*, 2\.35/);
    expect(screen.getByText(/4\.9 KB/)).toBeTruthy();
    expect(screen.queryByText(/ m$/)).toBeNull();   // no altitude row
  });

  it("reports EXIF present but no GPS when the GPS IFD is missing", async () => {
    render(<ImageExifPanel />);
    drop(fakeFile(jpegExifNoGps(), "cam.jpg", "image/jpeg"));
    await screen.findByText("Fujifilm");
    expect(screen.getByText(/EXIF PRESENT/)).toBeTruthy();
    expect(screen.queryByText(/GPS FOUND/)).toBeNull();
    expect(screen.queryByText(/GPS COORDINATE/)).toBeNull();
  });

  it("states plainly when a PNG carries no EXIF, falling back for the type label", async () => {
    render(<ImageExifPanel />);
    drop(fakeFile(buildPng({ w: 100, h: 100 }), "flat.png", "")); // empty MIME → fallback to format
    await screen.findByText(/NO EXIF METADATA/);
    expect(screen.getByText(/png ·/)).toBeTruthy();
  });

  it("marks an unsupported format and shows no preview", async () => {
    render(<ImageExifPanel />);
    drop(fakeFile(new Uint8Array([0, 1, 2, 3]), "notes.txt", "", 4));
    await screen.findByText(/UNSUPPORTED FORMAT/);
    expect(screen.getByText(/4 B/)).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
  });

  it("rejects a file over the size ceiling", async () => {
    render(<ImageExifPanel />);
    drop(fakeFile(jpegWithGps(), "huge.jpg", "image/jpeg", 41 * 1024 * 1024));
    await screen.findByText(/larger than 40 MB/);
    expect(screen.queryByText(/EXIF PRESENT/)).toBeNull();
  });

  it("revokes the previous preview URL when a second image is dropped", async () => {
    render(<ImageExifPanel />);
    drop(fakeFile(jpegWithGps(), "a.jpg", "image/jpeg"));
    await screen.findByText("iPhone 15 Pro");
    drop(fakeFile(jpegExifNoGps(), "b.jpg", "image/jpeg"));
    await screen.findByText("Fujifilm");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });

  it("handles drag state and drop, and ignores empty selections", async () => {
    render(<ImageExifPanel />);
    const zone = document.querySelector("label") as HTMLLabelElement;
    fireEvent.dragOver(zone);
    fireEvent.dragLeave(zone);
    fireEvent.drop(zone, { dataTransfer: { files: [fakeFile(jpegExifNoGps(), "d.jpg", "image/jpeg")] } });
    await screen.findByText("X-T5");

    // Empty selections are no-ops (no throw, no state change).
    drop(null);
    fireEvent.drop(zone, { dataTransfer: { files: [] } });
    expect(screen.getByText("X-T5")).toBeTruthy();
  });
});
