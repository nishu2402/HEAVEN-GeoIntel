// ── Bounded byte reader for hostile file input ──────────────────────────────
//
// Every metadata parser in this tree reads an untrusted file: a malformed or
// deliberately hostile file must yield an empty result, never a throw and never
// a fabricated value. A raw DataView throws on an out-of-range read, so instead
// of scattering bounds checks through every parser, they all go through this
// reader — each accessor returns null when the requested span falls outside the
// buffer, and callers treat null as "field absent". It mirrors the bounded
// `Tiff` reader already proven in `exif.ts`.

export class Reader {
  readonly bytes: Uint8Array;
  private readonly view: DataView;
  readonly length: number;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.length = bytes.length;
  }

  /** Unsigned byte at `off`, or null when out of range. */
  u8(off: number): number | null {
    if (off < 0 || off + 1 > this.length) return null;
    return this.view.getUint8(off);
  }

  /** Unsigned 16-bit at `off` (big-endian unless `le`), or null. */
  u16(off: number, le = false): number | null {
    if (off < 0 || off + 2 > this.length) return null;
    return this.view.getUint16(off, le);
  }

  /** Unsigned 32-bit at `off` (big-endian unless `le`), or null. */
  u32(off: number, le = false): number | null {
    if (off < 0 || off + 4 > this.length) return null;
    return this.view.getUint32(off, le);
  }

  /**
   * Unsigned 64-bit at `off` as a Number (big-endian unless `le`), or null.
   * File offsets and media durations never approach 2^53, so a Number is exact
   * for every real value and spares callers BigInt arithmetic.
   */
  u64(off: number, le = false): number | null {
    if (off < 0 || off + 8 > this.length) return null;
    // In little-endian the first word is the low half; in big-endian it is the
    // high half. Read both words in the declared endianness, then place them.
    const first = this.view.getUint32(off, le);
    const second = this.view.getUint32(off + 4, le);
    return le ? first + second * 0x1_0000_0000 : first * 0x1_0000_0000 + second;
  }

  /**
   * Latin-1 string of `len` bytes at `off`, truncated at the first NUL and
   * trimmed. null when the span is out of range or the result is empty. Latin-1
   * (not UTF-8) because this reads fixed-width ASCII fields — magic strings,
   * atom names, four-character codes — where every byte is one character.
   */
  ascii(off: number, len: number): string | null {
    if (off < 0 || len < 0 || off + len > this.length) return null;
    let s = "";
    for (let i = 0; i < len; i++) {
      const c = this.bytes[off + i];
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    const trimmed = s.trim();
    return trimmed.length ? trimmed : null;
  }

  /**
   * UTF-8 string of `len` bytes at `off`, NUL-trimmed. null when out of range
   * or empty. Used for text that carries real names and titles (document
   * properties, media tags) where multibyte characters must survive.
   */
  utf8(off: number, len: number): string | null {
    const slice = this.slice(off, len);
    if (!slice) return null;
    let end = slice.length;
    while (end > 0 && slice[end - 1] === 0) end--; // drop trailing NUL padding
    const s = new TextDecoder("utf-8").decode(slice.subarray(0, end)).trim();
    return s.length ? s : null;
  }

  /** True when the bytes at `off` equal `sig` in full (and are all present). */
  eq(off: number, sig: readonly number[]): boolean {
    if (off < 0 || off + sig.length > this.length) return false;
    for (let i = 0; i < sig.length; i++) if (this.bytes[off + i] !== sig[i]) return false;
    return true;
  }

  /** A `len`-byte view starting at `off`, or null when out of range. */
  slice(off: number, len: number): Uint8Array | null {
    if (off < 0 || len < 0 || off + len > this.length) return null;
    return this.bytes.subarray(off, off + len);
  }

  /**
   * Index of the first occurrence of `needle` at or after `from`, or -1.
   * Bounded linear scan used to locate segment markers and PDF keywords in a
   * buffer whose structure is otherwise offset-chained.
   */
  indexOf(needle: readonly number[], from = 0): number {
    if (needle.length === 0) return -1;
    const last = this.length - needle.length;
    for (let i = Math.max(0, from); i <= last; i++) {
      let hit = true;
      for (let j = 0; j < needle.length; j++) {
        if (this.bytes[i + j] !== needle[j]) { hit = false; break; }
      }
      if (hit) return i;
    }
    return -1;
  }
}

/** ASCII byte sequence for a string literal, for building signature tables. */
export function asciiBytes(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0));
}
