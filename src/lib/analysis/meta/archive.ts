// ── Plain-archive metadata (GZIP / TAR) ─────────────────────────────────────
//
// These two formats leak identity directly. A GZIP header stores the ORIGINAL
// filename (and its modification time and source OS), which routinely reveals a
// local path or a naming scheme. A TAR header stores each file's owner and group
// as NAMES, not just numeric ids, so a tarball made on someone's machine carries
// their username. Both are read straight from the fixed header layout, bounded
// against truncation, and every value is a real field, never inferred.
//
// The two formats are usually nested: a .tar.gz is a tar inside a gzip, and the
// tar is where all the attribution lives. So the gzip stream is decompressed
// (bounded, like every other member this tree inflates) and whatever is inside
// is identified and read in turn. That is also what makes the uncompressed size
// a measurement rather than a claim: it is the length of what came out, not the
// number the footer says.

import { Reader } from "./bytes";
import { inflate } from "./inflate";
import { sniff } from "./sniff";
import type { Extraction, MetaField } from "./types";

const MAX_UNIX = 32503680000; // year ~3000 in seconds; a larger value is not a real time

/** Human-readable byte count for an archive's totals. */
function humanBytes(n: number): string {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Unix seconds to "YYYY-MM-DD HH:MM:SS" UTC, or null when unset/out of range. */
function unixDate(sec: number): string | null {
  if (sec <= 0 || sec > MAX_UNIX) return null;
  return new Date(sec * 1000).toISOString().replace("T", " ").slice(0, 19);
}

// ── GZIP ───────────────────────────────────────────────────────────────────
const GZIP_OS: Record<number, string> = {
  0: "FAT (DOS/Windows)", 1: "Amiga", 2: "VMS", 3: "Unix", 6: "HPFS (OS/2)",
  7: "Macintosh", 11: "NTFS (Windows)", 13: "Acorn RISC OS",
};

/** Read a NUL-terminated string starting at `p`; returns it and the next offset. */
function cString(bytes: Uint8Array, p: number): { value: string | null; next: number } {
  let i = p;
  while (i < bytes.length && bytes[i] !== 0) i++;
  const value = new TextDecoder("utf-8").decode(bytes.subarray(p, i)).trim() || null;
  return { value, next: i + 1 };
}

// The XFL byte records which end of the speed/size trade-off the compressor
// was asked for, which is a small but real fingerprint of the tool used.
const GZIP_LEVEL: Record<number, string> = { 2: "maximum compression", 4: "fastest" };

async function extractGzip(r: Reader): Promise<Extraction> {
  const fields: MetaField[] = [];
  const notes: string[] = [];
  const flags = r.u8(3);
  if (flags === null) return { fields };

  const mtime = r.u32(4, true);
  if (mtime !== null) { const d = unixDate(mtime); if (d) fields.push({ label: "Original modified", value: d, group: "Archive" }); }
  const xfl = r.u8(8);
  if (xfl !== null && GZIP_LEVEL[xfl]) fields.push({ label: "Compression level", value: GZIP_LEVEL[xfl], group: "Archive" });
  const os = r.u8(9);
  if (os !== null && GZIP_OS[os]) fields.push({ label: "Source OS", value: GZIP_OS[os], group: "Archive" });

  let p = 10;
  if (flags & 0x04) { // FEXTRA: a length-prefixed extra field precedes the name
    const xlen = r.u16(p, true);
    if (xlen === null) return { fields };
    p += 2 + xlen;
  }
  if (flags & 0x08) { // FNAME: the original filename, NUL-terminated
    const { value, next } = cString(r.bytes, p);
    if (value) fields.push({ label: "Original filename", value, group: "Archive", sensitive: true });
    p = next;
  }
  if (flags & 0x10) { // FCOMMENT
    const { value } = cString(r.bytes, p);
    if (value) fields.push({ label: "Comment", value, group: "Archive" });
  }

  // What is actually inside. A .tar.gz keeps every name, owner and timestamp in
  // the tar, and none of it is legible until the gzip layer is peeled off.
  const inner = await inflate(r.bytes, "gzip");
  if (inner === null) {
    notes.push("The compressed stream could not be read, so nothing inside it is described. It may be truncated, or larger than this tool will expand in the browser.");
    return { fields, notes };
  }
  fields.push({ label: "Uncompressed", value: humanBytes(inner.length), group: "Archive" });
  if (inner.length > 0) {
    fields.push({ label: "Compression", value: `${(100 - (r.length / inner.length) * 100).toFixed(1)}% smaller packed`, group: "Archive" });
  }
  const identity = sniff(inner);
  if (identity.kind === "tar") {
    fields.push({ label: "Contains", value: "TAR archive", group: "Archive" });
    fields.push(...extractTar(new Reader(inner)).fields);
  } else if (identity.kind !== "unknown") {
    fields.push({ label: "Contains", value: identity.label, group: "Archive" });
  }
  return { fields, notes };
}

// ── TAR (POSIX ustar) ────────────────────────────────────────────────────────
/** Parse an octal ASCII numeric field, or null when blank/invalid. */
function octal(r: Reader, off: number, len: number): number | null {
  const s = r.ascii(off, len);
  if (!s) return null;
  const n = parseInt(s, 8);
  return Number.isNaN(n) ? null : n;
}

interface TarEntry { name: string; size: number; owner: string | null; group: string | null; mtime: number | null; mode: number | null }

/**
 * Walk the 512-byte headers, collecting every member. A tarball made on a
 * person's machine carries their account name in each header, and the mode bits
 * say which members are executable, so the whole list is worth reading rather
 * than only the first entry.
 */
function readTarEntries(r: Reader): TarEntry[] {
  const out: TarEntry[] = [];
  let p = 0;
  while (p + 512 <= r.length && out.length < 4096) {
    const name = r.ascii(p, 100);
    if (name === null) break; // an all-zero header marks the end of the archive
    const size = octal(r, p + 124, 12) ?? 0;
    out.push({
      name,
      size,
      owner: r.ascii(p + 265, 32),
      group: r.ascii(p + 297, 32),
      mtime: octal(r, p + 136, 12),
      mode: octal(r, p + 100, 8),
    });
    p += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

/** Distinct, non-empty values in first-seen order. */
const distinct = (values: (string | null)[]) => [...new Set(values.filter((v): v is string => v !== null))];

function extractTar(r: Reader): Extraction {
  const fields: MetaField[] = [];
  const entries = readTarEntries(r);
  if (entries.length === 0) return { fields };

  const format = r.ascii(257, 8);
  if (format) fields.push({ label: "Format", value: format.startsWith("ustar") ? `POSIX ustar (${format})` : format, group: "Archive" });

  fields.push({ label: "Members", value: String(entries.length), group: "Archive" });
  const total = entries.reduce((n, e) => n + e.size, 0);
  if (total > 0) fields.push({ label: "Total size", value: humanBytes(total), group: "Archive" });

  // Every distinct account that owns a member, not just the first one: an
  // archive assembled from several machines names each of them.
  const owners = distinct(entries.map((e) => e.owner));
  if (owners.length) fields.push({ label: owners.length > 1 ? "Owners" : "Owner", value: owners.join(", "), group: "Archive", sensitive: true });
  const groups = distinct(entries.map((e) => e.group));
  if (groups.length) fields.push({ label: groups.length > 1 ? "Groups" : "Group", value: groups.join(", "), group: "Archive", sensitive: true });

  const uid = octal(r, 108, 8);
  const gid = octal(r, 116, 8);
  if (uid !== null) fields.push({ label: "Owner UID", value: String(uid), group: "Archive" });
  if (gid !== null) fields.push({ label: "Group GID", value: String(gid), group: "Archive" });

  const times = entries.map((e) => e.mtime).filter((t): t is number => t !== null && t > 0);
  const oldest = times.length ? unixDate(Math.min(...times)) : null;
  const newest = times.length ? unixDate(Math.max(...times)) : null;
  if (oldest && oldest !== newest) fields.push({ label: "Oldest member", value: oldest, group: "Archive", sensitive: true });
  if (newest) fields.push({ label: "Newest member", value: newest, group: "Archive", sensitive: true });

  fields.push({
    label: "Contents",
    value: entries.slice(0, 8).map((e) => e.name).join(", ") + (entries.length > 8 ? `, and ${entries.length - 8} more` : ""),
    group: "Archive",
  });

  // The executable bit is preserved by tar and is not preserved by most other
  // archive formats, so it is a real property of this file rather than a guess.
  const executable = entries.filter((e) => e.mode !== null && (e.mode & 0o111) !== 0 && !e.name.endsWith("/"));
  if (executable.length) {
    fields.push({ label: "Executable members", value: executable.slice(0, 6).map((e) => e.name).join(", "), group: "Archive", sensitive: true });
  }
  return { fields };
}

/** Extract metadata from a GZIP or TAR archive identified as `kind`. */
export async function extractArchive(kind: string, bytes: Uint8Array): Promise<Extraction> {
  const r = new Reader(bytes);
  if (kind === "gzip") return extractGzip(r);
  if (kind === "tar") return extractTar(r);
  return { fields: [] };
}
