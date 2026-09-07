import { describe, it, expect } from "vitest";
import { Reader, asciiBytes } from "@/lib/analysis/meta/bytes";

const bytes = (...n: number[]) => new Uint8Array(n);

describe("meta/bytes Reader", () => {
  it("reads integers in both endiannesses", () => {
    const r = new Reader(bytes(0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0));
    expect(r.length).toBe(8);
    expect(r.u8(0)).toBe(0x12);
    expect(r.u16(0)).toBe(0x1234);
    expect(r.u16(0, true)).toBe(0x3412);
    expect(r.u32(0)).toBe(0x12345678);
    expect(r.u32(0, true)).toBe(0x78563412);
  });

  it("reads 64-bit values as exact Numbers in both endiannesses", () => {
    const r = new Reader(bytes(0, 0, 0, 1, 0, 0, 0, 2));
    expect(r.u64(0)).toBe(0x1_0000_0000 + 2);
    const le = new Reader(bytes(2, 0, 0, 0, 1, 0, 0, 0));
    expect(le.u64(0, true)).toBe(0x1_0000_0000 + 2);
  });

  it("returns null for every out-of-range read", () => {
    const r = new Reader(bytes(1, 2));
    expect(r.u8(-1)).toBeNull();
    expect(r.u8(2)).toBeNull();
    expect(r.u16(1)).toBeNull();
    expect(r.u32(0)).toBeNull();
    expect(r.u64(0)).toBeNull();
    expect(r.ascii(-1, 1)).toBeNull();
    expect(r.ascii(0, -1)).toBeNull();
    expect(r.ascii(0, 5)).toBeNull();
    expect(r.slice(0, 5)).toBeNull();
    expect(r.utf8(0, 9)).toBeNull();
  });

  it("reads ASCII, stopping at NUL and trimming, null when empty", () => {
    const r = new Reader(new Uint8Array([...asciiBytes(" hi "), 0, 0x41]));
    expect(r.ascii(0, 6)).toBe("hi");
    const blank = new Reader(new Uint8Array([0x20, 0x20]));
    expect(blank.ascii(0, 2)).toBeNull();
    const nul = new Reader(new Uint8Array([0, 0x41]));
    expect(nul.ascii(0, 2)).toBeNull();
  });

  it("reads UTF-8, dropping trailing NUL padding, null when empty", () => {
    const r = new Reader(new Uint8Array([0xc3, 0xa9, 0x20, 0, 0])); // "é " + padding
    expect(r.utf8(0, 5)).toBe("é");
    const empty = new Reader(new Uint8Array([0, 0]));
    expect(empty.utf8(0, 2)).toBeNull();
  });

  it("compares byte signatures with bounds safety", () => {
    const r = new Reader(bytes(0x50, 0x4b, 0x03, 0x04));
    expect(r.eq(0, [0x50, 0x4b])).toBe(true);
    expect(r.eq(0, [0x50, 0x4c])).toBe(false);
    expect(r.eq(-1, [0x50])).toBe(false);
    expect(r.eq(2, [0x03, 0x04, 0x05])).toBe(false); // runs past the end
  });

  it("finds byte sequences and reports absence", () => {
    const r = new Reader(new Uint8Array(asciiBytes("abcXYZabc")));
    expect(r.indexOf(asciiBytes("XYZ"))).toBe(3);
    expect(r.indexOf(asciiBytes("abc"), 1)).toBe(6);
    expect(r.indexOf(asciiBytes("nope"))).toBe(-1);
    expect(r.indexOf([])).toBe(-1);
    expect(r.indexOf(asciiBytes("c"), -5)).toBe(2); // negative `from` clamps to 0
  });
});
