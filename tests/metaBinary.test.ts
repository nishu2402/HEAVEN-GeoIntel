import { describe, it, expect } from "vitest";
import { extractBinary } from "@/lib/analysis/meta/binary";

const u16le = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u16be = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u32le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const u32be = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const u64le = (n: number) => [...u32le(n), 0, 0, 0, 0];
const A = (s: string) => [...s].map((c) => c.charCodeAt(0));
const Z = (s: string, len: number) => [...A(s).slice(0, len), ...new Array(Math.max(0, len - s.length)).fill(0)];
const U8 = (...parts: number[][]) => new Uint8Array(parts.flat());
const val = (r: { fields: { label: string; value: string }[] }, label: string) =>
  r.fields.find((f) => f.label === label)?.value;

// ── A Windows PE, laid out at fixed offsets ─────────────────────────────────
//
// The DOS stub ends at 0x40, the PE signature follows, then the COFF header,
// the optional header (with its data directories), and the section table. The
// builder keeps those offsets so the parser is exercised against a real layout
// rather than a convenient one.

const PE_OFF = 0x40;
const OPT_SIZE = 240;

interface PeSpec {
  machine?: number;
  timestamp?: number;
  magic?: number;
  subsystem?: number;
  dllFlags?: number;
  linker?: [number, number];
  signatureSize?: number;
  sections?: { name: string; rva: number; size: number; raw: number }[];
  debug?: { rva: number; size: number };
  imports?: number;
  trailer?: number[];
  noPeHeader?: boolean;
}

function buildPe(spec: PeSpec = {}): Uint8Array {
  const sections = spec.sections ?? [{ name: ".text", rva: 0x1000, size: 0x1000, raw: 0x400 }];
  const dos = [...A("MZ"), ...new Array(0x3a).fill(0), ...u32le(PE_OFF)];

  const optional = new Array(OPT_SIZE).fill(0);
  const putOpt = (off: number, bytes: number[]) => bytes.forEach((b, i) => (optional[off + i] = b));
  putOpt(0, u16le(spec.magic ?? 0x20b));
  putOpt(2, spec.linker ?? [14, 36]);
  putOpt(68, u16le(spec.subsystem ?? 3));
  putOpt(70, u16le(spec.dllFlags ?? 0x0040 | 0x0100 | 0x4000));
  // Data directories start at 112 for PE32+ and 96 for PE32; entry 1 is the
  // import table, 4 the certificate table and 6 the debug directory.
  const dirBase = (spec.magic ?? 0x20b) === 0x20b ? 112 : 96;
  putOpt(dirBase + 8, u32le(spec.imports ?? 0));
  putOpt(dirBase + 4 * 8 + 4, u32le(spec.signatureSize ?? 0));
  putOpt(dirBase + 6 * 8, u32le(spec.debug?.rva ?? 0));
  putOpt(dirBase + 6 * 8 + 4, u32le(spec.debug?.size ?? 0));

  const coff = [
    ...u16le(spec.machine ?? 0x8664), ...u16le(sections.length),
    ...u32le(spec.timestamp ?? 0), ...u32le(0), ...u32le(0),
    ...u16le(OPT_SIZE), ...u16le(0x22),
  ];
  const table = sections.flatMap((s) => [
    ...Z(s.name, 8), ...u32le(s.size), ...u32le(s.rva), ...u32le(s.size), ...u32le(s.raw),
    ...u32le(0), ...u32le(0), ...u16le(0), ...u16le(0), ...u32le(0x60000020),
  ]);

  const head = spec.noPeHeader
    ? [...dos, ...new Array(64).fill(0)]
    : [...dos, ...A("PE"), 0, 0, ...coff, ...optional, ...table];
  const pad = new Array(Math.max(0, 0x400 - head.length)).fill(0);
  return U8(head, pad, spec.trailer ?? []);
}

describe("meta/binary Windows PE", () => {
  it("reads the architecture, link time, subsystem and mitigations", () => {
    const r = extractBinary("pe", buildPe({ timestamp: 1709374500 }));
    expect(val(r, "Architecture")).toBe("x86-64");
    expect(val(r, "Format")).toBe("PE32+ (64-bit)");
    expect(val(r, "Linked")).toBe("2024-03-02 10:15:00");
    expect(val(r, "Linker version")).toBe("14.36");
    expect(val(r, "Subsystem")).toBe("Windows console");
    expect(val(r, "Mitigations")).toBe("ASLR, DEP, Control Flow Guard");
    expect(val(r, "Mitigations absent")).toBeUndefined();
    expect(val(r, "Sections")).toBe(".text");
    expect(val(r, "Authenticode signature")).toBe("none");
    expect(r.fields.find((f) => f.label === "Linked")?.sensitive).toBe(true);
  });

  it("names a binary with no mitigations and a 32-bit one", () => {
    const r = extractBinary("pe", buildPe({ magic: 0x10b, machine: 0x014c, dllFlags: 0, subsystem: 2, linker: [0, 0] }));
    expect(val(r, "Format")).toBe("PE32 (32-bit)");
    expect(val(r, "Architecture")).toBe("x86 (32-bit)");
    expect(val(r, "Subsystem")).toBe("Windows GUI");
    expect(val(r, "Mitigations")).toBe("none declared");
    expect(val(r, "Mitigations absent")).toBe("ASLR, DEP, Control Flow Guard");
    expect(val(r, "Linker version")).toBeUndefined(); // version 0.0 states nothing
  });

  it("reports an unmapped machine and subsystem by their numbers", () => {
    const r = extractBinary("pe", buildPe({ machine: 0x1234, subsystem: 99 }));
    expect(val(r, "Architecture")).toBe("machine 0x1234");
    expect(val(r, "Subsystem")).toBe("subsystem 99");
  });

  it("reports a signed binary and an unset link timestamp", () => {
    const r = extractBinary("pe", buildPe({ signatureSize: 9216, timestamp: 0 }));
    expect(val(r, "Authenticode signature")).toBe("present");
    expect(val(r, "Linked")).toBeUndefined();
  });

  it("reads the symbol-file path out of the debug directory", () => {
    // One debug entry of type 2 (CodeView) pointing at an RSDS record whose
    // path follows a 16-byte GUID and a 4-byte age.
    const pdb = "C:\\\\Users\\\\jsmith\\\\source\\\\repos\\\\Billing\\\\obj\\\\Release\\\\Billing.pdb";
    const rsds = [...A("RSDS"), ...new Array(16).fill(0xab), ...u32le(1), ...A(pdb), 0];
    const debugEntry = [
      ...u32le(0), ...u32le(0), ...u16le(0), ...u16le(0),
      ...u32le(2), ...u32le(rsds.length), ...u32le(0x2100), ...u32le(0x500),
    ];
    // Section .rdata maps RVA 0x2000 to file offset 0x400.
    const sections = [{ name: ".rdata", rva: 0x2000, size: 0x1000, raw: 0x400 }];
    const trailer = [...debugEntry, ...new Array(0x500 - 0x400 - debugEntry.length).fill(0), ...rsds];
    const r = extractBinary("pe", buildPe({ sections, debug: { rva: 0x2000, size: 28 }, trailer }));
    expect(val(r, "Symbol file path")).toContain("jsmith");
    expect(r.fields.find((f) => f.label === "Symbol file path")?.sensitive).toBe(true);
    expect((r.notes ?? []).some((n) => /account name/.test(n))).toBe(true);
  });

  it("skips a debug directory that names nothing readable", () => {
    // A debug entry of a type that is not CodeView, then one whose record is
    // not an RSDS, then a directory whose RVA no section covers.
    const other = [...u32le(0), ...u32le(0), ...u16le(0), ...u16le(0), ...u32le(1), ...u32le(4), ...u32le(0x2100), ...u32le(0x500)];
    const cv = [...u32le(0), ...u32le(0), ...u16le(0), ...u16le(0), ...u32le(2), ...u32le(4), ...u32le(0x2100), ...u32le(0x500)];
    const sections = [{ name: ".rdata", rva: 0x2000, size: 0x1000, raw: 0x400 }];
    const trailer = [...other, ...cv, ...new Array(64).fill(0)];
    expect(val(extractBinary("pe", buildPe({ sections, debug: { rva: 0x2000, size: 56 }, trailer })), "Symbol file path")).toBeUndefined();
    expect(val(extractBinary("pe", buildPe({ debug: { rva: 0x9000, size: 28 } })), "Symbol file path")).toBeUndefined();
  });

  it("lists the DLLs the binary imports", () => {
    const names = ["KERNEL32.dll", "ADVAPI32.dll", "WS2_32.dll"];
    // Import descriptors at RVA 0x2000 (file 0x400); each name RVA points
    // further into the same section.
    let nameRva = 0x2000 + 20 * (names.length + 1);
    const descriptors: number[] = [];
    const blob: number[] = [];
    for (const n of names) {
      descriptors.push(...u32le(0), ...u32le(0), ...u32le(0), ...u32le(nameRva), ...u32le(0));
      blob.push(...A(n), 0);
      nameRva += n.length + 1;
    }
    descriptors.push(...new Array(20).fill(0)); // the all-zero terminator
    const sections = [{ name: ".idata", rva: 0x2000, size: 0x1000, raw: 0x400 }];
    const r = extractBinary("pe", buildPe({ sections, imports: 0x2000, trailer: [...descriptors, ...blob] }));
    expect(val(r, "Imports")).toBe("KERNEL32.dll, ADVAPI32.dll, WS2_32.dll");
  });

  it("stops on an import table it cannot follow", () => {
    // A descriptor whose name RVA falls outside every section.
    const descriptors = [...u32le(0), ...u32le(0), ...u32le(0), ...u32le(0x9999), ...u32le(0)];
    const sections = [{ name: ".idata", rva: 0x2000, size: 0x1000, raw: 0x400 }];
    expect(val(extractBinary("pe", buildPe({ sections, imports: 0x2000, trailer: descriptors })), "Imports")).toBeUndefined();
    // And an import directory RVA that no section covers at all.
    expect(val(extractBinary("pe", buildPe({ imports: 0x9000 })), "Imports")).toBeUndefined();
  });

  it("stops reading a section table the file ends inside", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ name: `.s${i}`, rva: 0x1000 * (i + 1), size: 0x100, raw: 0x400 }));
    const full = buildPe({ sections: many });
    const cut = extractBinary("pe", full.subarray(0, PE_OFF + 24 + OPT_SIZE + 40 * 3 + 10));
    expect(val(cut, "Sections")?.split(", ").length).toBeLessThan(8);
  });

  it("says plainly when a DOS executable has no PE header", () => {
    const r = extractBinary("pe", buildPe({ noPeHeader: true }));
    expect(r.fields).toHaveLength(0);
    expect((r.notes ?? [])[0]).toMatch(/no PE header/);
    expect(extractBinary("pe", U8(A("MZ"))).fields).toHaveLength(0);
  });
});

// ── ELF ──────────────────────────────────────────────────────────────────────

interface ElfSection { name: string; offset?: number; data?: number[] }

/** A 64-bit little-endian ELF with a section table and a string table. */
function buildElf(sections: ElfSection[], opts: { is64?: boolean; le?: boolean; type?: number; machine?: number; osabi?: number } = {}): Uint8Array {
  const is64 = opts.is64 ?? true;
  const entrySize = is64 ? 64 : 40;
  const all = [...sections, { name: ".shstrtab" }];

  // The string table: every name, NUL-terminated, with its offset recorded.
  const strtab: number[] = [0];
  const nameOffsets = all.map((s) => {
    const at = strtab.length;
    strtab.push(...A(s.name), 0);
    return at;
  });

  const headerSize = is64 ? 64 : 52;
  const shoff = headerSize;
  const tableBytes = entrySize * all.length;
  let dataAt = shoff + tableBytes;
  const payloads: number[] = [];
  const dataOffsets = all.map((s, i) => {
    const body = i === all.length - 1 ? strtab : (s.data ?? []);
    const at = dataAt;
    payloads.push(...body);
    dataAt += body.length;
    return at;
  });

  const w32 = (n: number) => (opts.le === false ? u32be(n) : u32le(n));
  const table = all.flatMap((_, i) => {
    const e = new Array(entrySize).fill(0);
    const put = (off: number, bytes: number[]) => bytes.forEach((b, j) => (e[off + j] = b));
    put(0, w32(nameOffsets[i]));
    put(is64 ? 0x18 : 0x10, is64 ? u64le(dataOffsets[i]) : w32(dataOffsets[i]));
    return e;
  });

  const le = opts.le !== false;
  const w16 = (n: number) => (le ? u16le(n) : u16be(n));
  const header = new Array(headerSize).fill(0);
  const put = (off: number, bytes: number[]) => bytes.forEach((b, i) => (header[off + i] = b));
  put(0, [0x7f, ...A("ELF")]);
  put(4, [is64 ? 2 : 1, le ? 1 : 2, 1, opts.osabi ?? 0]);
  put(16, w16(opts.type ?? 2));
  put(18, w16(opts.machine ?? 62));
  put(is64 ? 0x28 : 0x20, is64 ? u64le(shoff) : w32(shoff));
  put(is64 ? 0x3a : 0x2e, w16(entrySize));
  put(is64 ? 0x3c : 0x30, w16(all.length));
  put(is64 ? 0x3e : 0x32, w16(all.length - 1));
  return U8(header, table, payloads);
}

describe("meta/binary ELF", () => {
  it("reads the class, ABI, kind, architecture and section names", () => {
    const r = extractBinary("elf", buildElf([{ name: ".text" }, { name: ".note.gnu.build-id" }], { osabi: 3 }));
    expect(val(r, "Format")).toBe("ELF 64-bit little-endian");
    expect(val(r, "Target ABI")).toBe("Linux");
    expect(val(r, "Kind")).toBe("executable");
    expect(val(r, "Architecture")).toBe("x86-64");
    expect(val(r, "Build id")).toBe("present");
    expect(val(r, "Sections")).toBe("3 (.text, .note.gnu.build-id, .shstrtab)");
  });

  it("reads the compiler version out of the .comment section", () => {
    const comment = { name: ".comment", data: [...A("GCC: (Debian 12.2.0-14) 12.2.0"), 0] };
    const r = extractBinary("elf", buildElf([{ name: ".text" }, comment]));
    expect(val(r, "Built with")).toBe("GCC: (Debian 12.2.0-14) 12.2.0");
    expect(r.fields.find((f) => f.label === "Built with")?.sensitive).toBe(true);
  });

  it("reports whether the binary was stripped", () => {
    const withDebug = extractBinary("elf", buildElf([{ name: ".debug_info" }]));
    expect(val(withDebug, "Debug symbols")).toBe("present (not stripped)");
    const stripped = extractBinary("elf", buildElf([{ name: ".text" }]));
    expect(val(stripped, "Debug symbols")).toBe("stripped");
    expect(val(stripped, "Build id")).toBeUndefined();
  });

  it("reads a 32-bit, big-endian and unmapped-value ELF", () => {
    const r = extractBinary("elf", buildElf([{ name: ".text" }], { is64: false, le: false, type: 3, machine: 999, osabi: 99 }));
    expect(val(r, "Format")).toBe("ELF 32-bit big-endian");
    expect(val(r, "Kind")).toBe("shared object / PIE");
    expect(val(r, "Architecture")).toBe("machine 999");
    expect(val(r, "Target ABI")).toBe("ABI 99");
  });

  it("reads only the identification from a file with no section table", () => {
    const bare = buildElf([{ name: ".text" }]).subarray(0, 64);
    const noTable = new Uint8Array(bare);
    noTable[0x3c] = 0; noTable[0x3d] = 0; // section count of zero
    const r = extractBinary("elf", noTable);
    expect(val(r, "Format")).toBe("ELF 64-bit little-endian");
    expect(val(r, "Sections")).toBeUndefined();
  });

  it("stops when the section table or its string table is out of reach", () => {
    const full = buildElf([{ name: ".text" }]);
    // The header survives but the table it points at does not.
    expect(val(extractBinary("elf", full.subarray(0, 64)), "Sections")).toBeUndefined();
    // And a file cut off inside the table itself.
    expect(val(extractBinary("elf", full.subarray(0, 96)), "Sections")).toBeUndefined();
  });
});

// ── Mach-O ───────────────────────────────────────────────────────────────────

interface LoadCommand { cmd: number; payload: number[] }

function buildMachO(cmds: LoadCommand[], opts: { magic?: number; cpu?: number; filetype?: number } = {}): Uint8Array {
  const magic = opts.magic ?? 0xcffaedfe;
  const is64 = magic === 0xfeedfacf || magic === 0xcffaedfe;
  const le = magic === 0xcefaedfe || magic === 0xcffaedfe;
  const w32 = (n: number) => (le ? u32le(n) : u32be(n));
  const body = cmds.flatMap((c) => [...w32(c.cmd), ...w32(8 + c.payload.length), ...c.payload]);
  const header = [
    ...u32be(magic), ...w32(opts.cpu ?? 0x01000007), ...w32(0), ...w32(opts.filetype ?? 2),
    ...w32(cmds.length), ...w32(body.length), ...w32(0), ...(is64 ? w32(0) : []),
  ];
  return U8(header, body);
}

/** A load command whose payload is an offset-prefixed string, as Mach-O stores. */
const stringCmd = (cmd: number, s: string) => ({ cmd, payload: [...u32le(12), ...A(s), 0] });

describe("meta/binary Mach-O", () => {
  it("reads the architecture, kind, UUID, platform and libraries", () => {
    const r = extractBinary("macho", buildMachO([
      { cmd: 0x1b, payload: new Array(16).fill(0xcd) },
      { cmd: 0x32, payload: [...u32le(1), ...u32le((14 << 16) | (4 << 8) | 1), ...u32le((14 << 16) | (5 << 8))] },
      stringCmd(0x0c, "/usr/lib/libSystem.B.dylib"),
      stringCmd(0x0c, "/System/Library/Frameworks/Security.framework/Security"),
      { cmd: 0x1d, payload: [...u32le(0), ...u32le(0)] },
      stringCmd(0x8000001c, "@loader_path/../Frameworks"),
    ]));
    expect(val(r, "Format")).toBe("Mach-O 64-bit");
    expect(val(r, "Architecture")).toBe("x86-64");
    expect(val(r, "Kind")).toBe("executable");
    expect(val(r, "Build UUID")).toBe("cd".repeat(16));
    expect(val(r, "Platform")).toBe("macOS");
    expect(val(r, "Minimum OS")).toBe("14.4.1");
    expect(val(r, "Built against SDK")).toBe("14.5.0");
    expect(val(r, "Code signature")).toBe("present");
    expect(val(r, "Links against")).toContain("libSystem.B.dylib");
    expect(val(r, "Runtime search paths")).toBe("@loader_path/../Frameworks");
    expect(r.fields.find((f) => f.label === "Runtime search paths")?.sensitive).toBe(true);
  });

  it("reads a 32-bit, byte-reversed binary and an unsigned one", () => {
    const r = extractBinary("macho", buildMachO([], { magic: 0xcefaedfe, cpu: 12, filetype: 6 }));
    expect(val(r, "Format")).toBe("Mach-O 32-bit");
    expect(val(r, "Architecture")).toBe("ARM");
    expect(val(r, "Kind")).toBe("dynamic library");
    expect(val(r, "Code signature")).toBe("none");
  });

  it("reports unmapped cpu types, file types and platforms by number", () => {
    const r = extractBinary("macho", buildMachO([
      { cmd: 0x32, payload: [...u32le(99), ...u32le(0), ...u32le(0)] },
    ], { cpu: 555, filetype: 77 }));
    expect(val(r, "Architecture")).toBe("cpu 555");
    expect(val(r, "Kind")).toBe("type 77");
    expect(val(r, "Platform")).toBe("platform 99");
  });

  it("skips load commands it cannot read and caps long lists", () => {
    // A UUID command that claims 16 bytes the file does not hold.
    const short = buildMachO([{ cmd: 0x1b, payload: [1, 2] }]);
    expect(val(extractBinary("macho", short), "Build UUID")).toBeUndefined();
    // A dylib command whose name offset points past the command.
    const badName = buildMachO([{ cmd: 0x0c, payload: [...u32le(9000), 0] }]);
    expect(val(extractBinary("macho", badName), "Links against")).toBeUndefined();
    const badRpath = buildMachO([{ cmd: 0x8000001c, payload: [...u32le(9000), 0] }]);
    expect(val(extractBinary("macho", badRpath), "Runtime search paths")).toBeUndefined();
    // More libraries and search paths than are worth listing.
    const many = buildMachO([
      ...Array.from({ length: 20 }, (_, i) => stringCmd(0x0c, `/usr/lib/lib${i}.dylib`)),
      ...Array.from({ length: 10 }, (_, i) => stringCmd(0x8000001c, `/build/path${i}`)),
    ]);
    expect(val(extractBinary("macho", many), "Links against")?.split(", ")).toHaveLength(12);
    expect(val(extractBinary("macho", many), "Runtime search paths")?.split(", ")).toHaveLength(6);
  });

  it("stops at a load command with an impossible size", () => {
    const broken = U8(
      u32be(0xcffaedfe), u32le(0x01000007), u32le(0), u32le(2), u32le(4), u32le(16), u32le(0), u32le(0),
      u32le(0x1b), u32le(4),
    );
    expect(val(extractBinary("macho", broken), "Build UUID")).toBeUndefined();
    expect(val(extractBinary("macho", broken), "Code signature")).toBe("none");
  });
});

describe("meta/binary Java class and WebAssembly", () => {
  it("maps a class-file version to its Java release", () => {
    const r = extractBinary("class", U8([0xca, 0xfe, 0xba, 0xbe], u16be(0), u16be(61)));
    expect(val(r, "Class file version")).toBe("61.0");
    expect(val(r, "Compiled for")).toBe("Java 17");
    const old = extractBinary("class", U8([0xca, 0xfe, 0xba, 0xbe], u16be(3), u16be(46)));
    expect(val(old, "Compiled for")).toBe("Java 1.2");
  });

  it("states no release for a version outside the known range", () => {
    const r = extractBinary("class", U8([0xca, 0xfe, 0xba, 0xbe], u16be(0), u16be(200)));
    expect(val(r, "Class file version")).toBe("200.0");
    expect(val(r, "Compiled for")).toBeUndefined();
    expect(extractBinary("class", U8([0xca, 0xfe, 0xba, 0xbe])).fields).toHaveLength(0);
  });

  it("reads a WebAssembly module's version and producers section", () => {
    const producers = [0x00, 40, 0x09, ...A("producers"), 0x01, 0x0c, ...A("processed-by"), 0x01, 0x04, ...A("rustc"), 0x06, ...A("1.76.0")];
    const r = extractBinary("wasm", U8([0x00, 0x61, 0x73, 0x6d], u32le(1), producers));
    expect(val(r, "Binary format version")).toBe("1");
    expect(val(r, "Producers")).toContain("rustc");
    expect(r.fields.find((f) => f.label === "Producers")?.sensitive).toBe(true);
  });

  it("reads a module with no producers section, and one with an empty one", () => {
    const r = extractBinary("wasm", U8([0x00, 0x61, 0x73, 0x6d], u32le(1)));
    expect(val(r, "Binary format version")).toBe("1");
    expect(val(r, "Producers")).toBeUndefined();
    const cut = U8([0x00, 0x61, 0x73, 0x6d], u32le(1), [0x09, ...A("producers")]);
    expect(val(extractBinary("wasm", cut), "Producers")).toBeUndefined();
    expect(extractBinary("wasm", U8([0x00, 0x61])).fields).toHaveLength(0);
  });
});

describe("meta/binary dispatch", () => {
  it("returns nothing for a kind it does not handle", () => {
    expect(extractBinary("rpm", new Uint8Array(16)).fields).toHaveLength(0);
  });
});

describe("meta/binary degrades honestly on truncated and unusual files", () => {
  it("says so when a PE header stops short, and when its directories do", () => {
    const full = buildPe();
    const cutHeader = extractBinary("pe", full.subarray(0, PE_OFF + 40));
    expect(cutHeader.fields).toHaveLength(0);
    expect((cutHeader.notes ?? [])[0]).toMatch(/truncated/);
    // Enough for the COFF and the first 96 optional-header bytes, and no more.
    const cutDirs = extractBinary("pe", full.subarray(0, PE_OFF + 24 + 96));
    expect(val(cutDirs, "Architecture")).toBe("x86-64");
    expect(val(cutDirs, "Authenticode signature")).toBeUndefined();
  });

  it("lists no sections for a PE that declares none", () => {
    expect(val(extractBinary("pe", buildPe({ sections: [] })), "Sections")).toBeUndefined();
  });

  it("reads nothing from an ELF or Mach-O header that is not all there", () => {
    expect(extractBinary("elf", U8([0x7f, ...A("ELF")], new Array(40).fill(0))).fields).toHaveLength(0);
    expect(extractBinary("macho", U8(u32be(0xcffaedfe), new Array(8).fill(0))).fields).toHaveLength(0);
  });

  it("names an ELF file type the standard does not define", () => {
    expect(val(extractBinary("elf", buildElf([{ name: ".text" }], { type: 42 })), "Kind")).toBe("type 42");
  });

  it("stops at an ELF section table the file does not hold in full", () => {
    const full = buildElf([{ name: ".text" }, { name: ".data" }]);
    expect(val(extractBinary("elf", full.subarray(0, 140)), "Sections")).toBeUndefined();
    expect(val(extractBinary("elf", full.subarray(0, 140)), "Format")).toBe("ELF 64-bit little-endian");
  });

  it("skips ELF sections with no name, and reports none when that is all of them", () => {
    const withBlank = buildElf([{ name: "" }, { name: ".text" }]);
    expect(val(extractBinary("elf", withBlank), "Sections")).toBe("2 (.text, .shstrtab)");
    // Point every name offset at the string table's leading NUL.
    const allBlank = new Uint8Array(buildElf([{ name: "" }]));
    for (let i = 0; i < 2; i++) allBlank.set([0, 0, 0, 0], 64 + i * 64);
    const r = extractBinary("elf", allBlank);
    expect(val(r, "Sections")).toBeUndefined();
    expect(val(r, "Debug symbols")).toBe("stripped");
  });

  it("reads nothing from an ELF whose string table is past the end of the file", () => {
    const elf = new Uint8Array(buildElf([{ name: ".text" }]));
    // Point the string table's own section at an offset the file does not reach.
    elf.set(u64le(0xffff), 64 + 64 + 0x18);
    expect(val(extractBinary("elf", elf), "Sections")).toBeUndefined();
  });

  it("reads a big-endian Mach-O", () => {
    const r = extractBinary("macho", buildMachO([], { magic: 0xfeedfacf, cpu: 18, filetype: 2 }));
    expect(val(r, "Format")).toBe("Mach-O 64-bit");
    expect(val(r, "Architecture")).toBe("PowerPC");
  });

  it("ignores Mach-O load commands whose payload the file does not hold", () => {
    const header = [...u32be(0xcffaedfe), ...u32le(0x01000007), ...u32le(0), ...u32le(2), ...u32le(1), ...u32le(24), ...u32le(0), ...u32le(0)];
    // Each declares a 24-byte command and supplies none of it.
    for (const cmd of [0x0c, 0x8000001c, 0x32]) {
      const r = extractBinary("macho", U8(header, u32le(cmd), u32le(24)));
      expect(val(r, "Links against")).toBeUndefined();
      expect(val(r, "Runtime search paths")).toBeUndefined();
      expect(val(r, "Platform")).toBeUndefined();
    }
  });

  it("refuses a string offset that points outside its own load command", () => {
    // Offset 0 would read the command header itself; offset 9999 the rest of
    // the file. Neither is a path the command actually carries.
    const before = extractBinary("macho", buildMachO([{ cmd: 0x0c, payload: [...u32le(0), ...A("x"), 0] }]));
    expect(val(before, "Links against")).toBeUndefined();
    const after = extractBinary("macho", buildMachO([{ cmd: 0x8000001c, payload: [...u32le(9999), ...A("x"), 0] }]));
    expect(val(after, "Runtime search paths")).toBeUndefined();
  });

  it("ignores a library whose name is empty and a command it does not know", () => {
    const r = extractBinary("macho", buildMachO([
      { cmd: 0x0c, payload: [...u32le(12), 0, 0, 0, 0] }, // the name is an immediate NUL
      { cmd: 0x2a, payload: [1, 2, 3, 4] },               // a command with no meaning here
    ]));
    expect(val(r, "Links against")).toBeUndefined();
    expect(val(r, "Code signature")).toBe("none");
  });

  it("reads no producers string from a module that ends at the marker", () => {
    const atEnd = U8([0x00, 0x61, 0x73, 0x6d], u32le(1), [0x09, ...A("producers")]);
    expect(val(extractBinary("wasm", atEnd), "Producers")).toBeUndefined();
  });
});
