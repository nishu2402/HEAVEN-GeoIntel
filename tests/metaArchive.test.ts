import { describe, it, expect } from "vitest";
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

describe("meta/archive GZIP", () => {
  it("reads the original filename, mtime, source OS and comment", () => {
    const gz = cat(
      [0x1f, 0x8b, 0x08, 0x08 | 0x10 | 0x04], // FEXTRA + FNAME + FCOMMENT
      u32le(MTIME), [0x00, 0x03], // xfl, OS = Unix
      u16le(2), [0xaa, 0xbb], // FEXTRA: 2-byte length + payload
      ...[A("secret_report.pdf"), [0]], // FNAME, NUL-terminated
      ...[A("built by ci"), [0]], // FCOMMENT
    );
    const r = extractArchive("gzip", gz);
    expect(val(r, "Original filename")).toBe("secret_report.pdf");
    expect(val(r, "Original modified")).toBe("2023-06-15 12:00:00");
    expect(val(r, "Source OS")).toBe("Unix");
    expect(val(r, "Comment")).toBe("built by ci");
    expect(r.fields.find((f) => f.label === "Original filename")?.sensitive).toBe(true);
  });

  it("handles a minimal header (no flags, no mtime, unknown OS)", () => {
    const gz = cat([0x1f, 0x8b, 0x08, 0x00], u32le(0), [0x00, 0xff]);
    const r = extractArchive("gzip", gz);
    expect(val(r, "Original filename")).toBeUndefined();
    expect(val(r, "Original modified")).toBeUndefined(); // mtime 0
    expect(val(r, "Source OS")).toBeUndefined(); // OS 255 is unknown
  });

  it("degrades on a truncated header or extra field", () => {
    expect(extractArchive("gzip", cat([0x1f, 0x8b, 0x08])).fields).toEqual([]); // flags byte missing
    // Flags present but the whole rest is missing (mtime/OS unreadable).
    expect(extractArchive("gzip", cat([0x1f, 0x8b, 0x08, 0x00])).fields).toEqual([]);
    // FEXTRA flag set but the extra-length field is missing (OS unknown, mtime 0).
    expect(extractArchive("gzip", cat([0x1f, 0x8b, 0x08, 0x04], u32le(0), [0, 0xff])).fields).toEqual([]);
  });

  it("drops empty FNAME and FCOMMENT strings", () => {
    // FNAME + FCOMMENT flags set, but both strings are immediately terminated.
    const gz = cat([0x1f, 0x8b, 0x08, 0x08 | 0x10], u32le(0), [0, 0xff], [0], [0]);
    expect(extractArchive("gzip", gz).fields).toEqual([]);
  });
});

describe("meta/archive TAR", () => {
  function tarHeader(o: { name: string; uid?: string; gid?: string; size?: string; mtime?: string; uname?: string; gname?: string }): number[] {
    const buf = new Array(512).fill(0);
    const put = (s: string, off: number, len: number) => {
      const b = A(s);
      for (let i = 0; i < Math.min(b.length, len); i++) buf[off + i] = b[i];
    };
    put(o.name, 0, 100);
    put(o.uid ?? "0000644", 108, 8);
    put(o.gid ?? "0000644", 116, 8);
    put(o.size ?? "00000000000", 124, 12);
    put(o.mtime ?? "00000000000", 136, 12);
    put("ustar\0", 257, 6);
    if (o.uname) put(o.uname, 265, 32);
    if (o.gname) put(o.gname, 297, 32);
    return buf;
  }

  it("reads owner/group names, ids, mtime and a member count", () => {
    const mtimeOctal = MTIME.toString(8).padStart(11, "0");
    const tar = cat(
      tarHeader({ name: "project/notes.txt", uid: "0001750", gid: "0001750", size: "00000000012", mtime: mtimeOctal, uname: "alice", gname: "staff" }),
      new Array(512).fill(0).map((_, i) => (i < 5 ? A("data\n")[i] : 0)), // data block of the first file
      tarHeader({ name: "project/logo.png", size: "00000000000" }), // a second member
    );
    const r = extractArchive("tar", tar);
    expect(val(r, "First entry")).toBe("project/notes.txt");
    expect(val(r, "Owner")).toBe("alice");
    expect(val(r, "Group")).toBe("staff");
    expect(val(r, "Owner UID")).toBe("1000"); // 0001750 octal
    expect(val(r, "First entry modified")).toBe("2023-06-15 12:00:00");
    expect(val(r, "Members")).toBe("2");
    expect(r.fields.find((f) => f.label === "Owner")?.sensitive).toBe(true);
  });

  it("omits fields that are blank or non-octal and stops at a zero header", () => {
    // A header with blank owner/group/uid and an invalid octal size.
    const h = new Array(512).fill(0);
    A("solo.bin").forEach((c, i) => (h[i] = c));
    A("ustar\0").forEach((c, i) => (h[257 + i] = c));
    A("notoctal").forEach((c, i) => (h[124 + i] = c)); // invalid size -> octal() returns null
    const tar = cat(h, new Array(512).fill(0)); // trailing zero header ends the walk
    const r = extractArchive("tar", tar);
    expect(val(r, "First entry")).toBe("solo.bin");
    expect(val(r, "Owner")).toBeUndefined();
    expect(val(r, "Members")).toBe("1"); // zero header stops the count
  });

  it("drops a present-but-zero mtime and a fully empty archive", () => {
    // First header names a file but its mtime is octal zero -> no date field.
    const r0 = extractArchive("tar", cat(tarHeader({ name: "z.txt", mtime: "00000000000" }), new Array(512).fill(0)));
    expect(val(r0, "First entry")).toBe("z.txt");
    expect(val(r0, "First entry modified")).toBeUndefined();
    // An all-zero archive: no first entry, no members.
    const empty = extractArchive("tar", new Uint8Array(512));
    expect(empty.fields).toEqual([]);
  });
});

describe("meta/archive dispatch", () => {
  it("returns nothing for an unhandled kind", () => {
    expect(extractArchive("rar", new Uint8Array(8)).fields).toEqual([]);
  });
});
