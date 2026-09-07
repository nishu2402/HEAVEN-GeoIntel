// ── Universal file-metadata engine (orchestrator) ───────────────────────────
//
// One entry point for "read everything this file honestly tells us about
// itself". It identifies the file from its bytes, dispatches to the right deep
// parser, and normalizes the result: the rich image struct when it is an image,
// a coordinate lifted to the top level whether it came from photo EXIF or a
// video location atom, the format-specific fields every other parser returns,
// plus facts that apply to any file at all: exact size, Shannon entropy (a
// packing/encryption signal), a real extension-versus-content check, and true
// SHA-1/SHA-256 digests. Nothing is invented: a file the engine cannot parse
// still gets an honest identity and these generic facts, with a plain note that
// it carries no deeper metadata. Everything runs on the bytes in hand; the file
// is never uploaded.

import { parseExif, type ImageMeta } from "../exif";
import { sniff, extensionMismatch } from "./sniff";
import { extractImage } from "./image";
import { extractIsoBmff } from "./isobmff";
import { extractPdf } from "./pdf";
import { extractZip } from "./zip";
import { extractAudio } from "./audio";
import { extractArchive } from "./archive";
import type { Extraction, FileHashes, MetaField, UniversalMeta } from "./types";

const RASTER = new Set(["gif", "bmp", "tiff", "webp"]);
const ISOBMFF = new Set(["heic", "avif", "mp4", "mov", "m4a", "3gp"]);
const ZIP = new Set(["zip", "jar", "apk", "docx", "xlsx", "pptx", "odt", "ods", "odp", "epub"]);
const AUDIO = new Set(["mp3", "flac", "wav"]);
const ARCHIVE = new Set(["gzip", "tar"]);

/** Shannon entropy of the bytes in bits/byte (0–8); null for an empty file. */
export function shannonEntropy(bytes: Uint8Array): number | null {
  if (bytes.length === 0) return null;
  const counts = new Array(256).fill(0);
  for (let i = 0; i < bytes.length; i++) counts[bytes[i]]++;
  let h = 0;
  for (const c of counts) {
    if (c === 0) continue;
    const p = c / bytes.length;
    h -= p * Math.log2(p);
  }
  return Math.round(h * 100) / 100;
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Real SHA-1 and SHA-256 digests of the whole file (Web Crypto, no MD5). */
export async function hashFile(bytes: Uint8Array): Promise<FileHashes> {
  // crypto.subtle wants an ArrayBuffer-backed view, not the SharedArrayBuffer-
  // inclusive default a bare Uint8Array now means under TypeScript 5.7+.
  const view = bytes as Uint8Array<ArrayBuffer>;
  const [sha1, sha256] = await Promise.all([
    crypto.subtle.digest("SHA-1", view),
    crypto.subtle.digest("SHA-256", view),
  ]);
  return { sha1: hex(sha1), sha256: hex(sha256) };
}

/** Run the deep parser for `kind`, returning the fields, gps, image and notes. */
async function deepExtract(kind: string, bytes: Uint8Array): Promise<Extraction & { image: ImageMeta | null }> {
  if (kind === "jpeg" || kind === "png") {
    const image = parseExif(bytes);
    return { fields: [], gps: image.gps, image };
  }
  if (RASTER.has(kind)) {
    const image = extractImage(kind, bytes);
    return { fields: [], gps: image?.gps ?? null, image };
  }
  if (ISOBMFF.has(kind)) {
    const ex = extractIsoBmff(kind, bytes);
    return { fields: ex.fields, gps: ex.gps ?? null, image: ex.image ?? null, notes: ex.notes };
  }
  if (kind === "pdf") return { ...extractPdf(bytes), image: null };
  if (ZIP.has(kind)) return { ...(await extractZip(kind, bytes)), image: null };
  if (AUDIO.has(kind)) return { ...extractAudio(kind, bytes), image: null };
  if (ARCHIVE.has(kind)) return { ...extractArchive(kind, bytes), image: null };
  return { fields: [], gps: null, image: null };
}

/**
 * Read all available metadata from a file. `filename` refines identification of
 * plain-text files and enables the extension-mismatch check; it never overrides
 * what the bytes say. Hashing is separate (see `hashFile`) so the metadata can
 * render immediately while the digests of a large file are still computing.
 */
export async function extractFileMeta(bytes: Uint8Array, filename = ""): Promise<UniversalMeta> {
  const identity = sniff(bytes, filename);
  const ex = await deepExtract(identity.kind, bytes);
  const fields: MetaField[] = ex.fields;
  const gps = ex.gps ?? ex.image?.gps ?? null;
  const image = ex.image;
  const notes: string[] = [...(ex.notes ?? [])];

  // An image counts as informative once it yields EXIF or even just dimensions.
  const imageHasInfo = image !== null && (image.hasExif || image.width !== null);
  const hasDeepMeta = fields.length > 0 || gps !== null || imageHasInfo;
  if (identity.kind === "unknown") {
    notes.push("This file's type could not be identified from its contents.");
  } else if (!hasDeepMeta) {
    notes.push(`Recognized as ${identity.label}, but it carries no embedded metadata beyond the file facts above.`);
  }

  return {
    identity,
    size: bytes.length,
    extMismatch: extensionMismatch(identity, filename),
    fields,
    gps,
    image,
    entropy: shannonEntropy(bytes),
    notes,
    hasDeepMeta,
  };
}
