// ── Plain-archive metadata (GZIP / TAR) ─────────────────────────────────────
//
// These two formats leak identity directly. A GZIP header stores the ORIGINAL
// filename (and its modification time and source OS), which routinely reveals a
// local path or a naming scheme. A TAR header stores each file's owner and group
// as NAMES, not just numeric ids, so a tarball made on someone's machine carries
// their username. Both are read straight from the fixed header layout, bounded
// against truncation, and every value is a real field, never inferred.

import { Reader } from "./bytes";
import type { Extraction, MetaField } from "./types";

const MAX_UNIX = 32503680000; // year ~3000 in seconds; a larger value is not a real time

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

function extractGzip(r: Reader): Extraction {
  const fields: MetaField[] = [];
  const flags = r.u8(3);
  if (flags === null) return { fields };

  const mtime = r.u32(4, true);
  if (mtime !== null) { const d = unixDate(mtime); if (d) fields.push({ label: "Original modified", value: d, group: "Archive" }); }
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
  return { fields };
}

// ── TAR (POSIX ustar) ────────────────────────────────────────────────────────
/** Parse an octal ASCII numeric field, or null when blank/invalid. */
function octal(r: Reader, off: number, len: number): number | null {
  const s = r.ascii(off, len);
  if (!s) return null;
  const n = parseInt(s, 8);
  return Number.isNaN(n) ? null : n;
}

/** Count members by walking 512-byte headers until two zero blocks or the end. */
function countEntries(r: Reader): number {
  let count = 0;
  let p = 0;
  while (p + 512 <= r.length) {
    const name = r.ascii(p, 100);
    if (name === null) break; // an all-zero header marks the end of the archive
    count++;
    const size = octal(r, p + 124, 12) ?? 0;
    p += 512 + Math.ceil(size / 512) * 512;
  }
  return count;
}

function extractTar(r: Reader): Extraction {
  const fields: MetaField[] = [];
  const first = r.ascii(0, 100);
  if (first) fields.push({ label: "First entry", value: first, group: "Archive" });

  const uname = r.ascii(265, 32);
  if (uname) fields.push({ label: "Owner", value: uname, group: "Archive", sensitive: true });
  const gname = r.ascii(297, 32);
  if (gname) fields.push({ label: "Group", value: gname, group: "Archive", sensitive: true });

  const uid = octal(r, 108, 8);
  const gid = octal(r, 116, 8);
  if (uid !== null) fields.push({ label: "Owner UID", value: String(uid), group: "Archive" });
  if (gid !== null) fields.push({ label: "Group GID", value: String(gid), group: "Archive" });

  const mtime = octal(r, 136, 12);
  if (mtime !== null) { const d = unixDate(mtime); if (d) fields.push({ label: "First entry modified", value: d, group: "Archive" }); }

  const count = countEntries(r);
  if (count > 0) fields.push({ label: "Members", value: String(count), group: "Archive" });
  return { fields };
}

/** Extract metadata from a GZIP or TAR archive identified as `kind`. */
export function extractArchive(kind: string, bytes: Uint8Array): Extraction {
  const r = new Reader(bytes);
  if (kind === "gzip") return extractGzip(r);
  if (kind === "tar") return extractTar(r);
  return { fields: [] };
}
