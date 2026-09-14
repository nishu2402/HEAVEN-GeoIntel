// ── Executables: PE, ELF, Mach-O, Java class, WebAssembly ───────────────────
//
// A compiled binary is one of the most talkative files there is, and none of it
// is metadata anyone chose to attach:
//
//   * a Windows PE records the exact second it was linked, which architecture
//     and subsystem it targets, whether it is signed, which DLLs it calls into,
//     and, in its debug directory, the full path of the symbol file on the
//     machine that built it. That path routinely contains a developer's account
//     name, their project layout and their build configuration.
//   * an ELF names its interpreter, its build id, and in the .comment section
//     the exact compiler version that produced it.
//   * a Mach-O carries a UUID that identifies the exact build, the minimum
//     macOS or iOS version it will run on, the SDK it was built against, and
//     the libraries it links.
//
// Everything here is read from the file's own structures with bounded reads. A
// truncated or hostile binary yields fewer fields and never a throw, and no
// field is a judgement about the file: these are facts about how it was built.

import { Reader } from "./bytes";
import type { Extraction, MetaField } from "./types";

const push = (fields: MetaField[], label: string, value: string | null, group: string, sensitive?: boolean) => {
  if (value !== null && value !== "") fields.push({ label, value, group, sensitive });
};

const MAX_UNIX = 32503680000; // year ~3000; beyond this is not a real timestamp

/** Little-endian reads for a span the caller has already bounds-checked. */
const le16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const le32 = (b: Uint8Array, o: number) => b[o] + b[o + 1] * 0x100 + b[o + 2] * 0x10000 + b[o + 3] * 0x1000000;

/** Unix seconds to "YYYY-MM-DD HH:MM:SS" UTC, or null when unset or absurd. */
function unixDate(sec: number | null): string | null {
  if (sec === null || sec <= 0 || sec > MAX_UNIX) return null;
  return new Date(sec * 1000).toISOString().replace("T", " ").slice(0, 19);
}

/** A NUL-terminated ASCII string at `off`, bounded by `max` bytes. */
function cString(r: Reader, off: number, max = 512): string | null {
  const slice = r.slice(off, Math.min(max, Math.max(0, r.length - off)));
  if (!slice) return null;
  let end = 0;
  while (end < slice.length && slice[end] !== 0) end++;
  const s = new TextDecoder("latin1").decode(slice.subarray(0, end)).trim();
  return s.length ? s : null;
}

// ── Windows PE ───────────────────────────────────────────────────────────────

const PE_MACHINE: Record<number, string> = {
  0x014c: "x86 (32-bit)", 0x8664: "x86-64", 0x01c0: "ARM", 0xaa64: "ARM64",
  0x01c4: "ARMv7 (Thumb-2)", 0x0200: "Itanium", 0x5032: "RISC-V 32", 0x5064: "RISC-V 64",
};

const PE_SUBSYSTEM: Record<number, string> = {
  1: "native (driver)", 2: "Windows GUI", 3: "Windows console", 5: "OS/2 console",
  7: "POSIX console", 9: "Windows CE GUI", 10: "EFI application", 16: "Windows boot application",
};

// Mitigations the loader honours. Their absence in a modern binary is as
// notable as their presence, so all three are reported either way.
const DLL_FLAGS: { bit: number; name: string }[] = [
  { bit: 0x0040, name: "ASLR" },
  { bit: 0x0100, name: "DEP" },
  { bit: 0x4000, name: "Control Flow Guard" },
];

/** Map a relative virtual address to a file offset using the section table. */
function rvaToOffset(sections: { rva: number; size: number; raw: number }[], rva: number): number | null {
  for (const s of sections) {
    if (rva >= s.rva && rva < s.rva + s.size) return s.raw + (rva - s.rva);
  }
  return null;
}

/** The PDB path a Microsoft linker writes into the debug directory. */
function pdbPath(r: Reader, sections: { rva: number; size: number; raw: number }[], dirRva: number, dirSize: number): string | null {
  const base = rvaToOffset(sections, dirRva);
  if (base === null) return null;
  for (let i = 0; i + 28 <= dirSize; i += 28) {
    if (r.u32(base + i + 12, true) !== 2) continue; // only the CodeView entry
    const at = r.u32(base + i + 24, true);
    if (at === null || r.ascii(at, 4) !== "RSDS") continue;
    return cString(r, at + 24, 260); // GUID (16) + age (4) then the path
  }
  return null;
}

/** The DLL names in the import table, which say what the binary calls into. */
function importedDlls(r: Reader, sections: { rva: number; size: number; raw: number }[], rva: number): string[] {
  const base = rvaToOffset(sections, rva);
  if (base === null) return [];
  const out: string[] = [];
  // Each descriptor is 20 bytes and the table ends at an all-zero one.
  for (let i = 0; out.length < 16; i++) {
    const nameRva = r.u32(base + i * 20 + 12, true);
    if (nameRva === null || nameRva === 0) break;
    const at = rvaToOffset(sections, nameRva);
    const name = at === null ? null : cString(r, at, 128);
    if (name === null) break;
    out.push(name);
  }
  return out;
}

// The COFF header plus the fields of the optional header read below. One
// length check against this licenses every fixed read that follows.
const PE_HEADER_MIN = 24 + 96;

function extractPe(r: Reader): Extraction {
  const fields: MetaField[] = [];
  const notes: string[] = [];
  const peOff = r.u32(0x3c, true);
  if (peOff === null || r.ascii(peOff, 2) !== "PE") {
    return { fields, notes: ["This file starts like a DOS/Windows executable but carries no PE header."] };
  }
  if (r.length < peOff + PE_HEADER_MIN) {
    return { fields, notes: ["This PE header is truncated, so the file describes nothing about how it was built."] };
  }

  const b = r.bytes;
  const machine = le16(b, peOff + 4);
  const sectionCount = le16(b, peOff + 6);
  const optionalSize = le16(b, peOff + 20);
  push(fields, "Architecture", PE_MACHINE[machine] ?? `machine 0x${machine.toString(16)}`, "Build");

  // The link timestamp. Reproducible builds deliberately set it to a fixed
  // value, so it is stated as what the header says rather than as a fact about
  // when the file was made.
  push(fields, "Linked", unixDate(le32(b, peOff + 8)), "Build", true);

  const opt = peOff + 24;
  const plus = le16(b, opt) === 0x20b;
  push(fields, "Format", plus ? "PE32+ (64-bit)" : "PE32 (32-bit)", "Build");
  const linkerMajor = b[opt + 2];
  if (linkerMajor > 0) push(fields, "Linker version", `${linkerMajor}.${b[opt + 3]}`, "Build");
  const subsystem = le16(b, opt + 68);
  push(fields, "Subsystem", PE_SUBSYSTEM[subsystem] ?? `subsystem ${subsystem}`, "Build");

  const dllFlags = le16(b, opt + 70);
  const on = DLL_FLAGS.filter((f) => (dllFlags & f.bit) !== 0).map((f) => f.name);
  const off = DLL_FLAGS.filter((f) => (dllFlags & f.bit) === 0).map((f) => f.name);
  push(fields, "Mitigations", on.length ? on.join(", ") : "none declared", "Build");
  if (off.length) push(fields, "Mitigations absent", off.join(", "), "Build");

  // Section headers follow the optional header and are what an RVA resolves
  // against, so they are read before anything that needs one.
  const sectionBase = opt + optionalSize;
  const sections: { name: string; rva: number; size: number; raw: number }[] = [];
  for (let i = 0; i < Math.min(sectionCount, 96); i++) {
    const at = sectionBase + i * 40;
    const name = r.ascii(at, 8);
    const size = r.u32(at + 8, true);
    const rva = r.u32(at + 12, true);
    const raw = r.u32(at + 20, true);
    if (name === null || size === null || rva === null || raw === null) break;
    sections.push({ name, rva, size, raw });
  }
  if (sections.length) push(fields, "Sections", sections.map((s) => s.name).join(", "), "Build");

  // The data directories: sixteen RVA/size pairs, whose position depends on the
  // optional header's width. A file that stops short of them simply has none.
  const dirBase = opt + (plus ? 112 : 96);
  if (r.length < dirBase + 16 * 8) return { fields, notes };

  const signatureSize = le32(b, dirBase + 4 * 8 + 4);
  push(fields, "Authenticode signature", signatureSize > 0 ? "present" : "none", "Build");

  const debugRva = le32(b, dirBase + 6 * 8);
  const debugSize = le32(b, dirBase + 6 * 8 + 4);
  if (debugRva > 0) {
    const pdb = pdbPath(r, sections, debugRva, debugSize);
    if (pdb) {
      push(fields, "Symbol file path", pdb, "Build", true);
      notes.push("The symbol-file path is the location of the debug database on the machine that built this binary. It often contains the developer's account name and their project layout.");
    }
  }

  const importRva = le32(b, dirBase + 8);
  if (importRva > 0) {
    const dlls = importedDlls(r, sections, importRva);
    if (dlls.length) push(fields, "Imports", dlls.join(", "), "Build");
  }
  return { fields, notes };
}

// ── ELF ──────────────────────────────────────────────────────────────────────

const ELF_TYPE: Record<number, string> = {
  1: "relocatable object", 2: "executable", 3: "shared object / PIE", 4: "core dump",
};

const ELF_MACHINE: Record<number, string> = {
  3: "x86 (32-bit)", 40: "ARM", 62: "x86-64", 183: "ARM64", 243: "RISC-V", 8: "MIPS", 21: "PowerPC 64",
};

const ELF_OSABI: Record<number, string> = {
  0: "System V", 3: "Linux", 6: "Solaris", 9: "FreeBSD", 12: "OpenBSD", 97: "ARM",
};

// A 64-bit ELF header is 64 bytes and a 32-bit one 52. Requiring the larger
// costs nothing real: a file of 52 to 63 bytes has a header and no contents.
const ELF_HEADER_MIN = 64;

function extractElf(r: Reader): Extraction {
  const fields: MetaField[] = [];
  if (r.length < ELF_HEADER_MIN) return { fields };
  const b = r.bytes;
  const is64 = b[4] === 2;
  const le = b[5] === 1;
  const u16 = (o: number) => (le ? le16(b, o) : (b[o] << 8) | b[o + 1]);
  push(fields, "Format", `ELF ${is64 ? "64-bit" : "32-bit"} ${le ? "little-endian" : "big-endian"}`, "Build");
  push(fields, "Target ABI", ELF_OSABI[b[7]] ?? `ABI ${b[7]}`, "Build");
  const type = u16(16);
  push(fields, "Kind", ELF_TYPE[type] ?? `type ${type}`, "Build");
  const machine = u16(18);
  push(fields, "Architecture", ELF_MACHINE[machine] ?? `machine ${machine}`, "Build");

  // Section headers: their names live in one string table, and the names alone
  // say whether the binary was stripped and what the toolchain left behind.
  const shoff = is64 ? r.u64(0x28, le) : r.u32(0x20, le);
  const shentsize = u16(is64 ? 0x3a : 0x2e);
  const shnum = u16(is64 ? 0x3c : 0x30);
  const shstrndx = u16(is64 ? 0x3e : 0x32);
  // One check that the whole table is present, so every entry below reads
  // directly: a file that stops inside its section table describes no sections.
  if (shoff === null || shnum === 0 || shentsize === 0 || r.length < shoff + shnum * shentsize) return { fields };

  const entryAt = (i: number) => shoff + i * shentsize;
  // Section offsets are 64-bit in a 64-bit ELF, but a real one never exceeds
  // what a Number holds exactly, so only the low word is needed.
  const u32At = (o: number) => (le ? le32(b, o) : b[o] * 0x1000000 + b[o + 1] * 0x10000 + b[o + 2] * 0x100 + b[o + 3]);
  const offsetOf = (i: number) => u32At(entryAt(i) + (is64 ? 0x18 : 0x10));
  const strTabOff = offsetOf(shstrndx);

  const names: string[] = [];
  let comment: string | null = null;
  for (let i = 0; i < Math.min(shnum, 128); i++) {
    const name = cString(r, strTabOff + u32At(entryAt(i)), 64);
    if (name === null) continue; // an unnamed section says nothing
    names.push(name);
    if (name === ".comment") comment = cString(r, offsetOf(i), 256);
  }

  // .comment is where GCC and Clang stamp their own version string.
  push(fields, "Built with", comment, "Build", true);
  push(fields, "Debug symbols", names.some((n) => n.startsWith(".debug")) ? "present (not stripped)" : "stripped", "Build");
  if (names.includes(".note.gnu.build-id")) push(fields, "Build id", "present", "Build");
  if (names.length) push(fields, "Sections", `${names.length} (${names.slice(0, 10).join(", ")})`, "Build");
  return { fields };
}

// ── Mach-O ───────────────────────────────────────────────────────────────────

const MACHO_CPU: Record<number, string> = {
  7: "x86 (32-bit)", 0x01000007: "x86-64", 12: "ARM", 0x0100000c: "ARM64", 18: "PowerPC",
};

const MACHO_FILETYPE: Record<number, string> = {
  1: "relocatable object", 2: "executable", 6: "dynamic library", 8: "bundle", 10: "debug symbols",
};

const LC_UUID = 0x1b;
const LC_LOAD_DYLIB = 0x0c;
const LC_RPATH = 0x8000001c;
const LC_CODE_SIGNATURE = 0x1d;
const LC_BUILD_VERSION = 0x32;

/**
 * The string embedded in a load command. Mach-O stores it as an offset from the
 * start of the command, so the offset has to land past the command's own header
 * and inside its declared size: anything else would read neighbouring bytes and
 * report them as a path.
 */
function lcString(r: Reader, p: number, size: number, le: boolean): string | null {
  const off = r.u32(p + 8, le);
  if (off === null || off < 12 || off >= size) return null;
  return cString(r, p + off, 256);
}

const PLATFORM: Record<number, string> = {
  1: "macOS", 2: "iOS", 3: "tvOS", 4: "watchOS", 6: "Mac Catalyst", 7: "iOS Simulator",
};

/** An Apple packed version (xxxx.yy.zz) as a dotted string. */
const appleVersion = (v: number) => `${v >> 16}.${(v >> 8) & 0xff}.${v & 0xff}`;

// Everything read directly from the header sits in its first 20 bytes; the
// load commands past that are bounds-checked as they are walked.
const MACHO_HEADER_MIN = 20;

function extractMachO(r: Reader): Extraction {
  const fields: MetaField[] = [];
  if (r.length < MACHO_HEADER_MIN) return { fields };
  const b = r.bytes;
  // The four magics differ only in width and byte order, and the two reversed
  // ones ("cffaedfe" read big-endian) mean the file itself is little-endian.
  // Shifting a byte of 0xcf into the top of a 32-bit word makes it negative,
  // so the value is coerced back to unsigned before it is compared.
  const magic = (((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0);
  const le = magic === 0xcefaedfe || magic === 0xcffaedfe;
  const is64 = magic === 0xfeedfacf || magic === 0xcffaedfe;
  const u32 = (o: number) => (le ? le32(b, o) : b[o] * 0x1000000 + b[o + 1] * 0x10000 + b[o + 2] * 0x100 + b[o + 3]);
  push(fields, "Format", `Mach-O ${is64 ? "64-bit" : "32-bit"}`, "Build");
  const cpu = u32(4);
  push(fields, "Architecture", MACHO_CPU[cpu] ?? `cpu ${cpu}`, "Build");
  const filetype = u32(12);
  push(fields, "Kind", MACHO_FILETYPE[filetype] ?? `type ${filetype}`, "Build");

  const ncmds = u32(16);
  let p = is64 ? 32 : 28;
  const dylibs: string[] = [];
  const rpaths: string[] = [];
  let signed = false;
  for (let i = 0; i < Math.min(ncmds, 512); i++) {
    const cmd = r.u32(p, le);
    const size = r.u32(p + 4, le);
    if (cmd === null || size === null || size < 8) break;
    if (cmd === LC_UUID) {
      const raw = r.slice(p + 8, 16);
      if (raw) push(fields, "Build UUID", [...raw].map((b) => b.toString(16).padStart(2, "0")).join(""), "Build", true);
    } else if (cmd === LC_LOAD_DYLIB) {
      const name = lcString(r, p, size, le);
      if (name && dylibs.length < 12) dylibs.push(name);
    } else if (cmd === LC_RPATH) {
      const path = lcString(r, p, size, le);
      if (path && rpaths.length < 6) rpaths.push(path);
    } else if (cmd === LC_CODE_SIGNATURE) {
      signed = true;
    } else if (cmd === LC_BUILD_VERSION) {
      const platform = r.u32(p + 8, le);
      const minos = r.u32(p + 12, le);
      const sdk = r.u32(p + 16, le);
      if (platform !== null && minos !== null && sdk !== null) {
        push(fields, "Platform", PLATFORM[platform] ?? `platform ${platform}`, "Build");
        push(fields, "Minimum OS", appleVersion(minos), "Build");
        push(fields, "Built against SDK", appleVersion(sdk), "Build");
      }
    }
    p += size;
  }

  push(fields, "Code signature", signed ? "present" : "none", "Build");
  if (dylibs.length) push(fields, "Links against", dylibs.join(", "), "Build");
  // An rpath is a search path baked in at link time, and it frequently points
  // at a directory that only existed on the build machine.
  if (rpaths.length) push(fields, "Runtime search paths", rpaths.join(", "), "Build", true);
  return { fields };
}

// ── Java class and WebAssembly ───────────────────────────────────────────────

// Class-file major versions map one-to-one onto Java releases: 45 is Java 1.1
// and every release since has added one.
function javaRelease(major: number): string | null {
  if (major < 45 || major > 100) return null;
  return major <= 48 ? `Java 1.${major - 44}` : `Java ${major - 44}`;
}

function extractClass(r: Reader): Extraction {
  const fields: MetaField[] = [];
  const minor = r.u16(4);
  const major = r.u16(6);
  if (major === null || minor === null) return { fields }; // a stub, not a class file
  push(fields, "Class file version", `${major}.${minor}`, "Build");
  push(fields, "Compiled for", javaRelease(major), "Build");
  return { fields };
}

function extractWasm(r: Reader): Extraction {
  const fields: MetaField[] = [];
  const version = r.u32(4, true);
  push(fields, "Binary format version", version === null ? null : String(version), "Build");
  // The "producers" custom section names the language and toolchain, and is
  // written by Rust, Emscripten and wasm-bindgen without being asked.
  const at = r.indexOf([0x09, ...[..."producers"].map((c) => c.charCodeAt(0))]);
  if (at >= 0) {
    // The section is a length-prefixed name/value list; the values are the only
    // readable part, so the run is filtered down to its printable characters.
    // subarray clamps to the buffer, so a section at the very end reads empty.
    const raw = r.bytes.subarray(at + 10, Math.min(at + 266, r.length));
    const readable = new TextDecoder("latin1").decode(raw).replace(/[^\x20-\x7e]+/g, " ").trim();
    push(fields, "Producers", readable.slice(0, 200), "Build", true);
  }
  return { fields };
}

/** Metadata for a compiled binary identified as `kind`. */
export function extractBinary(kind: string, bytes: Uint8Array): Extraction {
  const r = new Reader(bytes);
  if (kind === "pe") return extractPe(r);
  if (kind === "elf") return extractElf(r);
  if (kind === "macho") return extractMachO(r);
  if (kind === "class") return extractClass(r);
  if (kind === "wasm") return extractWasm(r);
  return { fields: [] };
}
