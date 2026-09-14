// ── Bounded decompression, shared by the container parsers ──────────────────
//
// Several formats store their metadata compressed: a ZIP member holding an
// Office property file, a PNG's zTXt or compressed iTXt chunk. All of them go
// through here so the bomb guard is written once. The platform's own
// DecompressionStream does the work, so there is no third-party dependency, and
// the output is abandoned the moment it passes the cap rather than being
// buffered whole.

// A single member never legitimately inflates past this. Office/ODF/EPUB
// property files and PNG text chunks are a few kilobytes; the cap is orders of
// magnitude larger, so it never truncates a real one, but it stops a
// decompression bomb (DEFLATE reaches ~1000:1, so a small archive could
// otherwise expand to gigabytes and exhaust the tab's memory).
export const MAX_INFLATE = 32 * 1024 * 1024;

/**
 * Inflate `data` in the given stream format, or null when it is corrupt,
 * unsupported, or expands past `MAX_INFLATE`.
 */
export async function inflate(data: Uint8Array, format: "deflate-raw" | "deflate" | "gzip"): Promise<Uint8Array | null> {
  try {
    // pipeThrough owns the writable side, so a corrupt stream surfaces as a
    // single rejection here rather than a dangling unhandled promise.
    const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream(format));
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_INFLATE) {
        await reader.cancel(); // stop the decompressor; do not buffer the bomb
        return null;
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
  } catch {
    return null; // corrupt or unsupported stream
  }
}
