// ── Shared shapes for the universal metadata engine ─────────────────────────
//
// Types only: this file compiles to nothing, so it carries no coverage. The
// engine identifies a file by its actual bytes, then attaches whatever real
// metadata the format carries. Nothing here is ever fabricated — a field is
// present only when it was read out of the file.

import type { GpsFix, ImageMeta } from "../exif";

/** Top-level family a format belongs to, for grouping and iconography. */
export type FileCategory =
  | "image"
  | "video"
  | "audio"
  | "document"
  | "archive"
  | "executable"
  | "font"
  | "database"
  | "disk-image"
  | "data"
  | "text"
  | "unknown";

/** What the bytes actually are, independent of the filename's extension. */
export interface FileIdentity {
  /** Stable short id, e.g. "jpeg", "pdf", "docx". */
  kind: string;
  /** Human label, e.g. "JPEG image". */
  label: string;
  category: FileCategory;
  /** Canonical MIME type. */
  mime: string;
  /** Canonical extension without the dot, e.g. "jpg". */
  ext: string;
}

/**
 * One extracted metadata datum. `sensitive` marks the fields an analyst cares
 * about most and the UI highlights: real names, coordinates, usernames, device
 * identifiers, timestamps that place a person somewhere.
 */
export interface MetaField {
  label: string;
  value: string;
  /** Section the field belongs to: "Document", "Camera", "Location", … */
  group: string;
  sensitive?: boolean;
}

/** Cryptographic digests of the whole file (real Web Crypto, never MD5). */
export interface FileHashes {
  sha1: string;
  sha256: string;
}

/**
 * The normalized result of extracting metadata from one file. `fields` holds
 * every real datum found; `image` carries the rich EXIF struct when the file is
 * an image (so the existing GPS/camera UI renders unchanged); `gps` is lifted to
 * the top level whether it came from image EXIF or a video location atom.
 */
export interface UniversalMeta {
  identity: FileIdentity;
  size: number;
  /** Filename extension vs. detected content, when they disagree. */
  extMismatch: { claimed: string; actual: string } | null;
  fields: MetaField[];
  gps: GpsFix | null;
  image: ImageMeta | null;
  /** Shannon entropy of the bytes in bits/byte (0–8); null for an empty file. */
  entropy: number | null;
  /** Honest limitations, e.g. "recognized, but carries no embedded metadata". */
  notes: string[];
  /** True when at least one embedded field (beyond generic file facts) was read. */
  hasDeepMeta: boolean;
}

/**
 * A format-specific extractor: given the bytes of a file already identified as
 * `kind`, return the fields, and optionally a coordinate or image struct. Pure
 * and total — it must never throw on hostile input.
 */
export interface Extraction {
  fields: MetaField[];
  gps?: GpsFix | null;
  image?: ImageMeta | null;
  notes?: string[];
}
