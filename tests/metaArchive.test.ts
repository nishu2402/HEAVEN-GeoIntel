import { describe, it, expect } from "vitest";
import { gzipSync } from "node:zlib";
import { extractArchive } from "@/lib/analysis/meta/archive";
import { asciiBytes } from "@/lib/analysis/meta/bytes";

const A = (s: string) => asciiBytes(s);
const cat = (...p: (number[] | Uint8Array)[]) => new Uint8Array(p.flatMap((x) => Array.from(x)));
const u16le = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u32le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const val = (r: { fields: { label: string; value: string }[] }, label: string) =>
  r.fields.find((f) => f.label === label)?.value;

// 2023-06-15 12:00:00 UTC in Unix seconds.
const MTIME = Math.floor(Date.UTC(2023, 5, 15, 12, 0, 0) / 1000);

// ── TAR writer, shared with the .tar.gz tests ────────────────────────────────
interface HeaderSpec {
  name: string; uid?: string; gid?: string; size?: string; mtime?: string;
  uname?: string; gname?: string; mode?: string; magic?: string;
}

function tarHeader(o: HeaderSpec): number[] {
  const buf = new Array(512).fill(0);
  const put = (s: string, off: number, len: number) => {
    const b = A(s);
    for (let i = 0; i < Math.min(b.length, len); i++) buf[off + i] = b[i];
  };
  put(o.name, 0, 100);
  put(o.mode ?? "0000644", 100, 8);
  put(o.uid ?? "0000644", 108, 8);
  put(o.gid ?? "0000644", 116, 8);
  put(o.size ?? "00000000000", 124, 12);
  put(o.mtime ?? "00000000000", 136, 12);
  put(o.magic ?? "ustar\0", 257, 6);
  if (o.uname) put(o.uname, 265, 32);
  if (o.gname) put(o.gname, 297, 32);
  return buf;
}

const octalTime = (t: number) => t.toString(8).padStart(11, "0");

describe("meta/archive GZIP", () => {
  it("reads the original filename, mtime, source OS, level and comment", async () => {
    const gz = cat(
      [0x1f, 0x8b, 0x08, 0x08 | 0x10 | 0x04], // FEXTRA + FNAME + FCOMMENT
      u32le(MTIME), [0x02, 0x03], // xfl = maximum compression, OS = Unix
      u16le(2), [0xaa, 0xbb], // FEXTRA: 2-byte length + payload
      ...[A("secret_report.pdf"), [0]], // FNAME, NUL-terminated
      ...[A("built by ci"), [0]], // FCOMMENT
    );
    const r = await extractArchive("gzip", gz);
    expect(val(r, "Original filename")).toBe("secret_report.pdf");
    expect(val(r, "Original modified")).toBe("2023-06-15 12:00:00");
    expect(val(r, "Source OS")).toBe("Unix");
    expect(val(r, "Compression level")).toBe("maximum compression");
    expect(val(r, "Comment")).toBe("built by ci");
    expect(r.fields.find((f) => f.label === "Original filename")?.sensitive).toBe(true);
  });

  it("handles a minimal header (no flags, no mtime, unknown OS and level)", async () => {
    const gz = cat([0x1f, 0x8b, 0x08, 0x00], u32le(0), [0x00, 0xff]);
    const r = await extractArchive("gzip", gz);
    expect(val(r, "Original filename")).toBeUndefined();
    expect(val(r, "Original modified")).toBeUndefined(); // mtime 0
    expect(val(r, "Source OS")).toBeUndefined(); // OS 255 is unknown
    expect(val(r, "Compression level")).toBeUndefined(); // xfl 0 states neither end
  });

  it("names the fastest compression setting too", async () => {
    const gz = cat([0x1f, 0x8b, 0x08, 0x00], u32le(0), [0x04, 0x03]);
    expect(val(await extractArchive("gzip", gz), "Compression level")).toBe("fastest");
  });

  it("measures the real uncompressed size and names what is inside", async () => {
    const payload = Buffer.from("%PDF-1.7\n".padEnd(4096, " "));
    const gz = new Uint8Array(gzipSync(payload));
    const r = await extractArchive("gzip", gz);
    expect(val(r, "Uncompressed")).toBe("4.0 KB");
    expect(val(r, "Compression")).toMatch(/^9\d\.\d% smaller packed$/);
    expect(val(r, "Contains")).toBe("PDF document");
  });

  it("reads the tar inside a .tar.gz, with every name and owner it carries", async () => {
    const tar = cat(
      tarHeader({ name: "backup/db.sql", size: "00000000012", mtime: octalTime(MTIME), uname: "postgres", gname: "postgres" }),
      new Array(512).fill(0),
      tarHeader({ name: "backup/run.sh", mode: "0000755", uname: "deploy", gname: "staff" }),
      new Array(1024).fill(0),
    );
    const r = await extractArchive("gzip", new Uint8Array(gzipSync(Buffer.from(tar))));
    expect(val(r, "Contains")).toBe("TAR archive");
    expect(val(r, "Members")).toBe("2");
    expect(val(r, "Owners")).toBe("postgres, deploy");
    expect(val(r, "Groups")).toBe("postgres, staff");
    expect(val(r, "Contents")).toBe("backup/db.sql, backup/run.sh");
    expect(val(r, "Executable members")).toBe("backup/run.sh");
  });

  it("says so plainly when the compressed stream cannot be read", async () => {
    const broken = cat([0x1f, 0x8b, 0x08, 0x00], u32le(0), [0x00, 0x03], [1, 2, 3, 4, 5, 6]);
    const r = await extractArchive("gzip", broken);
    expect(val(r, "Uncompressed")).toBeUndefined();
    expect((r.notes ?? []).some((n) => /could not be read/.test(n))).toBe(true);
  });

  it("reports an empty payload without dividing by it", async () => {
    const r = await extractArchive("gzip", new Uint8Array(gzipSync(Buffer.alloc(0))));
    expect(val(r, "Uncompressed")).toBe("0 bytes");
    expect(val(r, "Compression")).toBeUndefined();
    expect(val(r, "Contains")).toBe("Empty file"); // a gzip of nothing is still stated
  });

  it("reads no header fields at all from a file that ends after its flags", async () => {
    expect((await extractArchive("gzip", cat([0x1f, 0x8b, 0x08, 0x00]))).fields).toEqual([]);
  });

  it("says nothing about content it cannot identify", async () => {
    const noise = Buffer.from(Array.from({ length: 64 }, (_, i) => (i * 37) & 0xff));
    const r = await extractArchive("gzip", new Uint8Array(gzipSync(noise)));
    expect(val(r, "Uncompressed")).toBe("64 bytes");
    expect(val(r, "Contains")).toBeUndefined();
  });

  it("degrades on a truncated header or extra field", async () => {
    expect((await extractArchive("gzip", cat([0x1f, 0x8b, 0x08]))).fields).toEqual([]); // flags byte missing
    // FEXTRA flag set but the extra-length field is missing.
    const noExtra = await extractArchive("gzip", cat([0x1f, 0x8b, 0x08, 0x04], u32le(0), [0, 0xff]));
    expect(noExtra.fields).toEqual([]);
  });

  it("drops empty FNAME and FCOMMENT strings", async () => {
    // FNAME + FCOMMENT flags set, but both strings are immediately terminated.
    const gz = cat([0x1f, 0x8b, 0x08, 0x08 | 0x10], u32le(0), [0, 0xff], [0], [0]);
    const r = await extractArchive("gzip", gz);
    expect(val(r, "Original filename")).toBeUndefined();
    expect(val(r, "Comment")).toBeUndefined();
  });
});

describe("meta/archive TAR", () => {
  it("reads the format, every owner, the dates and the member list", async () => {
    const tar = cat(
      tarHeader({ name: "project/notes.txt", uid: "0001750", gid: "0001750", size: "00000000012", mtime: octalTime(MTIME), uname: "alice", gname: "staff" }),
      new Array(512).fill(0).map((_, i) => (i < 5 ? A("data\n")[i] : 0)), // data block of the first file
      tarHeader({ name: "project/logo.png", mtime: octalTime(MTIME - 86400) }), // a second, older member
    );
    const r = await extractArchive("tar", tar);
    expect(val(r, "Format")).toBe("POSIX ustar (ustar)");
    expect(val(r, "Members")).toBe("2");
    expect(val(r, "Total size")).toBe("10 bytes");
    expect(val(r, "Owner")).toBe("alice");
    expect(val(r, "Group")).toBe("staff");
    expect(val(r, "Owner UID")).toBe("1000"); // 0001750 octal
    expect(val(r, "Group GID")).toBe("1000");
    expect(val(r, "Oldest member")).toBe("2023-06-14 12:00:00");
    expect(val(r, "Newest member")).toBe("2023-06-15 12:00:00");
    expect(val(r, "Contents")).toBe("project/notes.txt, project/logo.png");
    expect(r.fields.find((f) => f.label === "Owner")?.sensitive).toBe(true);
  });

  it("truncates a long member list and names the executable members", async () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      tarHeader({ name: `bin/tool${i}`, mode: i < 2 ? "0000755" : "0000644" }));
    const r = await extractArchive("tar", cat(...many, new Array(512).fill(0)));
    expect(val(r, "Contents")).toMatch(/, and 4 more$/);
    expect(val(r, "Executable members")).toBe("bin/tool0, bin/tool1");
  });

  it("totals a large archive in megabytes", async () => {
    const big = tarHeader({ name: "disk.img", size: (3 * 1024 * 1024).toString(8).padStart(11, "0") });
    expect(val(await extractArchive("tar", cat(big)), "Total size")).toBe("3.0 MB");
  });

  it("caps the executable list rather than repeating the whole archive", async () => {
    const many = Array.from({ length: 10 }, (_, i) => tarHeader({ name: `bin/t${i}`, mode: "0000755" }));
    const r = await extractArchive("tar", cat(...many, new Array(512).fill(0)));
    expect(val(r, "Executable members")?.split(", ")).toHaveLength(6);
  });

  it("does not call a directory entry executable", async () => {
    const r = await extractArchive("tar", cat(tarHeader({ name: "src/", mode: "0000755" }), new Array(512).fill(0)));
    expect(val(r, "Executable members")).toBeUndefined();
  });

  it("names a non-ustar magic as it finds it, and omits an absent one", async () => {
    const gnu = await extractArchive("tar", cat(tarHeader({ name: "a", magic: "GNUtar" }), new Array(512).fill(0)));
    expect(val(gnu, "Format")).toBe("GNUtar");
    const none = await extractArchive("tar", cat(tarHeader({ name: "a", magic: "\0\0\0\0\0\0" }), new Array(512).fill(0)));
    expect(val(none, "Format")).toBeUndefined();
  });

  it("omits fields that are blank or non-octal and stops at a zero header", async () => {
    const h = new Array(512).fill(0);
    A("solo.bin").forEach((c, i) => (h[i] = c));
    A("ustar\0").forEach((c, i) => (h[257 + i] = c));
    A("notoctal").forEach((c, i) => (h[124 + i] = c)); // invalid size -> octal() returns null
    const r = await extractArchive("tar", cat(h, new Array(512).fill(0)));
    expect(val(r, "Contents")).toBe("solo.bin");
    expect(val(r, "Owner")).toBeUndefined();
    expect(val(r, "Total size")).toBeUndefined(); // no readable size to total
    expect(val(r, "Members")).toBe("1"); // zero header stops the count
  });

  it("drops a present-but-zero mtime and reads nothing from an empty archive", async () => {
    const r0 = await extractArchive("tar", cat(tarHeader({ name: "z.txt", mtime: "00000000000" }), new Array(512).fill(0)));
    expect(val(r0, "Contents")).toBe("z.txt");
    expect(val(r0, "Newest member")).toBeUndefined();
    expect(val(r0, "Oldest member")).toBeUndefined();
    const empty = await extractArchive("tar", new Uint8Array(512));
    expect(empty.fields).toEqual([]);
  });

  it("stops walking an archive with an implausible number of members", async () => {
    // Every header claims zero length, so the walk advances one block at a time
    // and the 4096-member bound is what ends it rather than the file's size.
    const r = await extractArchive("tar", new Uint8Array(cat(...Array.from({ length: 4100 }, () => tarHeader({ name: "x" })))));
    expect(val(r, "Members")).toBe("4096");
  });
});

describe("meta/archive dispatch", () => {
  it("returns nothing for an unhandled kind", async () => {
    expect((await extractArchive("rar", new Uint8Array(8))).fields).toEqual([]);
  });
});
